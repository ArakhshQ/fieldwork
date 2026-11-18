import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { createSearchService, SearchError } from './lib/search.mjs';
import { createCatalog } from './lib/internships.mjs';

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
  catalog = createCatalog(),
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

    if (req.method === 'GET' && url.pathname === '/api/internships') {
      // Free catalog search: no provider calls, so only a light per-address limit.
      const ip = req.socket.remoteAddress || 'unknown';
      const b = catalogRates.get(ip) || { count: 0, until: clock() + 60000 };
      if (clock() > b.until) Object.assign(b, { count: 0, until: clock() + 60000 });
      if (++b.count > 60) return send(429, { error: 'Too many searches. Wait a minute.', code: 'rate_limited' });
      catalogRates.set(ip, b);
      if (catalogRates.size > 10000) for (const [k, v] of catalogRates) if (v.until < clock()) catalogRates.delete(k);
      const param = (k, max) => (url.searchParams.get(k) || '').replace(/[\x00-\x1f]/g, ' ').trim().slice(0, max);
      try {
        const data = await catalog.search({
          q: param('q', 240),
          city: param('city', 80),
          state: param('state', 40),
          radius: Math.min(Math.max(Number.parseInt(param('radius', 4), 10) || 0, 0), 500),
          remote: url.searchParams.get('remote') === 'true',
          season: param('season', 40),
          limit: 80,
        });
        return send(200, data);
      } catch {
        return send(500, { error: 'Internship search failed. Try again.' });
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
      ...headers,
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
  app.listen(port, host, () => console.log('Fieldwork server ready'));
  process.on('SIGTERM', () => app.close(() => process.exit(0)));
}
