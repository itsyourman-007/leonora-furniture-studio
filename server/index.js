require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const Razorpay = require('razorpay');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const PRODUCTS_FILE = path.join(DATA, 'products.json');
const ORDERS_FILE = path.join(DATA, 'orders.json');
const CUSTOM_FILE = path.join(DATA, 'customization-requests.json');
const EVENTS_FILE = path.join(DATA, 'webhook-events.json');

for (const f of [PRODUCTS_FILE, ORDERS_FILE, CUSTOM_FILE, EVENTS_FILE]) {
  if (!fs.existsSync(f)) fs.writeFileSync(f, '[]');
}

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));
const now = () => new Date().toISOString();
const adminSessions = new Map();

const razorpayReady = Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
const razorpay = razorpayReady ? new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET }) : null;
const mailReady = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
const transporter = mailReady ? nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
}) : null;

function money(value) { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value); }
function findProduct(id) { return readJson(PRODUCTS_FILE).find(p => p.id === id); }
function findOrder(id) { return readJson(ORDERS_FILE).find(o => o.id === id || o.razorpayOrderId === id); }
function updateOrder(id, patch) {
  const orders = readJson(ORDERS_FILE);
  const i = orders.findIndex(o => o.id === id || o.razorpayOrderId === id);
  if (i < 0) return null;
  orders[i] = { ...orders[i], ...patch, updatedAt: now() };
  writeJson(ORDERS_FILE, orders);
  return orders[i];
}
function adminAuth(req, res, next) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token || !adminSessions.has(token)) return res.status(401).json({ error: 'Admin authentication required.' });
  req.admin = adminSessions.get(token);
  next();
}
function slugify(s) { return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function safeNumber(n, min = 0) { const v = Number(n); return Number.isFinite(v) ? Math.max(min, v) : min; }
function verifyRazorpaySignature(orderId, paymentId, signature) {
  if (!process.env.RAZORPAY_KEY_SECRET) return false;
  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
  const a = Buffer.from(expected); const b = Buffer.from(String(signature || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function verifyWebhook(raw, signature) {
  if (!process.env.RAZORPAY_WEBHOOK_SECRET) return false;
  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest('hex');
  const a = Buffer.from(expected); const b = Buffer.from(String(signature || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function sendMail({ to, subject, html }) {
  if (!transporter || !to) return false;
  await transporter.sendMail({ from: process.env.SMTP_FROM || process.env.STORE_EMAIL || process.env.SMTP_USER, to, subject, html });
  return true;
}

async function sendConfirmationEmail(order) {
  if (order.confirmationEmailSentAt || !order.email) return false;
  const rows = order.items.map(i => `<tr><td style="padding:10px 0">${i.name} × ${i.quantity}</td><td style="padding:10px 0;text-align:right">${money(i.price * i.quantity)}</td></tr>`).join('');
  const html = `<!doctype html><html><body style="margin:0;background:#f8f2ea;color:#181614;font-family:Arial,sans-serif"><div style="max-width:680px;margin:0 auto;padding:46px 28px"><div style="font:32px Georgia,serif;letter-spacing:.1em">LEONORA</div><div style="letter-spacing:.25em;font-size:12px;margin-top:5px">FURNITURE STUDIO</div><div style="border-top:1px solid #d9cabb;margin-top:32px;padding-top:28px"><h1 style="font:40px Georgia,serif;font-weight:400">Order confirmed ✓</h1><p>Thank you for your purchase. Order <b>${order.id}</b> is confirmed.</p><table style="width:100%;border-collapse:collapse;margin:22px 0">${rows}<tr style="border-top:1px solid #d9cabb"><td style="padding:16px 0;font-weight:bold">Total paid</td><td style="padding:16px 0;text-align:right;font-weight:bold">${money(order.total)}</td></tr></table><p><b>Delivery to</b><br>${order.shipping.name}<br>${order.shipping.address1}${order.shipping.address2 ? ', ' + order.shipping.address2 : ''}<br>${order.shipping.city}, ${order.shipping.state} ${order.shipping.pincode}</p><p style="margin-top:28px">Payment status: <b>PAID</b></p><p style="margin-top:38px;color:#6d6358">White-glove delivery updates will be sent as your order progresses.</p></div></div></body></html>`;
  const sent = await sendMail({ to: order.email, subject: `Your Leonora order ${order.id} is confirmed`, html });
  if (sent) updateOrder(order.id, { confirmationEmailSentAt: now() });
  return sent;
}
async function sendCustomizationEmail(request) {
  if (!request.email) return false;
  const html = `<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;padding:32px;color:#1c1916"><h1 style="font:34px Georgia,serif;font-weight:400">Customisation request received</h1><p>Thank you for requesting a bespoke configuration for <b>${request.productName}</b>.</p><p>Request reference: <b>${request.id}</b></p><p>Selected colour: <b>${request.color}</b><br>Selected fabric/material: <b>${request.fabric || 'Not applicable'}</b><br>Measurements: <b>W ${request.dimensions.width} × D ${request.dimensions.depth} × H ${request.dimensions.height} cm</b></p><p>Our studio team will contact you regarding the quotation.</p><p style="color:#6d6358">Leonora Furniture Studio · Mumbai, India</p></div>`;
  return sendMail({ to: request.email, subject: `Leonora customisation request ${request.id}`, html });
}
async function markPaid(order, paymentId) {
  if (!order) return null;
  if (order.paymentStatus === 'paid') return order;
  let updated = updateOrder(order.id, { paymentStatus: 'paid', status: 'confirmed', razorpayPaymentId: paymentId || order.razorpayPaymentId, paidAt: order.paidAt || now() });
  if (updated && !updated.inventoryDeductedAt) {
    const products = readJson(PRODUCTS_FILE);
    for (const item of updated.items) {
      const product = products.find(x => x.id === item.id);
      if (product) product.stock = Math.max(0, Number(product.stock || 0) - Number(item.quantity || 0));
    }
    writeJson(PRODUCTS_FILE, products);
    updated = updateOrder(updated.id, { inventoryDeductedAt: now() });
  }
  if (updated) await sendConfirmationEmail(updated).catch(e => console.error('Email error', e));
  return updated;
}

app.use(cors());
app.post('/api/webhooks/razorpay', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    if (!verifyWebhook(req.body, req.headers['x-razorpay-signature'])) return res.status(400).send('Invalid webhook signature');
    const eventId = req.headers['x-razorpay-event-id'];
    const seen = readJson(EVENTS_FILE);
    if (eventId && seen.includes(eventId)) return res.status(200).send('ok');
    if (eventId) { seen.push(eventId); writeJson(EVENTS_FILE, seen.slice(-1000)); }
    const payload = JSON.parse(req.body.toString('utf8'));
    const payment = payload?.payload?.payment?.entity;
    const orderEntity = payload?.payload?.order?.entity;
    const rpOrderId = payment?.order_id || orderEntity?.id;
    const order = rpOrderId ? findOrder(rpOrderId) : null;
    if (order && ['payment.captured', 'order.paid'].includes(payload.event)) await markPaid(order, payment?.id);
    if (order && payload.event === 'payment.failed') updateOrder(order.id, { paymentStatus: 'failed', status: 'payment_failed', failureReason: payment?.error_description || 'Payment failed' });
    res.status(200).send('ok');
  } catch (e) { console.error(e); res.status(500).send('Webhook processing failed'); }
});
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(ROOT, 'public')));

app.get('/api/config', (req,res) => res.json({ razorpayKeyId: process.env.RAZORPAY_KEY_ID || null, currency: process.env.STORE_CURRENCY || 'INR', ready: razorpayReady }));
app.get('/api/products', (req,res) => res.json(readJson(PRODUCTS_FILE)));
app.get('/api/orders/:id', (req,res) => { const o = findOrder(req.params.id); if (!o) return res.status(404).json({ error:'Order not found' }); res.json(o); });

app.post('/api/orders/create', async (req,res) => {
  try {
    if (!razorpayReady) return res.status(503).json({ error: 'Razorpay is not configured. Add keys in .env.' });
    const { items, email, shipping } = req.body || {};
    if (!Array.isArray(items) || !items.length || !email || !shipping?.name || !shipping?.phone || !shipping?.address1 || !shipping?.city || !shipping?.state || !shipping?.pincode) return res.status(400).json({ error:'Complete customer, delivery and cart details are required.' });
    const products = readJson(PRODUCTS_FILE);
    const cleanItems = items.map(item => {
      const p = products.find(x => x.id === item.id); if (!p) throw new Error(`Product not found: ${item.id}`);
      const quantity = Math.max(1, Math.min(10, Number(item.quantity || 1)));
      if (Number(p.stock || 0) < quantity) throw new Error(`${p.name} is not available in the requested quantity.`);
      return { id:p.id, name:p.name, price:Number(p.price), quantity, image:p.image, selectedColor:item.selectedColor || null, selectedFabric:item.selectedFabric || null };
    });
    const subtotal = cleanItems.reduce((s,i)=>s+i.price*i.quantity,0);
    const shippingFee = subtotal >= 100000 ? 0 : 2500;
    const total = subtotal + shippingFee;
    const receipt = `LEO-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const rp = await razorpay.orders.create({ amount: total*100, currency:'INR', receipt, payment_capture:1, notes:{ store_order_id:receipt, customer_email:email } });
    const order = { id:receipt, razorpayOrderId:rp.id, email, shipping, items:cleanItems, subtotal, shippingFee, total, currency:'INR', status:'payment_pending', paymentStatus:'pending', createdAt:now() };
    const orders = readJson(ORDERS_FILE); orders.push(order); writeJson(ORDERS_FILE,orders);
    res.json({ orderId:receipt, razorpayOrderId:rp.id, amount:total*100, currency:'INR', keyId:process.env.RAZORPAY_KEY_ID });
  } catch(e) { console.error(e); res.status(500).json({ error:e.message || 'Unable to create order.' }); }
});

app.post('/api/orders/verify', async (req,res) => {
  try {
    if (!razorpayReady) return res.status(503).json({ error:'Razorpay is not configured.' });
    const { orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body || {};
    const order = findOrder(orderId);
    if (!order || order.razorpayOrderId !== razorpayOrderId) return res.status(404).json({ error:'Order not found.' });
    if (!verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature)) return res.status(400).json({ error:'Payment signature verification failed.' });
    const payment = await razorpay.payments.fetch(razorpayPaymentId);
    if (payment.order_id !== razorpayOrderId || payment.amount !== order.total*100) return res.status(400).json({ error:'Payment/order validation failed.' });
    if (payment.status === 'captured') return res.json({ ok:true, order: await markPaid(order, razorpayPaymentId) });
    updateOrder(order.id, { paymentStatus:payment.status, razorpayPaymentId });
    return res.status(409).json({ ok:false, error:`Payment is ${payment.status}.` });
  } catch(e) { console.error(e); res.status(500).json({ error:'Unable to verify payment.' }); }
});

app.post('/api/customization-requests', async (req,res) => {
  try {
    const { productId, productName, email, phone, color, fabric, dimensions, notes } = req.body || {};
    if (!productId || !productName || !email || !phone || !color || !dimensions?.width || !dimensions?.depth || !dimensions?.height) return res.status(400).json({ error:'Please complete your contact information and measurements.' });
    const request = { id:`CUS-${Date.now().toString(36).toUpperCase()}`, productId, productName, email, phone, color, fabric: fabric || '', dimensions:{ width:safeNumber(dimensions.width,1), depth:safeNumber(dimensions.depth,1), height:safeNumber(dimensions.height,1) }, notes:notes || '', status:'submitted', createdAt:now() };
    const requests = readJson(CUSTOM_FILE); requests.push(request); writeJson(CUSTOM_FILE, requests);
    await sendCustomizationEmail(request).catch(e => console.error('Customization email error', e));
    if (process.env.STUDIO_EMAIL) await sendMail({ to:process.env.STUDIO_EMAIL, subject:`New Leonora customisation request ${request.id}`, html:`<p>New request <b>${request.id}</b> for <b>${request.productName}</b>.</p><p>Customer: ${request.email} · ${request.phone}<br>Colour: ${request.color}<br>Fabric: ${request.fabric || 'N/A'}<br>Dimensions: W ${request.dimensions.width} × D ${request.dimensions.depth} × H ${request.dimensions.height} cm</p>` }).catch(e => console.error(e));
    res.json({ ok:true, requestId:request.id });
  } catch(e) { console.error(e); res.status(500).json({ error:'Unable to submit customisation request.' }); }
});

app.post('/api/admin/login', (req,res) => {
  const { email, password } = req.body || {};
  const validEmail = email === (process.env.ADMIN_EMAIL || 'admin@leonora.in');
  const validPassword = password === (process.env.ADMIN_PASSWORD || 'LeonoraAdmin#2026');
  if (!validEmail || !validPassword) return res.status(401).json({ error:'Invalid admin credentials.' });
  const token = crypto.randomBytes(32).toString('hex');
  adminSessions.set(token, { email, createdAt:Date.now() });
  res.json({ token, email });
});
app.post('/api/admin/logout', adminAuth, (req,res) => { const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i,''); adminSessions.delete(token); res.json({ok:true}); });

app.get('/api/admin/dashboard', adminAuth, (req,res) => {
  const orders = readJson(ORDERS_FILE); const paid = orders.filter(o=>o.paymentStatus==='paid');
  const sales = paid.reduce((s,o)=>s+Number(o.total||0),0);
  const year = new Date().getFullYear();
  const months = Array.from({length:12},(_,i)=>({ label:new Date(year,i,1).toLocaleString('en-IN',{month:'short'}), sales:0, orders:0 }));
  paid.forEach(o=>{ const d=new Date(o.paidAt||o.createdAt); if(d.getFullYear()===year){ months[d.getMonth()].sales+=Number(o.total||0); months[d.getMonth()].orders+=1; } });
  const products = readJson(PRODUCTS_FILE); const customization = readJson(CUSTOM_FILE);
  res.json({ metrics:{ totalOrders:paid.length, totalSales:sales, avgOrder:paid.length?sales/paid.length:0, lowStock:products.filter(p=>Number(p.stock||0)<=5).length, customizationRequests:customization.filter(r=>r.status==='submitted').length }, months, recentOrders:orders.slice().sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,12), products, customizationRequests:customization.slice().sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,30) });
});

app.get('/api/admin/orders', adminAuth, (req,res) => res.json(readJson(ORDERS_FILE).slice().sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))));
app.get('/api/admin/inventory', adminAuth, (req,res) => res.json(readJson(PRODUCTS_FILE)));
app.get('/api/admin/customizations', adminAuth, (req,res) => res.json(readJson(CUSTOM_FILE).slice().sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))));

app.post('/api/admin/products', adminAuth, (req,res) => {
  try {
    const body = req.body || {};
    if (!body.name || !body.category || !body.price || !body.image) return res.status(400).json({ error:'Name, category, price and image are required.' });
    const products = readJson(PRODUCTS_FILE); let id = slugify(body.id || body.name); if(products.some(p=>p.id===id)) id += '-' + Date.now().toString(36);
    const p = { id, name:String(body.name).trim(), category:String(body.category), material:String(body.material||'Made to order'), price:safeNumber(body.price), image:String(body.image), customizable:Boolean(body.customizable), colors:Array.isArray(body.colors)?body.colors:[], fabrics:Array.isArray(body.fabrics)?body.fabrics:[], dimensions:{width:safeNumber(body.dimensions?.width,1), depth:safeNumber(body.dimensions?.depth,1), height:safeNumber(body.dimensions?.height,1)}, stock:safeNumber(body.stock,0) };
    products.push(p); writeJson(PRODUCTS_FILE, products); res.status(201).json(p);
  } catch(e){ res.status(500).json({error:'Unable to add product.'}); }
});
app.put('/api/admin/products/:id', adminAuth, (req,res) => {
  const products=readJson(PRODUCTS_FILE); const i=products.findIndex(p=>p.id===req.params.id); if(i<0)return res.status(404).json({error:'Product not found'});
  const b=req.body||{}; products[i]={...products[i],...b,price:b.price===undefined?products[i].price:safeNumber(b.price),stock:b.stock===undefined?products[i].stock:safeNumber(b.stock),customizable:b.customizable===undefined?products[i].customizable:Boolean(b.customizable)}; writeJson(PRODUCTS_FILE,products); res.json(products[i]);
});
app.post('/api/admin/orders/:id/status', adminAuth, (req,res) => { const allowed=['payment_pending','confirmed','processing','packed','shipped','out_for_delivery','delivered','cancelled']; const status=req.body?.status; if(!allowed.includes(status))return res.status(400).json({error:'Invalid order status'}); const o=updateOrder(req.params.id,{status}); if(!o)return res.status(404).json({error:'Order not found'}); res.json(o); });
app.post('/api/admin/customizations/:id/status', adminAuth, (req,res) => { const allowed=['submitted','reviewing','quoted','approved','closed']; const status=req.body?.status; if(!allowed.includes(status))return res.status(400).json({error:'Invalid status'}); const arr=readJson(CUSTOM_FILE); const i=arr.findIndex(r=>r.id===req.params.id); if(i<0)return res.status(404).json({error:'Request not found'}); arr[i]={...arr[i],status,updatedAt:now()}; writeJson(CUSTOM_FILE,arr); res.json(arr[i]); });

app.get('/health', (req,res) => res.status(200).json({status:'ok'}));
app.get('*', (req,res) => res.sendFile(path.join(ROOT,'public','index.html')));
app.listen(PORT, '0.0.0.0', () => console.log(`Leonora running on 0.0.0.0:${PORT} — Razorpay ${razorpayReady?'ready':'not configured'}`));
