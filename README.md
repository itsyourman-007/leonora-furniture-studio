# Leonora Furniture Studio

Complete luxury furniture e-commerce store with customer storefront, Living / Bedroom / Dining / Office collections, product customisation, cart and checkout, Razorpay UPI/card payments, automated order confirmation hooks, and a separate commerce admin dashboard.

## Deployment

Use Node 18+ and run `npm install && npm start`. Configure the environment variables in `.env`. For Render, use a Node web service and set the start command to `npm start`.

Set `PUBLIC_ORIGIN` to the exact public HTTPS origin of the storefront, without a trailing slash. Set explicit `ADMIN_EMAIL` and `ADMIN_PASSWORD` values; the server has no fallback administrator credentials.

## Payments

The payment flow creates Razorpay Orders only on the server, calculates prices from the server-side product catalogue, reserves stock for a short payment window, accepts an idempotency key to prevent duplicate provider orders, and never trusts client-submitted totals. Configure `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET` before enabling payments. The service stays unavailable until all three values are configured.

The checkout handler verifies the Razorpay signature on the server using the stored provider order ID, fetches the payment from Razorpay, validates its order ID, amount, currency, and captured status, and only then marks the local order paid and deducts inventory. Webhooks reconcile `payment.captured`, `order.paid`, and `payment.failed` events with raw-body signature validation and event de-duplication.

Configure the Razorpay webhook URL as `https://YOUR_PUBLIC_ORIGIN/api/webhooks/razorpay` and subscribe to `payment.captured`, `order.paid`, and `payment.failed`. Configure separate Test Mode and Live Mode webhook endpoints/secrets in Razorpay. Test the complete flow with Test Mode keys and a test payment before switching to Live Mode keys.

Customers can check an order only by providing both the order reference and the email used at checkout. The status endpoint returns a minimal order summary and does not expose address, phone, payment IDs, or internal order fields.

## Email

Configure SMTP values to automatically send order confirmation and customisation acknowledgement emails. Email delivery is a secondary notification; payment state is determined by verified Razorpay responses and webhooks.

## Admin

Open `/admin`. Production access requires the explicit `ADMIN_EMAIL` and `ADMIN_PASSWORD` environment variables. Change or rotate them before launch, and keep all Razorpay, SMTP, and storage secrets server-side.
