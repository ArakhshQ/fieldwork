// Who may use paid AI features, and how much.
//
// Two ways in:
//  1. Preview codes (PRO_PREVIEW_CODES, comma-separated) for the owner and
//     testers before accounts and billing are live. Usage is counted in memory.
//  2. A signed-in student with an active Paddle subscription. The server checks
//     the Supabase session, reads the subscription with the student's own
//     token (row-level security), and counts usage with a database function the
//     student cannot reset.
// A daily AI budget (AI_DAILY_BUDGET_USD) caps total spend no matter what.
import { createHash, timingSafeEqual } from 'node:crypto';

export const LIMITS = {
  // Per student per calendar month. Keep in sync with supabase/003_tools.sql.
  // Worst case at these caps is about $16 of AI per Pro student; typical use is far lower.
  pro: { briefing: 30, email: 60, review: 15, application: 15, interview: 10, chat: 150, import: 10, letter: 10 },
  preview: { briefing: 15, email: 30, review: 8, application: 8, interview: 5, chat: 60, import: 5, letter: 5 },
};

const sha = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
const same = (a, b) => {
  const x = Buffer.from(a || ''),
    y = Buffer.from(b || '');
  return x.length === y.length && timingSafeEqual(x, y);
};
const month = (now) => new Date(now).toISOString().slice(0, 7);

export function createPro({ env = {}, fetchImpl = fetch, now = () => Date.now() } = {}) {
  const codes = String(env.PRO_PREVIEW_CODES || '')
    .split(',')
    .map((c) => c.trim())
    .filter((c) => c.length >= 8);
  const supabaseUrl = env.SUPABASE_URL ? String(env.SUPABASE_URL).replace(/\/+$/, '') : '';
  const supabaseKey = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || '';
  const budget = Number(env.AI_DAILY_BUDGET_USD) || 10;
  const counts = new Map();
  let spendDay = '';
  let spent = 0;

  async function supabase(path, token, init = {}) {
    const res = await fetchImpl(`${supabaseUrl}${path}`, {
      ...init,
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}`);
    return res.status === 204 ? null : res.json();
  }

  /** @returns {Promise<null | {kind, id, plan, token?}>} */
  async function identify(req) {
    const code = String(req.headers['x-pro-code'] || '').trim();
    if (code && codes.some((c) => same(c, code))) return { kind: 'preview', id: `code:${sha(code)}`, plan: 'preview' };
    const auth = String(req.headers.authorization || '');
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!token || !supabaseUrl || !supabaseKey) return null;
    try {
      const user = await supabase('/auth/v1/user', token);
      if (!user?.id) return null;
      const rows = await supabase(
        `/rest/v1/subscriptions?select=status,plan,current_period_end&user_id=eq.${encodeURIComponent(user.id)}`,
        token,
      );
      const active = (rows || []).some(
        (r) =>
          ['active', 'trialing', 'past_due'].includes(r.status) &&
          (!r.current_period_end || new Date(r.current_period_end).valueOf() > now()),
      );
      return active ? { kind: 'subscriber', id: user.id, plan: 'pro', token } : { kind: 'free', id: user.id, plan: 'free' };
    } catch {
      return null;
    }
  }

  /** Reserve one use of an action. Returns {ok, remaining} or {ok:false, reason}. */
  async function consume(who, action) {
    const day = new Date(now()).toISOString().slice(0, 10);
    if (day !== spendDay) {
      spendDay = day;
      spent = 0;
    }
    if (spent >= budget) return { ok: false, reason: 'budget' };
    if (who.kind === 'preview') {
      const cap = LIMITS.preview[action];
      if (!cap) return { ok: false, reason: 'limit', cap: 0 };
      const key = `${who.id}:${month(now())}:${action}`;
      const used = counts.get(key) || 0;
      if (used >= cap) return { ok: false, reason: 'limit', cap };
      counts.set(key, used + 1);
      return { ok: true, remaining: cap - used - 1 };
    }
    if (who.kind === 'subscriber') {
      try {
        const r = await supabase('/rest/v1/rpc/consume_ai_quota', who.token, {
          method: 'POST',
          body: JSON.stringify({ p_action: action }),
        });
        const row = Array.isArray(r) ? r[0] : r;
        return row?.allowed ? { ok: true, remaining: row.remaining } : { ok: false, reason: 'limit', cap: LIMITS.pro[action] };
      } catch {
        return { ok: false, reason: 'unavailable' };
      }
    }
    return { ok: false, reason: 'not_pro' };
  }

  function record(cost) {
    spent += Number(cost) || 0;
  }

  async function remaining(who) {
    if (who?.kind === 'preview') {
      const m = month(now());
      return Object.fromEntries(
        Object.entries(LIMITS.preview).map(([a, cap]) => [a, cap - (counts.get(`${who.id}:${m}:${a}`) || 0)]),
      );
    }
    if (who?.kind === 'subscriber') {
      try {
        const rows = await supabase(
          `/rest/v1/ai_usage?select=action,count&month=eq.${month(now())}`,
          who.token,
        );
        return Object.fromEntries(
          Object.entries(LIMITS.pro).map(([a, cap]) => [a, cap - ((rows || []).find((r) => r.action === a)?.count || 0)]),
        );
      } catch {
        return null;
      }
    }
    return null;
  }

  return { identify, consume, record, remaining, previewEnabled: codes.length > 0, spentToday: () => spent };
}
