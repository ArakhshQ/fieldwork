import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';
async function serve(t, options) {
  const app = createApp(options);
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => app.close(r)));
  return `http://127.0.0.1:${app.address().port}`;
}
const request = (base, body = { q: 'biology' }, headers = {}) =>
  fetch(base + '/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
test('missing key is visible, page loads, no fake data', async (t) => {
  const base = await serve(t, { env: {} });
  assert.equal((await fetch(base + '/')).status, 200);
  assert.equal((await fetch(base + '/api/config').then((r) => r.json())).searchConfigured, false);
  const r = await request(base);
  assert.equal(r.status, 503);
  assert.equal((await r.json()).code, 'setup_required');
});
test('server secrets and arbitrary filesystem paths are never served', async (t) => {
  const base = await serve(t, { env: { TAVILY_API_KEY: 'private-test-key' } });
  assert.equal((await fetch(base + '/.env')).status, 404);
  assert.equal((await fetch(base + '/server.mjs')).status, 404);
  const text = await fetch(base + '/api/config').then((r) => r.text());
  assert(!text.includes('private-test-key'));
});
test('reject cross-origin spending and invalid bodies', async (t) => {
  let calls = 0;
  const base = await serve(t, {
    env: { TAVILY_API_KEY: 'test' },
    search: async () => {
      calls++;
      return { results: [] };
    },
  });
  assert.equal((await request(base, { q: 'biology' }, { Origin: 'https://evil.com' })).status, 403);
  assert.equal((await request(base, { q: 'a'.repeat(5000) })).status, 413);
  assert.equal(calls, 0);
});
test('beta code required and never returned', async (t) => {
  let calls = 0;
  const base = await serve(t, {
    env: { TAVILY_API_KEY: 'test', SEARCH_ACCESS_CODE: 'beta-test' },
    search: async () => {
      calls++;
      return { results: [] };
    },
  });
  assert.equal((await request(base)).status, 401);
  assert.equal((await request(base, {}, { 'X-Search-Access-Code': 'beta-test' })).status, 200);
  assert.equal(calls, 1);
});
test('daily circuit breaker caps provider work', async (t) => {
  const base = await serve(t, {
    env: { TAVILY_API_KEY: 'test', MAX_SEARCHES_PER_DAY: '1' },
    search: async () => ({ results: [] }),
  });
  assert.equal((await request(base)).status, 200);
  assert.equal((await request(base)).status, 429);
});
test('app, assets and policy routes are served with security headers', async (t) => {
  const base = await serve(t, { env: {} });
  for (const path of ['/js/main.js', '/js/store.js', '/style.css', '/terms', '/privacy', '/subscriptions']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  }
  const font = await fetch(base + '/fonts/cormorant-garamond-latin-600-normal.woff2');
  assert.equal(font.status, 200);
  assert.match(font.headers.get('cache-control'), /immutable/);
  const html = await fetch(base + '/').then((r) => r.text());
  assert(!html.includes('TAVILY_API_KEY'));
  assert(html.includes('Emails open in your own Gmail or Outlook, and you press Send.'));
});
test('path traversal, dotfiles and source files are never served', async (t) => {
  const base = await serve(t, { env: {} });
  for (const path of [
    '/../server.mjs',
    '/%2e%2e/server.mjs',
    '/js/%2e%2e/%2e%2e/package.json',
    '/.env',
    '/fonts/.hidden.woff2',
    '/README.md',
    '/lib/search.mjs',
    '/%00.js',
  ]) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
});
test('accounts config exposes only publishable values when configured', async (t) => {
  const off = await serve(t, { env: {} });
  assert.equal((await fetch(off + '/api/config').then((r) => r.json())).accounts, null);
  const base = await serve(t, {
    env: {
      SUPABASE_URL: 'https://abcd.supabase.co/',
      SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
      SUPABASE_SECRET_KEY: 'sb_secret_never',
    },
  });
  const res = await fetch(base + '/api/config');
  const text = await res.text();
  assert.deepEqual(JSON.parse(text).accounts, { url: 'https://abcd.supabase.co', key: 'sb_publishable_test' });
  assert(!text.includes('sb_secret_never'));
  assert.match(res.headers.get('content-security-policy'), /connect-src 'self' https:\/\/abcd\.supabase\.co;/);
});
test('a malformed Supabase URL disables accounts instead of loosening the CSP', async (t) => {
  const base = await serve(t, {
    env: { SUPABASE_URL: 'javascript:alert(1)', SUPABASE_PUBLISHABLE_KEY: 'k' },
  });
  const res = await fetch(base + '/api/config');
  assert.equal((await res.json()).accounts, null);
  assert.match(res.headers.get('content-security-policy'), /connect-src 'self';/);
  assert.match(res.headers.get('permissions-policy'), /microphone=\(self\)/);
  assert.match(res.headers.get('permissions-policy'), /camera=\(\)/);
});
