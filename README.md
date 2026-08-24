# Leonora Furniture Studio

Complete luxury furniture e-commerce store with customer storefront, Living / Bedroom / Dining / Office collections, product customisation, cart and checkout, Razorpay-ready UPI/card payments, automated order confirmation hooks, and a separate commerce admin dashboard.

## Deployment

Use Node 18+ and run `npm install && npm start`. Configure the environment variables in `.env`. For Render, use a Node web service and set the start command to `npm start`.

## Payments

Razorpay Order creation, server-side signature verification and webhook handling are included. Configure `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET` before enabling live payments.

## Email

Configure SMTP values to automatically send order confirmation and customisation acknowledgement emails.

## Admin

Open `/admin`. Change the default admin credentials in production.
