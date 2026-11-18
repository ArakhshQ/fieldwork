#!/usr/bin/env node
// Nightly collector: reads public job boards (Greenhouse, Lever, Ashby) for the
// employers in data/employers.json, keeps US internship postings, and writes
// data/internships.json plus a short report. Run by .github/workflows/collect-internships.yml.
//
//   node scripts/collect-internships.mjs [--out data/internships.json]
//
// The previous file is kept when too many boards fail, so one bad night never
// empties the catalog.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseLocation } from '../lib/locations.mjs';

const root = new URL('..', import.meta.url);
const outArg = process.argv.indexOf('--out');
const OUT = outArg > 0 ? process.argv[outArg + 1] : fileURLToPath(new URL('data/internships.json', root));
const REPORT = OUT.replace(/\.json$/, '-report.json');
const CONCURRENCY = 6;
const TIMEOUT_MS = 20000;
const MAX_BYTES = 25 * 1024 * 1024;
const MIN_SUCCESS_RATE = 0.6;

const INTERN = /\b(intern|interns|internship|internships|co-?op)\b/i;
// Word boundaries keep "Internal Audit" and "International Sales" out.
export function isInternship(title, extra = '') {
  return INTERN.test(title) || /^(intern|internship)$/i.test(String(extra || '').trim());
}

export function seasonOf(title) {
  const m = String(title).match(/\b(summer|fall|autumn|spring|winter)\b[\s,'’-]*(?:20)?(\d{2})\b/i);
  if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase().replace('autumn', 'fall')} 20${m[2]}`;
  const y = String(title).match(/\b(20\d{2})\b/);
  const s = String(title).match(/\b(summer|fall|spring|winter)\b/i);
  return s ? `${s[1][0].toUpperCase()}${s[1].slice(1).toLowerCase()}${y ? ' ' + y[1] : ''}` : '';
}

const clean = (v, max = 300) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const isHttps = (u) => typeof u === 'string' && /^https:\/\//.test(u);

/** Shape one posting; returns null when it isn't a US internship. */
export function normalize({ ats, token, company, id, title, url, locations, remote, team, postedAt, extra }) {
  title = clean(title, 200);
  if (!title || !isHttps(url) || !isInternship(title, extra || '')) return null;
  const places = [];
  let isRemote = !!remote;
  let nonUs = false;
  for (const raw of locations.filter(Boolean)) {
    const p = parseLocation(raw);
    places.push(...p.places);
    isRemote ||= p.remote;
    nonUs ||= p.nonUs;
  }
  const unique = places.filter(
    (p, i) => places.findIndex((q) => q.city.toLowerCase() === p.city.toLowerCase() && q.state === p.state) === i,
  );
  // Keep it if it names a US place, or is remote without naming another country.
  if (!unique.length && !(isRemote && !nonUs)) return null;
  return {
    id: `${ats}:${token}:${id}`,
    title,
    company,
    url,
    places: unique.slice(0, 12),
    remote: isRemote,
    team: clean(team, 100),
    season: seasonOf(title),
    postedAt: postedAt && !Number.isNaN(new Date(postedAt).valueOf()) ? new Date(postedAt).toISOString() : '',
    source: ats,
  };
}

// ---- Board adapters ----------------------------------------------------------
export const ADAPTERS = {
  greenhouse: {
    url: (t) => `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(t)}/jobs`,
    parse: (data, e) =>
      (data.jobs || []).map((j) =>
        normalize({
          ats: 'greenhouse',
          token: e.token,
          company: e.name,
          id: j.id,
          title: j.title,
          url: j.absolute_url,
          locations: [j.location?.name, ...(j.offices || []).map((o) => o.location || o.name)],
          team: (j.departments || [])[0]?.name,
          postedAt: j.first_published || j.updated_at,
        }),
      ),
  },
  lever: {
    url: (t) => `https://api.lever.co/v0/postings/${encodeURIComponent(t)}?mode=json`,
    parse: (data, e) =>
      (Array.isArray(data) ? data : []).map((j) =>
        normalize({
          ats: 'lever',
          token: e.token,
          company: e.name,
          id: j.id,
          title: j.text,
          url: j.hostedUrl,
          locations: [j.categories?.location, ...(j.categories?.allLocations || [])],
          remote: j.workplaceType === 'remote',
          team: j.categories?.team || j.categories?.department,
          postedAt: j.createdAt,
          extra: j.categories?.commitment,
        }),
      ),
  },
  ashby: {
    url: (t) => `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(t)}`,
    parse: (data, e) =>
      (data.jobs || [])
        .filter((j) => j.isListed !== false)
        .map((j) => {
          const addr = j.address?.postalAddress;
          const fromAddress =
            addr && /^(us|usa|united states)/i.test(addr.addressCountry || 'United States') && addr.addressLocality
              ? `${addr.addressLocality}, ${addr.addressRegion || ''}`
              : '';
          return normalize({
            ats: 'ashby',
            token: e.token,
            company: e.name,
            id: j.id,
            title: j.title,
            url: j.jobUrl,
            locations: [fromAddress, j.location, ...(j.secondaryLocations || []).map((s) => s.location)],
            remote: j.isRemote === true || j.workplaceType === 'Remote',
            team: j.department || j.team,
            postedAt: j.publishedAt,
            extra: j.employmentType,
          });
        }),
  },
};

async function fetchJson(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'FieldworkInternshipCollector/1.0 (+https://github.com/ArakhshQ/fieldwork)' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if ((res.status === 429 || res.status >= 500) && attempt === 0) {
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new Error('Response too large');
    return JSON.parse(text);
  }
}

async function collectOne(e) {
  const adapter = ADAPTERS[e.ats];
  if (!adapter) throw new Error(`Unknown board type ${e.ats}`);
  const data = await fetchJson(adapter.url(e.token));
  const all = adapter.parse(data, e);
  return { jobs: all.filter(Boolean), total: all.length };
}

async function main() {
  const { employers } = JSON.parse(await readFile(new URL('data/employers.json', root), 'utf8'));
  const report = { ok: [], failed: [] };
  const jobs = [];
  let next = 0;
  async function worker() {
    while (next < employers.length) {
      const e = employers[next++];
      try {
        const { jobs: found, total } = await collectOne(e);
        jobs.push(...found);
        report.ok.push({ name: e.name, ats: e.ats, token: e.token, postings: total, internships: found.length });
      } catch (err) {
        report.failed.push({ name: e.name, ats: e.ats, token: e.token, error: String(err.message || err).slice(0, 120) });
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const unique = [...new Map(jobs.map((j) => [j.id, j])).values()].sort(
    (a, b) => (b.postedAt || '').localeCompare(a.postedAt || '') || a.title.localeCompare(b.title),
  );
  const rate = report.ok.length / Math.max(employers.length, 1);
  const summary = {
    generatedAt: new Date().toISOString(),
    boardsChecked: employers.length,
    boardsOk: report.ok.length,
    internships: unique.length,
  };
  await writeFile(REPORT, JSON.stringify({ ...summary, ...report }, null, 1) + '\n');
  console.log(`Boards ok ${report.ok.length}/${employers.length}; internships ${unique.length}`);
  for (const f of report.failed) console.log(`  failed: ${f.name} (${f.ats}:${f.token}) ${f.error}`);
  if (rate < MIN_SUCCESS_RATE) {
    console.error(`Only ${Math.round(rate * 100)}% of boards answered; keeping the previous catalog.`);
    process.exit(1);
  }
  await writeFile(OUT, JSON.stringify({ ...summary, jobs: unique }) + '\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
