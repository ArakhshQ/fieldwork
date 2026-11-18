// Paddle Billing: webhook signature checks and subscription sync to Supabase.
// Docs: https://developer.paddle.com/webhooks/about/signature-verification/
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Paddle's client config for the browser, or null when billing isn't set up. */
export function paddleConfig(env) {
  const token = env.PADDLE_CLIENT_TOKEN || '';
  const monthly = env.PADDLE_PRICE_MONTHLY || '';
  const season = env.PADDLE_PRICE_SEASON || '';
  if (!/^(test|live)_[A-Za-z0-9]+$/.test(token) || !/^pri_[a-z0-9]+$/.test(monthly)) return null;
  return {
    environment: token.startsWith('test_') ? 'sandbox' : 'production',
    token,
    prices: { monthly, ...(/^pri_[a-z0-9]+$/.test(season) ? { season } : {}) },
  };
}

/**
 * Check a Paddle-Signature header ("ts=...;h1=...") against the raw body.
 * Paddle's SDKs allow 5 seconds; we allow 30 to absorb small clock drift.
 */
export function verifyPaddleSignature(rawBody, header, secret, { now = Date.now(), toleranceSec = 30 } = {}) {
  if (!secret || !header || typeof rawBody !== 'string') return false;
  const parts = Object.fromEntries(
    String(header)
      .split(';')
      .map((p) => p.split('='))
      .filter((kv) => kv.length === 2)
      .map(([k, v]) => [k.trim(), v.trim()]),
  );
  const h1s = String(header)
    .split(';')
    .map((p) => p.trim())
    .filter((p) => p.startsWith('h1='))
    .map((p) => p.slice(3));
  const ts = Number(parts.ts);
  if (!Number.isFinite(ts) || !h1s.length) return false;
  if (Math.abs(now / 1000 - ts) > toleranceSec) return false;
  const expected = createHmac('sha256', secret).update(`${parts.ts}:${rawBody}`).digest('hex');
  return h1s.some((h) => {
    const a = Buffer.from(h, 'hex');
    const b = Buffer.from(expected, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Turn a subscription.* event into a row for public.subscriptions, or null to ignore. */
export function subscriptionRow(event, env) {
  if (!/^subscription\./.test(event?.event_type || '')) return null;
  const d = event.data || {};
  const userId = d.custom_data?.user_id;
  if (!d.id || !UUID.test(String(userId || ''))) return null;
  const priceId = d.items?.[0]?.price?.id || '';
  return {
    paddle_subscription_id: String(d.id),
    user_id: String(userId),
    paddle_customer_id: d.customer_id ? String(d.customer_id) : null,
    plan: priceId && priceId === env.PADDLE_PRICE_SEASON ? 'season' : 'monthly',
    price_id: priceId || null,
    status: String(d.status || 'unknown'),
    current_period_end: d.current_billing_period?.ends_at || null,
    event_time: event.occurred_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/** Upsert the row with the server's secret key, ignoring events older than what's stored. */
export async function saveSubscription(row, env, fetchImpl = fetch) {
  const base = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = env.SUPABASE_SECRET_KEY || '';
  if (!base || !key) throw new Error('Supabase secret key is not configured');
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const existing = await fetchImpl(
    `${base}/rest/v1/subscriptions?select=event_time&paddle_subscription_id=eq.${encodeURIComponent(row.paddle_subscription_id)}`,
    { headers, signal: AbortSignal.timeout(10000) },
  ).then((r) => (r.ok ? r.json() : []));
  const stored = existing?.[0]?.event_time;
  if (stored && new Date(stored) > new Date(row.event_time)) return 'stale';
  const res = await fetchImpl(`${base}/rest/v1/subscriptions?on_conflict=paddle_subscription_id`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(row),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  return 'saved';
}
