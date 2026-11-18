import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { createSearchService, SearchError } from './lib/search.mjs';
import { createCatalog } from './lib/internships.mjs';
import { createResearchCatalog } from './lib/research.mjs';
import { dataUrlFor } from './lib/datasets.mjs';
import { createAi, AiError } from './lib/ai.mjs';
import { createPro } from './lib/pro.mjs';
import { gatherLab, writeBriefing, writeEmail } from './lib/outreach.mjs';
import { paddleConfig, verifyPaddleSignature, subscriptionRow, saveSubscription } from './lib/paddle.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

// Only these file types are ever served from /public. Anything else is a 404.
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
};
// Friendly URLs for the policy pages.
const ALIASES = {
  '/': '/index.html',
  '/terms': '/terms.html',
  '/privacy': '/privacy.html',
  '/subscriptions': '/subscriptions.html',
  '/upgrade': '/upgrade.html',
};

const equal = (a, b) => {
  const aa = Buffer.from(a || ''),
    bb = Buffer.from(b || '');
  return aa.length === bb.length && timingSafeEqual(aa, bb);
};

/** The Supabase project origin, only if it is a well-formed https URL. */
export function supabaseOrigin(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password ? u.origin : null;
  } catch {
    return null;
  }
}

/** The checkout page alone may load Paddle's script and checkout frame. */
export function upgradeHeaders(env) {
  const base = securityHeaders(env);
  const supabase = supabaseOrigin(env.SUPABASE_URL);
  return {
    ...base,
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self' https://cdn.paddle.com",
      "style-src 'self' 'unsafe-inline' https://cdn.paddle.com",
      "font-src 'self' https://cdn.paddle.com",
      "img-src 'self' data: https://*.paddle.com",
      "frame-src https://buy.paddle.com https://sandbox-buy.paddle.com",
      `connect-src 'self' https://*.paddle.com ${supabase || ''}`.trim(),
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  };
}

export function securityHeaders(env) {
  const supabase = supabaseOrigin(env.SUPABASE_URL);
  const connect = ["'self'", supabase].filter(Boolean).join(' ');
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "font-src 'self'",
      "img-src 'self' data:",
      `connect-src ${connect}`,
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  };
}

/** Map a request path to a file inside /public, or null if it must not be served. */
export function resolveStatic(pathname) {
  let p;
  try {
    p = decodeURIComponent(ALIASES[pathname] || pathname);
  } catch {
    return null;
  }
  if (p.includes('\0') || p.split('/').some((part) => part.startsWith('.'))) return null;
  const ext = path.extname(p).toLowerCase();
  if (!MIME[ext]) return null;
  const file = path.resolve(root, '.' + p);
  if (!file.startsWith(root + path.sep)) return null;
  return { file, mime: MIME[ext], immutable: /^\/(vendor|fonts)\//.test(p) };
}

export function createApp({
  env = process.env,
  search = createSearchService({ apiKey: env.TAVILY_API_KEY }),
  catalog = createCatalog({ remoteBase: dataUrlFor(env) }),
  research = createResearchCatalog({ remoteBase: dataUrlFor(env) }),
  ai = createAi({ apiKey: env.ANTHROPIC_API_KEY }),
  pro = createPro({ env }),
  fetchImpl = fetch,
  clock = () => Date.now(),
} = {}) {
  let active = 0,
    day = '',
    daily = 0;
  const rates = new Map();
  const catalogRates = new Map();
  const maxDaily = Number(env.MAX_SEARCHES_PER_DAY) || 100,
    maxConcurrent = Number(env.MAX_CONCURRENT_SEARCHES) || 3;
  const headers = securityHeaders(env);
  const checkoutHeaders = upgradeHeaders(env);
  const paddle = paddleConfig(env);
  const gatherCache = new Map(); // labId -> { at, value }; saves repeat lookups for 24 h

  async function readBody(req, limit) {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (Buffer.byteLength(raw) > limit) throw Object.assign(new Error('Request is too large.'), { status: 413 });
    }
    return raw;
  }
  const sameOrigin = (req) => {
    const origin = req.headers.origin;
    if (!origin) return true;
    try {
      return new URL(origin).host === req.headers.host;
    } catch {
      return false;
    }
  };
  const proError = {
    not_pro: [402, 'This is a Pro feature.', 'pro_required'],
    limit: [429, 'You’ve used this month’s Pro allowance for this. It resets on the 1st.', 'pro_limit'],
    budget: [503, 'Pro features are paused for today. Try again tomorrow.', 'pro_paused'],
    unavailable: [503, 'Couldn’t check your Pro plan. Try again.', 'pro_unavailable'],
  };
  const supabaseUrl = supabaseOrigin(env.SUPABASE_URL);
  const supabaseKey = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || '';

  return http.createServer(async (req, res) => {
    const send = (status, data) => {
      res.writeHead(status, {
        ...headers,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(data));
    };
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/health')
      return send(200, { status: 'ok', searchConfigured: !!env.TAVILY_API_KEY });

    if (req.method === 'GET' && (url.pathname === '/api/internships' || url.pathname === '/api/research')) {
      // Free catalog searches: no provider calls, so only a light per-address limit.
      const ip = req.socket.remoteAddress || 'unknown';
      const b = catalogRates.get(ip) || { count: 0, until: clock() + 60000 };
      if (clock() > b.until) Object.assign(b, { count: 0, until: clock() + 60000 });
      if (++b.count > 90) return send(429, { error: 'Too many searches. Wait a minute.', code: 'rate_limited' });
      catalogRates.set(ip, b);
      if (catalogRates.size > 10000) for (const [k, v] of catalogRates) if (v.until < clock()) catalogRates.delete(k);
      const param = (k, max) => (url.searchParams.get(k) || '').replace(/[\x00-\x1f]/g, ' ').trim().slice(0, max);
      const query = {
        q: param('q', 240),
        city: param('city', 80),
        state: param('state', 40),
        radius: Math.min(Math.max(Number.parseInt(param('radius', 4), 10) || 0, 0), 500),
        remote: url.searchParams.get('remote') === 'true',
        season: param('season', 40),
      };
      try {
        const data =
          url.pathname === '/api/research'
            ? await research.search({ ...query, limit: 60 })
            : await catalog.search({ ...query, limit: 80 });
        return send(200, data);
      } catch {
        return send(500, { error: 'Search failed. Try again.' });
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/paddle/webhook') {
      let raw;
      try {
        raw = await readBody(req, 256 * 1024);
      } catch {
        return send(413, { error: 'Too large.' });
      }
      if (!verifyPaddleSignature(raw, req.headers['paddle-signature'], env.PADDLE_WEBHOOK_SECRET, { now: clock() }))
        return send(401, { error: 'Bad signature.' });
      let event;
      try {
        event = JSON.parse(raw);
      } catch {
        return send(400, { error: 'Invalid JSON.' });
      }
      const row = subscriptionRow(event, env);
      if (!row) return send(200, { ok: true, ignored: true });
      try {
        await saveSubscription(row, env, fetchImpl);
        return send(200, { ok: true });
      } catch (e) {
        console.error('Paddle webhook save failed:', e.message);
        return send(500, { error: 'Could not save.' }); // Paddle retries
      }
    }

    if (req.method === 'GET' && url.pathname === '/api/pro/status') {
      const who = await pro.identify(req);
      return send(200, {
        aiReady: ai.enabled,
        plan: who?.plan || null,
        remaining: who && who.plan !== 'free' ? await pro.remaining(who) : null,
      });
    }

    if (req.method === 'POST' && (url.pathname === '/api/pro/briefing' || url.pathname === '/api/pro/email')) {
      if (!sameOrigin(req)) return send(403, { error: 'Cross-origin requests are not allowed.' });
      if (!String(req.headers['content-type'] || '').startsWith('application/json'))
        return send(415, { error: 'Send JSON.' });
      if (!ai.enabled) return send(503, { error: 'Pro features aren’t switched on yet.', code: 'ai_not_configured' });
      let input;
      try {
        input = JSON.parse(await readBody(req, 24 * 1024));
      } catch (e) {
        return send(e.status || 400, { error: e.status ? e.message : 'Invalid JSON.' });
      }
      const who = await pro.identify(req);
      if (!who || who.plan === 'free') return send(402, { error: proError.not_pro[1], code: 'pro_required' });
      const lab = await research.findLab(String(input.labId || ''));
      if (!lab) return send(404, { error: 'That lab isn’t in our list anymore. Search again.' });
      const action = url.pathname.endsWith('briefing') ? 'briefing' : 'email';
      const quota = await pro.consume(who, action);
      if (!quota.ok) {
        const [status, error, code] = proError[quota.reason] || proError.unavailable;
        return send(status, { error, code });
      }
      const profile = input.profile && typeof input.profile === 'object' ? input.profile : {};
      const resume = typeof input.resume === 'string' ? input.resume.slice(0, 6000) : '';
      try {
        if (action === 'briefing') {
          let cached = gatherCache.get(lab.id);
          if (!cached || clock() - cached.at > 86400000) {
            cached = {
              at: clock(),
              value: await gatherLab(lab, { fetchImpl, tavilyKey: env.TAVILY_API_KEY, mailto: env.CONTACT_EMAIL }),
            };
            gatherCache.set(lab.id, cached);
            if (gatherCache.size > 300) gatherCache.delete(gatherCache.keys().next().value);
          }
          const g = cached.value;
          const { briefing, cost } = await writeBriefing(ai, lab, g, profile, resume);
          pro.record(cost);
          console.log(`AI briefing ${lab.id} $${cost.toFixed(4)} (${who.kind})`);
          return send(200, {
            briefing,
            emails: g.emails,
            labUrl: g.labUrl,
            papers: g.papers.map(({ title, year, venue, url: link }) => ({ title, year, venue, url: link })),
            remaining: quota.remaining,
          });
        }
        const briefing = input.briefing && typeof input.briefing === 'object' ? input.briefing : {};
        const { email, cost } = await writeEmail(ai, lab, briefing, profile, resume, {
          kind: input.kind === 'followup' ? 'followup' : 'first',
          previous: typeof input.previous === 'string' ? input.previous : '',
        });
        pro.record(cost);
        console.log(`AI email ${lab.id} $${cost.toFixed(4)} (${who.kind})`);
        return send(200, { email, remaining: quota.remaining });
      } catch (e) {
        if (e instanceof AiError) return send(e.status, { error: e.message, code: e.code });
        console.error('Pro request failed:', e);
        return send(500, { error: 'Something went wrong. Try again.' });
      }
    }

    if (req.method === 'GET' && url.pathname === '/api/config')
      return send(200, {
        searchConfigured: !!env.TAVILY_API_KEY,
        accessCodeRequired: !!env.SEARCH_ACCESS_CODE,
        // Publishable values only: safe for the browser by design.
        accounts:
          supabaseUrl && supabaseKey ? { url: supabaseUrl, key: supabaseKey } : null,
        internships: await catalog.info().catch(() => ({ size: 0, generatedAt: null })),
        research: await research.info().catch(() => ({ programs: 0, labs: 0, generatedAt: null })),
        pro: { ai: ai.enabled, preview: pro.previewEnabled, checkout: paddle },
      });

    if (req.method === 'POST' && url.pathname === '/api/search') {
      const origin = req.headers.origin;
      if (origin) {
        try {
          if (new URL(origin).host !== req.headers.host)
            return send(403, { error: 'Cross-origin searches are not allowed.' });
        } catch {
          return send(403, { error: 'Invalid origin.' });
        }
      }
      if (
        env.SEARCH_ACCESS_CODE &&
        !equal(req.headers['x-search-access-code'], env.SEARCH_ACCESS_CODE)
      )
        return send(401, { error: 'Enter the beta access code.', code: 'access_required' });
      if (!String(req.headers['content-type'] || '').startsWith('application/json'))
        return send(415, { error: 'Send JSON.' });
      let raw = '';
      try {
        for await (const chunk of req) {
          raw += chunk;
          if (Buffer.byteLength(raw) > 4096)
            throw new SearchError('Search request is too large.', 413);
        }
      } catch (e) {
        return send(e.status || 400, { error: e.message });
      }
      let input;
      try {
        input = JSON.parse(raw);
      } catch {
        return send(400, { error: 'Invalid JSON.' });
      }
      const today = new Date(clock()).toISOString().slice(0, 10);
      if (day !== today) {
        daily = 0;
        day = today;
      }
      // Deliberately ignore untrusted forwarded IP headers. Behind a proxy this is a conservative shared limit.
      const ip = req.socket.remoteAddress || 'unknown',
        bucket = rates.get(ip) || { count: 0, until: clock() + 60000 };
      if (clock() > bucket.until) {
        bucket.count = 0;
        bucket.until = clock() + 60000;
      }
      if (bucket.count >= 10 || daily >= maxDaily)
        return send(429, {
          error: 'Search limit reached. Try again later.',
          code: 'rate_limited',
        });
      if (active >= maxConcurrent)
        return send(429, {
          error: 'A few searches are already running. Try again in a moment.',
          code: 'busy',
        });
      if (!env.TAVILY_API_KEY)
        return send(503, {
          error: 'Search is temporarily unavailable. Try again later.',
          code: 'setup_required',
        });
      bucket.count++;
      rates.set(ip, bucket);
      daily++;
      active++;
      if (rates.size > 10000) for (const [k, v] of rates) if (v.until < clock()) rates.delete(k);
      try {
        const data = await search(input);
        return send(200, data);
      } catch (e) {
        return send(e.status || 500, {
          error: e instanceof SearchError ? e.message : 'Search could not complete. Try again.',
          code: e.code || 'search_failed',
        });
      } finally {
        active--;
      }
    }

    if (req.method !== 'GET' && req.method !== 'HEAD')
      return send(405, { error: 'Method not allowed.' });

    const target = resolveStatic(url.pathname);
    if (!target) return send(404, { error: 'Not found.' });
    let bytes;
    try {
      bytes = await readFile(target.file);
    } catch {
      return send(404, { error: 'Not found.' });
    }
    res.writeHead(200, {
      ...(url.pathname === '/upgrade' || url.pathname === '/upgrade.html' ? checkoutHeaders : headers),
      'Content-Type': target.mime,
      'Cache-Control': target.immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const portArg = process.argv.indexOf('--port');
  const hostArg = process.argv.indexOf('--host');
  const port =
    Number(process.env.PORT) || (portArg >= 0 ? Number(process.argv[portArg + 1]) : 3000);
  const host = hostArg >= 0 ? process.argv[hostArg + 1] : '0.0.0.0';
  const app = createApp();
  app.listen(port, host, () => {
    console.log('Fieldwork server ready');
    // Warm the catalogs so the first visitor doesn't wait for the download.
    fetch(`http://127.0.0.1:${port}/api/config`).catch(() => {});
  });
  process.on('SIGTERM', () => app.close(() => process.exit(0)));
}
