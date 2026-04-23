/**
 * FBA Listing Optimizer — Cloudflare Worker
 * Deploy: wrangler deploy
 *
 * KV namespace: FBA_OPTIMIZER_KV
 * Env vars: ANTHROPIC_API_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
};

const SYSTEM_PROMPT = `You are an expert Amazon FBA copywriter and SEO specialist. Your job is to optimize product listings to rank higher and convert better.

When given a product listing, you will:

1. TITLE: Rewrite to be keyword-rich, benefit-focused, and under 200 characters. Lead with the most important keyword. Include key attributes (size, material, quantity, color if relevant).

2. BULLETS (exactly 5): Each bullet must:
   - Start with a CAPITALIZED BENEFIT KEYWORD (e.g. "LEAKPROOF DESIGN —")
   - Lead with the benefit, then explain the feature
   - Include relevant keywords naturally
   - Be under 200 characters each
   - Be specific and credible, not vague

3. DESCRIPTION: Rewrite for conversion. 150-200 words. Use HTML paragraph tags. Tell a story about the customer's problem and how this product solves it. End with a clear call to action.

4. NOTES: 2-3 brief optimization notes explaining what you changed and why.

Always respond with valid JSON in this exact format:
{
  "optimized": {
    "title": "optimized title here",
    "bullets": ["bullet 1", "bullet 2", "bullet 3", "bullet 4", "bullet 5"],
    "description": "optimized description here",
    "notes": "brief notes about what was optimized and why"
  }
}`;

async function optimizeListing(env, { title, bullets, description }) {
  const userContent = [
    title ? `TITLE: ${title}` : '',
    bullets ? `BULLETS:\n${bullets}` : '',
    description ? `DESCRIPTION:\n${description}` : '',
  ].filter(Boolean).join('\n\n');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Please optimize this Amazon FBA listing:\n\n${userContent}` }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API error: ${response.status}`);
  }

  const data = await response.json();
  const text = data.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Could not parse optimization response');
  return JSON.parse(jsonMatch[0]);
}

function generateApiKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return 'fba_' + Array.from(arr).map(b => chars[b % chars.length]).join('');
}

async function handleOptimize(request, env) {
  const body = await request.json();
  const { title, bullets, description, free } = body;
  const apiKey = request.headers.get('X-API-Key');

  // Validate API key for paid users
  if (!free && apiKey) {
    const keyData = await env.FBA_OPTIMIZER_KV.get(`key:${apiKey}`);
    if (!keyData) {
      return Response.json({ error: 'Invalid or expired API key' }, { status: 401, headers: CORS_HEADERS });
    }
  }

  if (!title && !bullets) {
    return Response.json({ error: 'Please provide at least a title or bullet points' }, { status: 400, headers: CORS_HEADERS });
  }

  try {
    const result = await optimizeListing(env, { title, bullets, description });
    return Response.json(result, { headers: CORS_HEADERS });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500, headers: CORS_HEADERS });
  }
}

async function handleStripeWebhook(request, env) {
  const body = await request.text();
  const sig = request.headers.get('stripe-signature');

  // Verify Stripe webhook signature
  // In production, use proper HMAC verification
  // For now, parse the event directly
  let event;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_details?.email;
    const customerId = session.customer;

    if (email) {
      // Generate API key
      const apiKey = generateApiKey();

      // Store in KV: key -> customer info, email -> key
      await env.FBA_OPTIMIZER_KV.put(`key:${apiKey}`, JSON.stringify({
        email,
        customerId,
        created: new Date().toISOString(),
        active: true,
      }), { expirationTtl: 60 * 60 * 24 * 400 }); // ~13 months

      await env.FBA_OPTIMIZER_KV.put(`email:${email}`, apiKey);

      console.log(`New subscriber: ${email} | API Key: ${apiKey}`);

      // Send welcome email via Mailgun
      if (env.MAILGUN_API_KEY) {
        await fetch('https://api.mailgun.net/v3/threshside.com/messages', {
          method: 'POST',
          headers: { 'Authorization': 'Basic ' + btoa('api:' + env.MAILGUN_API_KEY) },
          body: new URLSearchParams({
            from: 'FBA Tools <tools@threshside.com>',
            to: email,
            subject: 'Your FBA Listing Optimizer API Key',
            text: `Hi,\n\nWelcome to FBA Listing Optimizer!\n\nYour API key: ${apiKey}\n\nTo activate:\n1. Go to https://tools.threshside.com\n2. Click "Have an API key?" at the top\n3. Paste your key and click Save\n\nYou now have unlimited optimizations. Questions? Reply to this email.\n\n— Threshside Team\nhttps://threshside.com`
          })
        });
      }
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    const customerId = subscription.customer;
    // Mark key as inactive
    // In production: look up by customerId and deactivate
    console.log(`Subscription cancelled: ${customerId}`);
  }

  return new Response('OK', { status: 200 });
}

async function handleCheckKey(request, env) {
  const apiKey = request.headers.get('X-API-Key') || new URL(request.url).searchParams.get('key');
  if (!apiKey) return Response.json({ valid: false }, { headers: CORS_HEADERS });

  const keyData = await env.FBA_OPTIMIZER_KV.get(`key:${apiKey}`);
  if (!keyData) return Response.json({ valid: false }, { headers: CORS_HEADERS });

  const data = JSON.parse(keyData);
  return Response.json({ valid: data.active, email: data.email }, { headers: CORS_HEADERS });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (request.method === 'POST' && url.pathname === '/optimize') {
      return handleOptimize(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/webhook') {
      return handleStripeWebhook(request, env);
    }

    if (request.method === 'GET' && url.pathname === '/check-key') {
      return handleCheckKey(request, env);
    }

    return new Response('FBA Listing Optimizer API', { headers: CORS_HEADERS });
  },
};
