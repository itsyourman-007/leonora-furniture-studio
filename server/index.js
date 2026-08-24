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
const DATA = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
fs.mkdirSync(DATA, { recursive: true });
const PRODUCTS_FILE = path.join(DATA, 'products.json');
const CATEGORIES_FILE = path.join(DATA, 'categories.json');
const ORDERS_FILE = path.join(DATA, 'orders.json');
const CUSTOM_FILE = path.join(DATA, 'customization-requests.json');
const EVENTS_FILE = path.join(DATA, 'webhook-events.json');

for (const f of [PRODUCTS_FILE, CATEGORIES_FILE, ORDERS_FILE, CUSTOM_FILE, EVENTS_FILE]) {
  if (fs.existsSync(f)) continue;
  const seed = path.join(ROOT, 'data', path.basename(f));
  if (process.env.DATA_DIR && fs.existsSync(seed)) fs.copyFileSync(seed, f);
  else fs.writeFileSync(f, '[]');
}

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));
const now = () => new Date().toISOString();
const adminSessions = new Map();
const rateBuckets = new Map();
const finalizingOrders = new Set();

const razorpayReady = Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET && process.env.RAZORPAY_WEBHOOK_SECRET);
const publicOrigin = String(process.env.PUBLIC_ORIGIN || '').trim();
const paymentReservationMs = 15 * 60 * 1000;
const storeCurrency = 'INR';
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
function normalizeEmail(value) { return String(value || '').trim().toLowerCase(); }
function cleanText(value, max = 180) { return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max); }
function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function validPhone(value) { return /^[+0-9()\-\s]{7,20}$/.test(value); }
function validPincode(value) { return /^[A-Za-z0-9\s-]{3,12}$/.test(value); }
function orderFingerprint(email, items, total) { return JSON.stringify({ email, items: items.map(i => ({ id:i.id, quantity:i.quantity, selectedColor:i.selectedColor || null, selectedFabric:i.selectedFabric || null })), total }); }
function isActiveReservation(order) {
  return order?.paymentStatus === 'pending' && order?.status === 'payment_pending' && new Date(order.reservationExpiresAt || new Date(new Date(order.createdAt).getTime() + paymentReservationMs)).getTime() > Date.now();
}
function reservedQuantity(orders, productId) { return orders.filter(isActiveReservation).reduce((sum, order) => sum + order.items.filter(item => item.id === productId).reduce((n, item) => n + Number(item.quantity || 0), 0), 0); }
function publicOrder(order) {
  return { id:order.id, status:order.status, paymentStatus:order.paymentStatus, total:order.total, currency:order.currency, createdAt:order.createdAt, paidAt:order.paidAt || null, items:(order.items || []).map(item => ({ name:item.name, quantity:item.quantity })) };
}
function adminAuth(req, res, next) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token || !adminSessions.has(token)) return res.status(401).json({ error: 'Admin authentication required.' });
  req.admin = adminSessions.get(token);
  next();
}
function slugify(s) { return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function safeNumber(n, min = 0) { const v = Number(n); return Number.isFinite(v) ? Math.max(min, v) : min; }
function normalizeImages(images, fallback) { const list = Array.isArray(images) ? images : []; const all = [fallback, ...list].filter(v => typeof v === 'string' && /^https?:\/\//i.test(v.trim())).map(v => v.trim()); return [...new Set(all)].slice(0, 15); }
function normalizeProductPayload(body, existing = {}) {
  const originalPrice = safeNumber(body.originalPrice ?? body.price ?? existing.originalPrice ?? existing.price, 1);
  const saleInput = Object.prototype.hasOwnProperty.call(body, 'discountedPrice') ? body.discountedPrice : existing.discountedPrice;
  const rawSale = saleInput === '' || saleInput === null || saleInput === undefined ? null : safeNumber(saleInput);
  const discountedPrice = rawSale !== null && rawSale > 0 && rawSale < originalPrice ? rawSale : null;
  const images = normalizeImages(body.images ?? existing.images, body.image ?? existing.image);
  return {
    name:cleanText(body.name ?? existing.name, 160), description:cleanText(body.description ?? existing.description, 2000), category:cleanText(body.category ?? existing.category, 80), material:cleanText(body.material ?? existing.material ?? 'Made to order', 160),
    originalPrice, discountedPrice, price:discountedPrice ?? originalPrice, images, image:images[0] || '', customizable:body.customizable === undefined ? Boolean(existing.customizable) : Boolean(body.customizable), colors:Array.isArray(body.colors) ? body.colors.map(v => cleanText(v,80)).filter(Boolean).slice(0,30) : (existing.colors || []), fabrics:Array.isArray(body.fabrics) ? body.fabrics.map(v => cleanText(v,120)).filter(Boolean).slice(0,30) : (existing.fabrics || []), dimensions:{ width:safeNumber(body.dimensions?.width ?? existing.dimensions?.width,1), depth:safeNumber(body.dimensions?.depth ?? existing.dimensions?.depth,1), height:safeNumber(body.dimensions?.height ?? existing.dimensions?.height,1) }, stock:safeNumber(body.stock ?? existing.stock)
  };
}
function decorateProduct(product) {
  const images = normalizeImages(product.images, product.image);
  const originalPrice = safeNumber(product.originalPrice ?? product.price);
  const discountedPrice = product.discountedPrice && Number(product.discountedPrice) < originalPrice ? safeNumber(product.discountedPrice) : null;
  return { ...product, name:cleanText(product.name,160), description:cleanText(product.description,2000), originalPrice, discountedPrice, price:discountedPrice ?? originalPrice, images, image:images[0] || '' };
}
function readProducts() { return readJson(PRODUCTS_FILE).map(decorateProduct); }
function readCategories() { return readJson(CATEGORIES_FILE); }
function verifyRazorpaySignature(orderId, paymentId, signature) {
  if (!process.env.RAZORPAY_KEY_SECRET) return false;
  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
  const a = Buffer.from(expected); const b = Buffer.from(String(signature || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function rateLimit(limit, windowMs) {
  return (req, res, next) => {
    const key = `${req.ip}:${req.path}`;
    const nowMs = Date.now();
    const bucket = rateBuckets.get(key) || { startedAt:nowMs, count:0 };
    if (nowMs - bucket.startedAt >= windowMs) { bucket.startedAt = nowMs; bucket.count = 0; }
    bucket.count += 1; rateBuckets.set(key, bucket);
    if (bucket.count > limit) return res.status(429).json({ error:'Too many requests. Please try again shortly.' });
    next();
  };
}
function verifyWebhook(raw, signature) {
  if (!process.env.RAZORPAY_WEBHOOK_SECRET || !raw) return false;
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
  if (!order || !paymentId || !order.razorpayOrderId) return null;
  const current = findOrder(order.id);
  if (current?.paymentStatus === 'paid') return current;
  if (finalizingOrders.has(order.id)) return current || order;
  finalizingOrders.add(order.id);
  try {
    let updated = findOrder(order.id);
    if (!updated || updated.paymentStatus === 'paid') return updated;
    updated = updateOrder(updated.id, { paymentStatus:'paid', status:'confirmed', razorpayPaymentId:paymentId, paidAt:updated.paidAt || now() });
    if (updated && !updated.inventoryDeductedAt) {
      const products = readJson(PRODUCTS_FILE);
      for (const item of updated.items) {
        const product = products.find(x => x.id === item.id);
        if (product) product.stock = Math.max(0, Number(product.stock || 0) - Number(item.quantity || 0));
      }
      writeJson(PRODUCTS_FILE, products);
      updated = updateOrder(updated.id, { inventoryDeductedAt:now() });
    }
    if (updated) await sendConfirmationEmail(updated).catch(e => console.error('Email error', e));
    return updated;
  } finally { finalizingOrders.delete(order.id); }
}

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => { res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin'); res.setHeader('X-Content-Type-Options', 'nosniff'); next(); });
app.use(publicOrigin ? cors({ origin: publicOrigin }) : cors({ origin: false }));
app.post('/api/webhooks/razorpay', rateLimit(120, 60 * 1000), express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    if (!verifyWebhook(req.body, req.headers['x-razorpay-signature'])) return res.status(400).send('Invalid webhook signature');
    const payload = JSON.parse(req.body.toString('utf8'));
    const eventId = cleanText(req.headers['x-razorpay-event-id'], 120);
    const seen = readJson(EVENTS_FILE);
    if (eventId && seen.includes(eventId)) return res.status(200).send('ok');
    const payment = payload?.payload?.payment?.entity;
    const orderEntity = payload?.payload?.order?.entity;
    const rpOrderId = payment?.order_id || orderEntity?.id;
    const order = rpOrderId ? findOrder(rpOrderId) : null;
    if (order && ['payment.captured', 'order.paid'].includes(payload.event)) {
      const validCapture = payment && payment.id && payment.order_id === order.razorpayOrderId && payment.status === 'captured' && Number(payment.amount) === Number(order.amount || Number(order.total) * 100);
      if (!validCapture) return res.status(400).send('Payment/order validation failed');
      await markPaid(order, payment.id);
    } else if (order && order.paymentStatus !== 'paid' && payload.event === 'payment.failed' && payment?.order_id === order.razorpayOrderId) {
      updateOrder(order.id, { paymentStatus:'failed', status:'payment_failed', razorpayPaymentId:payment.id || null, failureReason:cleanText(payment.error_description || payment.error_code || 'Payment failed', 240) });
    }
    if (eventId) { seen.push(eventId); writeJson(EVENTS_FILE, seen.slice(-1000)); }
    res.status(200).send('ok');
  } catch (e) { console.error('Webhook processing error', e); res.status(500).send('Webhook processing failed'); }
});
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(ROOT, 'public')));

app.get('/api/config', (req,res) => res.json({ razorpayKeyId: razorpayReady ? process.env.RAZORPAY_KEY_ID : null, currency:storeCurrency, ready:razorpayReady }));
app.get('/api/products', (req,res) => res.json(readProducts()));
app.get('/api/categories', (req,res) => res.json(readCategories()));
app.get('/api/orders/status', (req,res) => res.status(405).json({ error:'Use POST with order reference and checkout email.' }));
app.get('/api/orders/:id', (req,res) => res.status(405).json({ error:'Order lookup requires POST with order reference and checkout email.' }));
app.post('/api/orders/status', rateLimit(20, 10 * 60 * 1000), (req,res) => {
  const id = cleanText(req.body?.orderId, 80);
  const email = normalizeEmail(req.body?.email);
  const order = findOrder(id);
  if (!order || !validEmail(email) || normalizeEmail(order.email) !== email) return res.status(404).json({ error:'Order not found.' });
  res.setHeader('Cache-Control', 'no-store');
  res.json(publicOrder(order));
});

app.post('/api/orders/create', rateLimit(10, 10 * 60 * 1000), async (req,res) => {
  try {
    if (!razorpayReady) return res.status(503).json({ error:'Payment service is not configured.' });
    const { items, shipping } = req.body || {};
    const email = normalizeEmail(req.body?.email);
    const idempotencyKey = cleanText(req.headers['x-idempotency-key'] || req.body?.idempotencyKey, 100);
    if (!idempotencyKey || !/^[A-Za-z0-9._:-]{16,100}$/.test(idempotencyKey)) return res.status(400).json({ error:'A valid payment request key is required. Please retry checkout.' });
    if (!Array.isArray(items) || !items.length || items.length > 50 || !validEmail(email)) return res.status(400).json({ error:'A valid email and at least one cart item are required.' });
    if (!shipping || !cleanText(shipping.name, 120) || !validPhone(shipping.phone) || !validPincode(shipping.pincode) || !cleanText(shipping.city, 80) || !cleanText(shipping.state, 80) || !cleanText(shipping.address1, 240)) return res.status(400).json({ error:'Complete customer and delivery details are required.' });
    const products = readJson(PRODUCTS_FILE); const orders = readJson(ORDERS_FILE);
    const cleanItems = items.map(item => {
      const p = products.find(x => x.id === item.id); if (!p) throw new Error('One of the selected products is no longer available.');
      const requested = Number(item.quantity); if (!Number.isInteger(requested) || requested < 1 || requested > 10) throw new Error(`Invalid quantity for ${p.name}.`);
      const reserved = reservedQuantity(orders, p.id); if (Number(p.stock || 0) - reserved < requested) throw new Error(`${p.name} is not available in the requested quantity.`);
      return { id:p.id, name:cleanText(p.name, 160), price:safeNumber(p.price), quantity:requested, image:String(p.image || ''), selectedColor:cleanText(item.selectedColor, 80) || null, selectedFabric:cleanText(item.selectedFabric, 120) || null };
    });
    const subtotal = cleanItems.reduce((s,i)=>s+i.price*i.quantity,0); const shippingFee = subtotal >= 100000 ? 0 : 2500; const total = subtotal + shippingFee;
    const fingerprint = orderFingerprint(email, cleanItems, total);
    const existing = orders.find(o => o.idempotencyKey === idempotencyKey);
    if (existing) {
      if (existing.idempotencyFingerprint !== fingerprint) return res.status(409).json({ error:'This checkout request key is already associated with different order details.' });
      if (existing.razorpayOrderId) return res.json({ orderId:existing.id, razorpayOrderId:existing.razorpayOrderId, amount:existing.amount || Number(existing.total) * 100, currency:existing.currency || storeCurrency, keyId:process.env.RAZORPAY_KEY_ID });
      if (existing.status !== 'payment_error' && existing.paymentStatus !== 'failed' && isActiveReservation(existing)) return res.status(409).json({ error:'This payment order is still being prepared. Please retry shortly.' });
      const staleIndex = orders.findIndex(o => o.id === existing.id); if (staleIndex >= 0) orders.splice(staleIndex, 1);
    }
    const receipt = `LEO-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const order = { id:receipt, idempotencyKey, idempotencyFingerprint:fingerprint, razorpayOrderId:null, email, shipping:{ name:cleanText(shipping.name,120), phone:cleanText(shipping.phone,30), pincode:cleanText(shipping.pincode,12), city:cleanText(shipping.city,80), state:cleanText(shipping.state,80), address1:cleanText(shipping.address1,240), address2:cleanText(shipping.address2,240) }, items:cleanItems, subtotal, shippingFee, total, amount:total * 100, currency:storeCurrency, status:'payment_pending', paymentStatus:'pending', reservationExpiresAt:new Date(Date.now() + paymentReservationMs).toISOString(), createdAt:now() };
    orders.push(order); writeJson(ORDERS_FILE, orders);
    try {
      const rp = await razorpay.orders.create({ amount:order.amount, currency:storeCurrency, receipt, payment_capture:1, notes:{ store_order_id:receipt } });
      const ready = updateOrder(order.id, { razorpayOrderId:rp.id });
      res.json({ orderId:receipt, razorpayOrderId:rp.id, amount:order.amount, currency:order.currency, keyId:process.env.RAZORPAY_KEY_ID });
      return ready;
    } catch (providerError) {
      updateOrder(order.id, { status:'payment_error', paymentStatus:'failed', reservationExpiresAt:now(), paymentError:cleanText(providerError.message || 'Payment provider error', 240) });
      throw providerError;
    }
  } catch(e) { console.error('Order creation error', e); res.status(e.message?.includes('not available') || e.message?.includes('Invalid quantity') ? 409 : 500).json({ error:e.message || 'Unable to create order.' }); }
});

app.post('/api/orders/verify', rateLimit(20, 10 * 60 * 1000), async (req,res) => {
  try {
    if (!razorpayReady) return res.status(503).json({ error:'Payment service is not configured.' });
    const { orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body || {};
    const order = findOrder(cleanText(orderId, 80));
    if (!order || order.razorpayOrderId !== cleanText(razorpayOrderId, 80)) return res.status(404).json({ error:'Order not found.' });
    if (!/^pay_[A-Za-z0-9]+$/.test(String(razorpayPaymentId || '')) || !/^[A-Za-z0-9+/=_-]{32,200}$/.test(String(razorpaySignature || ''))) return res.status(400).json({ error:'Invalid payment confirmation.' });
    if (!verifyRazorpaySignature(order.razorpayOrderId, razorpayPaymentId, razorpaySignature)) return res.status(400).json({ error:'Payment signature verification failed.' });
    const payment = await razorpay.payments.fetch(razorpayPaymentId);
    if (payment.id !== razorpayPaymentId || payment.order_id !== order.razorpayOrderId || Number(payment.amount) !== Number(order.amount || Number(order.total) * 100) || payment.currency !== (order.currency || storeCurrency)) return res.status(400).json({ error:'Payment/order validation failed.' });
    if (payment.status === 'captured' && payment.captured !== false) return res.json({ ok:true, order:publicOrder(await markPaid(order, razorpayPaymentId)) });
    updateOrder(order.id, { paymentStatus:cleanText(payment.status, 40), razorpayPaymentId });
    return res.status(409).json({ ok:false, error:`Payment is ${cleanText(payment.status, 40) || 'not captured'}.` });
  } catch(e) { console.error('Payment verification error', e); res.status(500).json({ error:'Unable to verify payment. Please contact support if your account was charged.' }); }
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

app.post('/api/admin/login', rateLimit(10, 10 * 60 * 1000), (req,res) => {
  const { email, password } = req.body || {};
  const configuredEmail = normalizeEmail(process.env.ADMIN_EMAIL);
  const configuredPassword = String(process.env.ADMIN_PASSWORD || '');
  if (!configuredEmail || !configuredPassword) return res.status(503).json({ error:'Admin access is not configured.' });
  const validEmail = normalizeEmail(email) === configuredEmail;
  const validPassword = String(password || '') === configuredPassword;
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
  const products = readProducts(); const customization = readJson(CUSTOM_FILE);
  res.json({ metrics:{ totalOrders:paid.length, totalSales:sales, avgOrder:paid.length?sales/paid.length:0, lowStock:products.filter(p=>Number(p.stock||0)<=5).length, customizationRequests:customization.filter(r=>r.status==='submitted').length }, months, recentOrders:orders.slice().sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,12), products, customizationRequests:customization.slice().sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,30) });
});

app.get('/api/admin/orders', adminAuth, (req,res) => res.json(readJson(ORDERS_FILE).slice().sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))));
app.get('/api/admin/inventory', adminAuth, (req,res) => res.json(readProducts()));
app.get('/api/admin/categories', adminAuth, (req,res) => res.json(readCategories()));
app.get('/api/admin/customizations', adminAuth, (req,res) => res.json(readJson(CUSTOM_FILE).slice().sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))));

app.post('/api/admin/products', adminAuth, (req,res) => {
  try {
    const body = req.body || {}; const payload = normalizeProductPayload(body);
    if (!payload.name || !payload.category || !payload.originalPrice || !payload.images.length) return res.status(400).json({ error:'Product name, category, regular price and at least one image are required.' });
    if (body.discountedPrice !== undefined && body.discountedPrice !== null && body.discountedPrice !== '' && Number(body.discountedPrice) >= payload.originalPrice) return res.status(400).json({ error:'Discounted price must be lower than regular price.' });
    const products = readJson(PRODUCTS_FILE); let id = slugify(body.id || payload.name); if(products.some(p=>p.id===id)) id += '-' + Date.now().toString(36);
    const p = { id, ...payload, createdAt:now(), updatedAt:now() };
    products.push(p); writeJson(PRODUCTS_FILE, products); res.status(201).json(decorateProduct(p));
  } catch(e){ console.error('Product create error', e); res.status(500).json({error:'Unable to add product.'}); }
});
app.put('/api/admin/products/:id', adminAuth, (req,res) => {
  try {
    const products=readJson(PRODUCTS_FILE); const i=products.findIndex(p=>p.id===req.params.id); if(i<0)return res.status(404).json({error:'Product not found'});
    const payload=normalizeProductPayload(req.body||{}, products[i]); if(!payload.name||!payload.category||!payload.originalPrice||!payload.images.length)return res.status(400).json({error:'Product name, category, regular price and at least one image are required.'});
    if (req.body?.discountedPrice !== undefined && req.body.discountedPrice !== null && req.body.discountedPrice !== '' && Number(req.body.discountedPrice) >= payload.originalPrice) return res.status(400).json({ error:'Discounted price must be lower than regular price.' });
    products[i]={...products[i],...payload,updatedAt:now()}; writeJson(PRODUCTS_FILE,products); res.json(decorateProduct(products[i]));
  } catch(e){ console.error('Product update error', e); res.status(500).json({error:'Unable to update product.'}); }
});
app.post('/api/admin/categories', adminAuth, (req,res) => {
  const name=cleanText(req.body?.name,80), description=cleanText(req.body?.description,240); if(!name)return res.status(400).json({error:'Category name is required.'});
  const categories=readCategories(); if(categories.some(c=>c.name.toLowerCase()===name.toLowerCase()))return res.status(409).json({error:'Category already exists.'});
  const category={id:slugify(name),name,description,createdAt:now()}; categories.push(category); writeJson(CATEGORIES_FILE,categories); res.status(201).json(category);
});
app.post('/api/admin/orders/:id/status', adminAuth, (req,res) => { const allowed=['payment_pending','confirmed','processing','packed','shipped','out_for_delivery','delivered','cancelled']; const status=req.body?.status; if(!allowed.includes(status))return res.status(400).json({error:'Invalid order status'}); const o=updateOrder(req.params.id,{status}); if(!o)return res.status(404).json({error:'Order not found'}); res.json(o); });
app.post('/api/admin/customizations/:id/status', adminAuth, (req,res) => { const allowed=['submitted','reviewing','quoted','approved','closed']; const status=req.body?.status; if(!allowed.includes(status))return res.status(400).json({error:'Invalid status'}); const arr=readJson(CUSTOM_FILE); const i=arr.findIndex(r=>r.id===req.params.id); if(i<0)return res.status(404).json({error:'Request not found'}); arr[i]={...arr[i],status,updatedAt:now()}; writeJson(CUSTOM_FILE,arr); res.json(arr[i]); });

app.get(['/admin', '/admin/*'], (req,res) => res.sendFile(path.join(ROOT, 'public', 'admin.html')));
app.post('/api/admin/cloudinary-signature', adminAuth, (req,res) => {
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) return res.status(503).json({ error:'Cloudinary is not configured on Render.' });
  const timestamp = Math.floor(Date.now() / 1000); const folder = 'leonora/products';
  const signature = crypto.createHash('sha1').update(`folder=${folder}&timestamp=${timestamp}` + process.env.CLOUDINARY_API_SECRET).digest('hex');
  res.json({ cloudName:process.env.CLOUDINARY_CLOUD_NAME, apiKey:process.env.CLOUDINARY_API_KEY, timestamp, folder, signature, uploadUrl:`https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload` });
});
app.__leonoraCloudinaryRoutes = true;
app.use('/api', (req,res) => res.status(404).json({ error:'API endpoint not found.' }));
app.get('/health', (req,res) => res.status(200).json({status:'ok'}));
app.get('*', (req,res) => res.sendFile(path.join(ROOT,'public','index.html')));
app.listen(PORT, '0.0.0.0', () => console.log(`Leonora running on 0.0.0.0:${PORT} — Razorpay ${razorpayReady?'ready':'not configured'}`));
