// Search the nightly internship catalog (data/internships.json). Free and fast:
// no provider calls, just filtering in memory.
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { coordinates, distanceMiles, stateCode, stateName } from './locations.mjs';

const DEFAULT_FILE = fileURLToPath(new URL('../data/internships.json', import.meta.url));
const STOP = new Set(
  'a an and any for in of on or the to with intern interns internship internships program programs job jobs role roles opportunity opportunities student students summer fall spring winter paid remote'.split(
    ' ',
  ),
);
const DEFAULT_RADIUS = 30;

const words = (s) =>
  String(s || '')
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .filter((w) => w.length >= 2 && !STOP.has(w) && !/^20\d\d$/.test(w));

function placeText(places, remote) {
  const named = places.map((p) => (p.city ? `${p.city}, ${p.state}` : stateName(p.state) || p.state));
  let text = named.slice(0, 2).join('; ');
  if (named.length > 2) text += `; and ${named.length - 2} more`;
  if (remote) text = text ? `${text}, or remote` : 'Remote';
  return text;
}

export function toResult(job, generatedAt, distance) {
  const where = placeText(job.places, job.remote);
  const seen = generatedAt ? new Date(generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : 'recently';
  return {
    id: job.id,
    title: job.title,
    url: job.url,
    host: job.company,
    company: job.company,
    kind: 'Internship',
    status: 'live_posting',
    officialHint: true,
    sourceType: 'Employer job board',
    snippet: [
      `${job.company}${where ? `, ${where}` : ''}.`,
      job.team ? `Team: ${job.team}.` : '',
      typeof distance === 'number'
        ? distance < 2
          ? 'Under 2 miles from the place you picked.'
          : `About ${Math.round(distance)} miles from the place you picked.`
        : '',
    ]
      .filter(Boolean)
      .join(' '),
    evidence: `Listed on ${job.company}’s job board when we last checked (${seen}).`,
    deadlineEvidence: '',
    fundingEvidence: '',
    eligibilityEvidence: '',
    season: job.season || '',
    postedAt: job.postedAt || '',
    foundAt: generatedAt || '',
    distance: typeof distance === 'number' ? Math.round(distance) : null,
    remote: !!job.remote,
  };
}

/**
 * @param {object} catalog { generatedAt, jobs }
 * @param {object} p { q, city, state, radius, remote, season, limit }
 */
export function searchCatalog(catalog, p = {}) {
  const jobs = Array.isArray(catalog?.jobs) ? catalog.jobs : [];
  const terms = words(p.q);
  const st = stateCode(p.state);
  const origin = p.city ? coordinates(p.city, st) : null;
  const radius = origin ? Number(p.radius) || DEFAULT_RADIUS : 0;
  const seasonWord = String(p.season || '').toLowerCase().match(/summer|fall|spring|winter/)?.[0] || '';
  const seasonYear = String(p.season || '').match(/20\d\d/)?.[0] || '';
  const wantsPlace = !!(st || origin);

  const out = [];
  for (const job of jobs) {
    // Topic
    let score = 0;
    if (terms.length) {
      const title = job.title.toLowerCase();
      const team = (job.team || '').toLowerCase();
      const company = (job.company || '').toLowerCase();
      for (const t of terms) {
        if (title.includes(t)) score += 3;
        else if (team.includes(t)) score += 2;
        else if (company.includes(t)) score += 2;
      }
      if (!score) continue;
    }
    // Season: drop only clear mismatches; unknown seasons stay.
    if (seasonWord && job.season) {
      const js = job.season.toLowerCase();
      if (!js.includes(seasonWord)) continue;
      if (seasonYear && /20\d\d/.test(js) && !js.includes(seasonYear)) continue;
    }
    // Place
    let distance = null;
    let placeMatch = !wantsPlace;
    if (wantsPlace) {
      for (const pl of job.places || []) {
        if (origin) {
          const c = coordinates(pl.city, pl.state);
          if (c) {
            const d = distanceMiles(origin, c);
            if (d <= radius && (distance === null || d < distance)) {
              distance = d;
              placeMatch = true;
            }
            continue;
          }
          // City unknown to us: same state is the best we can say.
          if (pl.state === st) placeMatch = true;
        } else if (pl.state === st) {
          placeMatch = true;
        }
      }
      if (!placeMatch && p.remote && job.remote) placeMatch = true;
      if (!placeMatch) continue;
    } else if (p.remote && !job.remote) {
      continue;
    }
    out.push({ job, score, distance });
  }
  out.sort(
    (a, b) =>
      b.score - a.score ||
      (a.distance ?? 9999) - (b.distance ?? 9999) ||
      (b.job.postedAt || '').localeCompare(a.job.postedAt || ''),
  );
  const limit = Math.min(Number(p.limit) || 60, 200);
  return {
    total: out.length,
    results: out.slice(0, limit).map(({ job, distance }) => toResult(job, catalog.generatedAt, distance ?? undefined)),
  };
}

/** Loads the catalog file and reloads it when it changes on disk. */
export function createCatalog({ file = DEFAULT_FILE, recheckMs = 10 * 60 * 1000 } = {}) {
  let data = { generatedAt: '', jobs: [] };
  let mtime = 0;
  let checkedAt = 0;
  async function load() {
    const now = Date.now();
    if (now - checkedAt < recheckMs && checkedAt) return data;
    checkedAt = now;
    try {
      const s = await stat(file);
      if (s.mtimeMs !== mtime) {
        const parsed = JSON.parse(await readFile(file, 'utf8'));
        if (Array.isArray(parsed.jobs)) {
          data = parsed;
          mtime = s.mtimeMs;
        }
      }
    } catch {
      /* no catalog yet: stay empty */
    }
    return data;
  }
  return {
    async search(p) {
      const catalog = await load();
      return { ...searchCatalog(catalog, p), generatedAt: catalog.generatedAt || null, size: catalog.jobs.length };
    },
    async info() {
      const catalog = await load();
      return { size: catalog.jobs.length, generatedAt: catalog.generatedAt || null };
    },
  };
}
