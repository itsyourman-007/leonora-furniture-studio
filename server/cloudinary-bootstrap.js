const express = require('express');
const crypto = require('crypto');
const originalListen = express.application.listen;

if (!express.application.__leonoraCloudinaryPatched) {
  express.application.listen = function (...args) {
    const app = this;
    if (!app.__leonoraCloudinaryRoutes) {
      app.post('/api/admin/cloudinary-signature', async (req, res) => {
        try {
          const auth = String(req.headers.authorization || '');
          if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Admin authentication required.' });
          if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
            return res.status(503).json({ error: 'Cloudinary is not configured on Render.' });
          }
          const check = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/admin/orders`, { headers: { Authorization: auth } });
          if (!check.ok) return res.status(401).json({ error: 'Admin session expired.' });
          const timestamp = Math.floor(Date.now() / 1000);
          const folder = 'leonora/products';
          const signature = crypto.createHash('sha1')
            .update(`folder=${folder}&timestamp=${timestamp}` + process.env.CLOUDINARY_API_SECRET)
            .digest('hex');
          res.json({
            cloudName: process.env.CLOUDINARY_CLOUD_NAME,
            apiKey: process.env.CLOUDINARY_API_KEY,
            timestamp,
            folder,
            signature,
            uploadUrl: `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload`
          });
        } catch (error) {
          console.error('Cloudinary signature error', error);
          res.status(500).json({ error: 'Unable to prepare image upload.' });
        }
      });
      app.__leonoraCloudinaryRoutes = true;
    }
    return originalListen.apply(this, args);
  };
  express.application.__leonoraCloudinaryPatched = true;
}
