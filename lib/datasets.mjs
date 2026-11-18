// A generated dataset (internships, research) that stays fresh without redeploys.
//
// It starts from the copy bundled with the code (data/<name>), then, when a
// remote base URL is set, downloads data/<name> from the repo's `data` branch
// every `refreshMs`. A newer, valid download replaces the copy in memory; any
// failure keeps what we already have, so the site never goes empty.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const DEFAULT_DATA_URL = 'https://raw.githubusercontent.com/ArakhshQ/fieldwork/data';
const MAX_BYTES = 30 * 1024 * 1024;

/** The data URL for this environment, or '' when remote refresh is off. */
export function dataUrlFor(env) {
  if (typeof env.DATA_URL === 'string') {
    try {
      const u = new URL(env.DATA_URL);
      return u.protocol === 'https:' ? env.DATA_URL.replace(/\/+$/, '') : '';
    } catch {
      return '';
    }
  }
  return env.NODE_ENV === 'production' ? DEFAULT_DATA_URL : '';
}

export function createDataset({
  name,
  file = fileURLToPath(new URL(`../data/${name}`, import.meta.url)),
  remoteBase = '',
  refreshMs = 20 * 60 * 1000,
  validate = (d) => d && typeof d === 'object',
  empty = {},
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
}) {
  let data = empty;
  let loadedLocal = false;
  let lastRemote = 0;
  let inflight = null;
  let source = 'none';

  const newer = (candidate) =>
    !data.generatedAt || (candidate.generatedAt && candidate.generatedAt >= data.generatedAt);

  async function loadLocal() {
    loadedLocal = true;
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'));
      if (validate(parsed)) {
        data = parsed;
        source = 'bundled';
      }
    } catch {
      /* nothing bundled */
    }
  }

  async function refreshRemote() {
    lastRemote = now();
    try {
      const res = await fetchImpl(`${remoteBase}/${name}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return;
      const text = await res.text();
      if (text.length > MAX_BYTES) return;
      const parsed = JSON.parse(text);
      if (validate(parsed) && newer(parsed)) {
        data = parsed;
        source = 'live';
      }
    } catch {
      /* keep what we have */
    }
  }

  let first = true;
  async function get() {
    if (!loadedLocal) await loadLocal();
    if (remoteBase && now() - lastRemote >= refreshMs) {
      inflight ||= refreshRemote().finally(() => (inflight = null));
      // Only the very first call waits (at most 15 s); later refreshes run in the background.
      if (first) {
        first = false;
        await inflight;
      }
    }
    return data;
  }

  return { get, status: () => ({ source, generatedAt: data.generatedAt || null }) };
}
