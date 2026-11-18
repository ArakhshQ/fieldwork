// Search the research catalog (data/research.json): summer research programs
// and labs with new grants. In-memory, free, refreshed from the data branch.
import { coordinates, distanceMiles, stateCode } from './locations.mjs';
import { createDataset } from './datasets.mjs';

const STOP = new Set(
  'a an and any for in of on or the to with research researcher researchers lab labs program programs undergraduate undergraduates student students summer opportunity opportunities experience experiences position positions'.split(
    ' ',
  ),
);
const DEFAULT_RADIUS = 40;

const words = (s) =>
  String(s || '')
    .toLowerCase()
    .split(/[^a-z0-9+]+/)
    .filter((w) => (w.length >= 3 || w === 'ai' || w === 'cs') && !STOP.has(w) && !/^20\d\d$/.test(w));

// Light stemming ("biomedical" also finds "biomedicine") plus a few field
// families, so a student's word finds the words grant titles actually use.
const stem = (w) => (w.length > 6 ? w.slice(0, Math.max(5, w.length - 3)) : w);
const FAMILIES = {
  neuroscience: ['neuro', 'neural', 'brain'],
  neurobiology: ['neuro', 'neural', 'brain'],
  biomedical: ['biomed', 'bioengineering', 'medical'],
  bioengineering: ['bioengineer', 'biomedical engineering'],
  psychology: ['psycholog', 'cognitive', 'behavior'],
  ai: ['artificial intelligence', 'machine learning'],
  cs: ['computer science', 'computing'],
  chemistry: ['chemical', 'chemist'],
  ecology: ['ecolog', 'ecosystem'],
  climate: ['climate', 'atmospher'],
  cancer: ['cancer', 'tumor', 'oncolog'],
  genetics: ['genetic', 'genom'],
};

function topicScore(terms, title, topics) {
  if (!terms.length) return 1;
  const t = title.toLowerCase();
  const all = topics.toLowerCase();
  let score = 0;
  let hits = 0;
  for (const w of terms) {
    const s = stem(w);
    const family = FAMILIES[w] || [];
    if (t.includes(w)) (score += 4), hits++;
    else if (t.includes(s) || family.some((f) => t.includes(f))) (score += 3), hits++;
    else if (all.includes(w)) (score += 2), hits++;
    else if (all.includes(s) || family.some((f) => all.includes(f))) (score += 1), hits++;
  }
  // Half the words must match; matching all of them ranks a result well above partial matches.
  return hits >= Math.ceil(terms.length / 2) ? score + (hits === terms.length ? 5 : 0) : 0;
}

function placeFilter(p) {
  const st = stateCode(p.state);
  const origin = p.city ? coordinates(p.city, st) : null;
  const radius = origin ? Number(p.radius) || DEFAULT_RADIUS : 0;
  if (!st && !origin) return () => ({ ok: true, distance: null });
  return (row) => {
    if (origin) {
      const c = coordinates(row.city, row.state);
      if (c) {
        const d = distanceMiles(origin, c);
        return { ok: d <= radius, distance: d };
      }
    }
    return { ok: row.state === st, distance: null };
  };
}

const month = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.valueOf())
    ? ''
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};
const where = (r) => [r.institution, [r.city, r.state].filter(Boolean).join(', ')].filter(Boolean).join(', ');
const away = (d) =>
  typeof d === 'number' ? (d < 2 ? ' Under 2 miles from the place you picked.' : ` About ${Math.round(d)} miles from the place you picked.`) : '';

export function programResult(r, distance, generatedAt) {
  const nsf = r.source === 'nsf-reu';
  return {
    id: r.id,
    group: 'programs',
    title: r.title,
    url: r.url,
    host: r.institution,
    kind: nsf ? 'Summer research program' : 'Research program',
    status: 'active_award',
    officialHint: true,
    sourceType: nsf ? 'NSF REU site' : 'NIH-funded program',
    snippet: `${where(r)}.${r.pi ? ` Run by ${r.pi}.` : ''}${away(distance)} ${r.summary || ''}`.trim(),
    evidence: `${nsf ? 'NSF' : 'NIH'} funding for this program runs ${month(r.start) || 'now'} to ${month(r.end) || 'a future date'}. Current funding is a strong sign it is still running; check the site for this year’s dates.`,
    deadlineEvidence: nsf ? 'Not in the award record. Most REU deadlines fall between January and March, so check the site early.' : '',
    fundingEvidence: nsf
      ? 'NSF REU sites pay students a stipend, and many also cover housing and travel. Check the site for amounts.'
      : 'Funded by an NIH training grant. Check the site for stipend details.',
    eligibilityEvidence: nsf
      ? 'NSF rules: students paid from REU funds must be US citizens, US nationals or permanent residents. Some sites fund other students separately.'
      : '',
    awardUrl: r.awardUrl,
    season: nsf ? 'Summer' : '',
    foundAt: generatedAt || '',
    distance: typeof distance === 'number' ? Math.round(distance) : null,
  };
}

export function labResult(r, distance, generatedAt) {
  return {
    id: r.id,
    group: 'labs',
    title: `${r.pi}, ${r.institution}`,
    url: r.url,
    host: r.agency,
    kind: r.newFaculty ? 'New lab' : 'Newly funded lab',
    status: 'new_funding',
    officialHint: true,
    sourceType: r.source === 'nsf' ? 'NSF award' : 'NIH RePORTER',
    snippet: `New grant: “${r.title}”. ${[r.city, r.state].filter(Boolean).join(', ')}.${away(distance)}`,
    evidence: `${r.agency}${r.mechanism ? ` ${r.mechanism}` : ''} award${r.awardDate ? ` dated ${month(r.awardDate)}` : ''}.${
      r.newFaculty ? ' This is an early-career award, which often means a new lab that is building a team.' : ''
    }`,
    deadlineEvidence: '',
    fundingEvidence: 'The lab has new funding. That doesn’t guarantee a paid student role, so ask.',
    eligibilityEvidence: 'No posting. Read the project, then email the professor with a short, specific note.',
    pi: r.pi,
    foundAt: generatedAt || '',
    distance: typeof distance === 'number' ? Math.round(distance) : null,
  };
}

export function searchResearch(catalog, p = {}) {
  const terms = words(p.q);
  const place = placeFilter(p);
  const season = String(p.season || '').toLowerCase();
  const offSeason = /fall|spring|winter/.test(season); // REU sites are summer programs
  const pick = (rows, toResult, limit) => {
    const out = [];
    for (const row of rows || []) {
      const score = topicScore(terms, row.title || '', row.topics || '');
      if (!score) continue;
      const { ok, distance } = place(row);
      if (!ok) continue;
      out.push({ row, score, distance });
    }
    out.sort((a, b) => b.score - a.score || (a.distance ?? 1e4) - (b.distance ?? 1e4));
    return {
      total: out.length,
      results: out.slice(0, limit).map(({ row, distance }) => toResult(row, distance ?? undefined, catalog.generatedAt)),
    };
  };
  const programs = offSeason
    ? { total: 0, results: [] }
    : pick(catalog.programs, programResult, Math.min(Number(p.limit) || 30, 100));
  const labs = pick(catalog.labs, labResult, Math.min(Number(p.limit) || 30, 100));
  return { programs, labs };
}

export function createResearchCatalog({ file, remoteBase = '', fetchImpl } = {}) {
  const dataset = createDataset({
    name: 'research.json',
    ...(file ? { file } : {}),
    remoteBase,
    ...(fetchImpl ? { fetchImpl } : {}),
    validate: (d) => Array.isArray(d?.programs) && Array.isArray(d?.labs),
    empty: { generatedAt: '', programs: [], labs: [] },
  });
  return {
    async search(p) {
      const c = await dataset.get();
      return { ...searchResearch(c, p), generatedAt: c.generatedAt || null };
    },
    async info() {
      const c = await dataset.get();
      return { programs: c.programs.length, labs: c.labs.length, generatedAt: c.generatedAt || null };
    },
  };
}
