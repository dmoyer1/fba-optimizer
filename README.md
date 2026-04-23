# FBA Listing Optimizer — tools.threshside.com

$19/month SaaS tool for Amazon FBA sellers. Paste a listing, get an AI-optimized version.

## Architecture

- **Frontend:** `index.html` — single static file, deploy to Cloudflare Pages
- **Backend:** `worker.js` — Cloudflare Worker (serverless, ~$0 cost at low volume)
- **Database:** Cloudflare KV — stores API keys and subscriber info
- **Payments:** Stripe Checkout
- **AI:** Anthropic claude-haiku (~$0.001 per optimization)

## Setup (one-time, ~30 minutes)

### 1. Create Cloudflare KV Namespace

```bash
npx wrangler kv namespace create FBA_OPTIMIZER_KV
```

Copy the `id` it gives you and paste it into `wrangler.toml`.

### 2. Deploy the Cloudflare Worker

```bash
npm install -g wrangler
wrangler login
wrangler deploy
```

Note the worker URL it gives you (e.g. `fba-optimizer.threshside.workers.dev`).
Update `WORKER_URL` in `index.html` with this URL.

### 3. Set Worker Secrets

```bash
wrangler secret put ANTHROPIC_API_KEY
# paste your Anthropic API key

wrangler secret put STRIPE_SECRET_KEY
# paste your Stripe secret key (sk_live_...)

wrangler secret put STRIPE_WEBHOOK_SECRET
# paste after setting up webhook (see step 5)
```

### 4. Create Stripe Product

1. Go to stripe.com → Products → Add product
2. Name: "FBA Listing Optimizer"
3. Price: $19/month recurring
4. Save — copy the **Payment Link** URL
5. Update `STRIPE_LINK` in `index.html` with this URL

### 5. Set up Stripe Webhook

1. Stripe Dashboard → Developers → Webhooks → Add endpoint
2. URL: `https://fba-optimizer.threshside.workers.dev/webhook`
3. Events: `checkout.session.completed`, `customer.subscription.deleted`
4. Copy the webhook signing secret
5. Run: `wrangler secret put STRIPE_WEBHOOK_SECRET` and paste it

### 6. Deploy Frontend to Cloudflare Pages

Option A — subdomain of threshside.com:
1. Cloudflare Dashboard → Pages → Create project
2. Connect to a GitHub repo containing just `index.html`
3. Set custom domain: `tools.threshside.com`

Option B — quick test (no Pages):
Just open `index.html` in a browser locally. The worker handles the API.

### 7. Add DNS Record

In Cloudflare DNS for threshside.com:
- Type: CNAME
- Name: tools
- Target: your-pages-project.pages.dev (or worker URL)
- Proxy: ON

## Costs

| Item | Cost |
|------|------|
| Cloudflare Worker | Free (100K req/day free tier) |
| Cloudflare KV | Free (100K reads/day free tier) |
| Cloudflare Pages | Free |
| Anthropic (Haiku) | ~$0.001 per optimization |
| Stripe | 2.9% + $0.30 per transaction |

At 50 subscribers ($950 MRR): ~$28/month Stripe fees + ~$2 AI costs = ~$920 net.

## Email API Keys to Customers

Currently the worker logs the API key to Cloudflare Worker logs.
To check: Cloudflare Dashboard → Workers → fba-optimizer → Logs.

To automate emails, add Mailgun or Resend:
```js
// In worker.js handleStripeWebhook, after generating apiKey:
await fetch('https://api.mailgun.net/v3/threshside.com/messages', {
  method: 'POST',
  headers: { Authorization: 'Basic ' + btoa('api:' + env.MAILGUN_API_KEY) },
  body: new URLSearchParams({
    from: 'tools@threshside.com',
    to: email,
    subject: 'Your FBA Listing Optimizer API Key',
    text: `Welcome!\n\nYour API key: ${apiKey}\n\nPaste this at tools.threshside.com to unlock unlimited optimizations.\n\n— Threshside`
  })
});
```

## Revenue Projection

| Subscribers | MRR | Annual |
|-------------|-----|--------|
| 10 | $190 | $2,280 |
| 50 | $950 | $11,400 |
| 100 | $1,900 | $22,800 |
| 500 | $9,500 | $114,000 |
