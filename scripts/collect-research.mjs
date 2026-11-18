#!/usr/bin/env node
// Daily research collector. Uses free, public government APIs (no keys):
//   - NSF Award Search API: active REU Sites (summer research programs), and
//     research grants awarded in the last 120 days (labs with new money).
//   - NIH RePORTER API: active R25 programs for undergraduates, and new
//     research grants (R01, R21, R35, DP2, R00 ...) noticed in the last 120 days.
// Writes data/research.json (or --out). Keeps the old file if a source fails badly.
//
//   node scripts/collect-research.mjs [--out data/research.json] [--days 120]
import { writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const OUT = arg('--out', fileURLToPath(new URL('../data/research.json', import.meta.url)));
const REPORT = OUT.replace(/\.json$/, '-report.json');
const DAYS = Number(arg('--days', 120));
const UA = 'FieldworkResearchCollector/1.0 (+https://github.com/ArakhshQ/fieldwork)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Shared helpers -----------------------------------------------------------
const clean = (v, max = 400) =>
  typeof v === 'string' ? v.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';

const BOILERPLATE = /This award reflects NSF['’]s statutory mission[\s\S]*$/i;

export function summaryOf(text, max = 320) {
  const t = clean(String(text || '').replace(BOILERPLATE, ''), 4000);
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf('. ') + 1, cut.lastIndexOf(' '))).trim() + '…';
}

/** The first non-agency web address in a text, e.g. an REU site's own page. */
export function siteUrlIn(text) {
  for (const m of String(text || '').matchAll(/https?:\/\/[^\s<>"'()\]]+/gi)) {
    const url = m[0].replace(/[.,;:]+$/, '');
    try {
      const u = new URL(url);
      if (/(^|\.)(nsf\.gov|nih\.gov|research\.gov)$/i.test(u.hostname)) continue;
      if (!['http:', 'https:'].includes(u.protocol)) continue;
      return u.href;
    } catch {
      /* not a URL */
    }
  }
  return '';
}

// Only re-case text that arrives in ALL CAPS; mixed-case titles keep their acronyms.
const smartCase = (s) => {
  const t = clean(s, 240);
  return t && t === t.toUpperCase() ? titleCase(t) : t;
};
const titleCase = (s) =>
  clean(s, 120)
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/\b(Of|And|The|At|In|For|On)\b/g, (w) => w.toLowerCase())
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/\b(Sdsu|Ucla|Usc|Mit|Nyu|Cuny|Suny|Uc|Ucsf|Ucsd|Reu|Nih|Nsf|Stem|Ai|Hiv|Aids|Dna|Rna|Us|Usa|Lgbtq|Hbcu|Msi|Covid)\b/g, (w) => w.toUpperCase())
    .replace(/\bUmass\b/g, 'UMass')
    .replace(/\bPhd\b/g, 'PhD')
    .replace(/\bMd\b/g, 'MD');

/** "SMITH, JANE A" -> "Jane A Smith"; "Jane Smith" stays. */
export function personName(raw) {
  const s = clean(raw, 120);
  if (!s) return '';
  if (s.includes(',')) {
    const [last, first] = s.split(',').map((x) => x.trim());
    return titleCase(`${first} ${last}`);
  }
  return s === s.toUpperCase() ? titleCase(s) : s;
}

const usDate = (d) => `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`;
const isoDay = (d) => d.toISOString().slice(0, 10);
/** NSF dates are MM/DD/YYYY. */
export const fromUsDate = (s) => {
  const m = String(s || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : '';
};

async function getJson(url, init = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        ...init,
        headers: { Accept: 'application/json', 'User-Agent': UA, ...(init.headers || {}) },
        signal: AbortSignal.timeout(45000),
      });
    } catch (e) {
      if (attempt === 2) throw e;
      await sleep(3000 * (attempt + 1));
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt === 2) throw new Error(`HTTP ${res.status}`);
      await sleep(4000 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }
}

// ---- NSF ---------------------------------------------------------------------
const NSF = 'https://api.nsf.gov/services/v1/awards.json';
const NSF_FIELDS =
  'id,title,awardeeName,awardeeCity,awardeeStateCode,piFirstName,piLastName,startDate,expDate,date,abstractText,fundProgramName,primaryProgram,estimatedTotalAmt';
export const nsfAwardUrl = (id) => `https://www.nsf.gov/awardsearch/showAward?AWD_ID=${encodeURIComponent(id)}`;

async function nsfPages(params, { maxPages = 400, label }) {
  const out = [];
  for (let page = 0; page < maxPages; page++) {
    const qs = new URLSearchParams({ ...params, printFields: NSF_FIELDS, rpp: '25', offset: String(page * 25 + 1) });
    const data = await getJson(`${NSF}?${qs}`);
    const awards = data?.response?.award || [];
    out.push(...awards);
    if (awards.length < 25) break;
    await sleep(250);
  }
  console.log(`NSF ${label}: ${out.length} awards`);
  return out;
}

export function nsfProgram(a) {
  if (!/\bREU\b/.test(a.title || '')) return null;
  const title = clean(a.title, 240)
    .replace(/^(Collaborative Research:\s*)?REU(\s+Site)?\s*[:\-–]?\s*/i, '');
  return {
    id: `nsf-reu:${a.id}`,
    source: 'nsf-reu',
    title,
    institution: smartCase(a.awardeeName),
    city: titleCase(a.awardeeCity),
    state: clean(a.awardeeStateCode, 2).toUpperCase(),
    pi: personName(`${a.piFirstName || ''} ${a.piLastName || ''}`),
    url: siteUrlIn(a.abstractText) || nsfAwardUrl(a.id),
    awardUrl: nsfAwardUrl(a.id),
    summary: summaryOf(a.abstractText),
    topics: clean(`${title} ${a.fundProgramName || ''} ${summaryOf(a.abstractText, 600)}`, 700),
    start: fromUsDate(a.startDate),
    end: fromUsDate(a.expDate),
  };
}

const NOT_A_LAB =
  /^(collaborative research:\s*)?(conference|workshop|symposium|travel|student travel|planning|sbir|sttr|phase i|phase ii|doctoral dissertation|dissertation|postdoctoral|graduate research fellowship|reu|ret|eager: planning|i-corps|conference:|summer school|career development)/i;

export function nsfLab(a) {
  const title = clean(a.title, 240);
  if (!title || NOT_A_LAB.test(title) || /\b(REU|RET) Site\b/i.test(title)) return null;
  if (!/universit|college|institute|school of|polytechnic/i.test(a.awardeeName || '')) return null;
  const pi = personName(`${a.piFirstName || ''} ${a.piLastName || ''}`);
  if (!pi) return null;
  return {
    id: `nsf:${a.id}`,
    source: 'nsf',
    pi,
    institution: smartCase(a.awardeeName),
    city: titleCase(a.awardeeCity),
    state: clean(a.awardeeStateCode, 2).toUpperCase(),
    title: title.replace(/^Collaborative Research:\s*/i, ''),
    agency: 'NSF',
    mechanism: clean(a.primaryProgram || a.fundProgramName, 80),
    newFaculty: /^CAREER:/i.test(title),
    awardDate: fromUsDate(a.date),
    url: nsfAwardUrl(a.id),
    topics: clean(`${title} ${summaryOf(a.abstractText, 400)}`, 480),
  };
}

// ---- NIH RePORTER --------------------------------------------------------------
const NIH = 'https://api.reporter.nih.gov/v2/projects/search';
const NIH_FIELDS = [
  'ApplId', 'ProjectTitle', 'Organization', 'ContactPiName', 'PrincipalInvestigators', 'AbstractText',
  'ProjectStartDate', 'ProjectEndDate', 'FiscalYear', 'CoreProjectNum', 'ProjectNum', 'AwardNoticeDate',
  'AgencyIcAdmin', 'PrefTerms', 'ActivityCode', 'ProjectDetailUrl',
];

async function nihPages(criteria, { label, max = 8000 }) {
  const out = [];
  for (let offset = 0; offset < max; offset += 500) {
    const data = await getJson(NIH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        criteria,
        include_fields: NIH_FIELDS,
        offset,
        limit: 500,
        sort_field: 'award_notice_date',
        sort_order: 'desc',
      }),
    });
    const rows = data?.results || [];
    out.push(...rows);
    const total = data?.meta?.total ?? 0;
    if (rows.length < 500 || out.length >= total) break;
    await sleep(1100); // RePORTER asks for no more than one request per second
  }
  console.log(`NIH ${label}: ${out.length} projects`);
  return out;
}

const nihUrl = (p) => (typeof p.project_detail_url === 'string' && /^https:\/\//.test(p.project_detail_url) ? p.project_detail_url : `https://reporter.nih.gov/project-details/${encodeURIComponent(p.appl_id)}`);
const contactPi = (p) => {
  const list = Array.isArray(p.principal_investigators) ? p.principal_investigators : [];
  const c = list.find((x) => x.is_contact_pi) || list[0];
  return personName(c?.full_name || p.contact_pi_name || '');
};

export function nihProgram(p) {
  const text = `${p.project_title || ''} ${p.abstract_text || ''}`;
  if (!/undergrad/i.test(text) || !/summer|research experience|research training|internship/i.test(text)) return null;
  // Programs for high-school students or teachers mention undergraduates in passing.
  if (/high school|adolescen|k-12|teachers?\b|middle school|youth/i.test(p.project_title || '') && !/undergrad|college/i.test(p.project_title || ''))
    return null;
  const org = p.organization || {};
  return {
    id: `nih-r25:${p.core_project_num || p.appl_id}`,
    source: 'nih-r25',
    title: smartCase(p.project_title),
    institution: smartCase(org.org_name),
    city: titleCase(org.org_city),
    state: clean(org.org_state, 2).toUpperCase(),
    pi: contactPi(p),
    url: siteUrlIn(p.abstract_text) || nihUrl(p),
    awardUrl: nihUrl(p),
    summary: summaryOf(p.abstract_text),
    topics: clean(`${p.project_title || ''} ${summaryOf(p.abstract_text, 600)}`, 700),
    start: clean(p.project_start_date, 10),
    end: clean(p.project_end_date, 10),
    fiscalYear: p.fiscal_year || 0,
  };
}

const LAB_CODES = ['R01', 'R21', 'R35', 'DP2', 'DP1', 'R00', 'R56', 'RF1', 'R03', 'R15', 'U01'];

export function nihLab(p) {
  const code = clean(p.activity_code, 4).toUpperCase();
  const num = clean(p.project_num, 40);
  // Type 1 = brand-new award; R00 is the independent phase of a new faculty member.
  if (!/^1/.test(num) && code !== 'R00') return null;
  const org = p.organization || {};
  const pi = contactPi(p);
  if (!pi || !org.org_name) return null;
  // Labs that take students: universities, medical schools, hospitals and research institutes.
  if (!/universit|college|institute|school|hospital|clinic|medical center|health system|laborator|research foundation/i.test(org.org_name)) return null;
  const ic = p.agency_ic_admin?.abbreviation;
  return {
    id: `nih:${p.core_project_num || p.appl_id}`,
    source: 'nih',
    pi,
    institution: smartCase(org.org_name),
    city: titleCase(org.org_city),
    state: clean(org.org_state, 2).toUpperCase(),
    title: smartCase(p.project_title),
    agency: ic ? `NIH ${ic}` : 'NIH',
    mechanism: code,
    newFaculty: code === 'R00' || code === 'DP2',
    awardDate: clean(p.award_notice_date, 10),
    url: nihUrl(p),
    topics: clean(`${p.project_title || ''} ${clean(p.pref_terms, 300)}`, 480),
  };
}

// ---- Run -----------------------------------------------------------------------
async function main() {
  const today = new Date();
  const since = new Date(today.getTime() - DAYS * 86400000);
  const fy = today.getUTCMonth() >= 9 ? today.getUTCFullYear() + 1 : today.getUTCFullYear(); // NIH fiscal year starts Oct 1
  const report = { sources: {} };
  const tasks = {
    nsfPrograms: () =>
      nsfPages({ keyword: 'REU', expDateStart: usDate(today) }, { label: 'REU sites', maxPages: 200 }).then((rows) =>
        rows.map(nsfProgram).filter(Boolean),
      ),
    nihPrograms: () =>
      nihPages(
        { activity_codes: ['R25'], fiscal_years: [fy - 1, fy], include_active_projects: true, exclude_subprojects: true },
        { label: 'R25 programs', max: 6000 },
      ).then((rows) => {
        const best = new Map();
        for (const r of rows.map(nihProgram).filter(Boolean))
          if (!best.has(r.id) || best.get(r.id).fiscalYear < r.fiscalYear) best.set(r.id, r);
        return [...best.values()];
      }),
    nsfLabs: () =>
      nsfPages({ dateStart: usDate(since), dateEnd: usDate(today) }, { label: 'new awards', maxPages: 400 }).then((rows) =>
        rows.map(nsfLab).filter(Boolean),
      ),
    nihLabs: async () => {
      // 30-day windows keep each query under RePORTER's 10,000-row paging limit.
      const rows = [];
      for (let end = today; end > since; ) {
        const start = new Date(Math.max(since.getTime(), end.getTime() - 30 * 86400000));
        rows.push(
          ...(await nihPages(
            {
              activity_codes: LAB_CODES,
              award_notice_date: { from_date: isoDay(start), to_date: isoDay(end) },
              exclude_subprojects: true,
            },
            { label: `new grants ${isoDay(start)}..${isoDay(end)}`, max: 10000 },
          )),
        );
        end = new Date(start.getTime() - 86400000);
      }
      const best = new Map();
      for (const r of rows.map(nihLab).filter(Boolean)) if (!best.has(r.id)) best.set(r.id, r);
      return [...best.values()];
    },
  };

  let previous = null;
  try {
    previous = JSON.parse(await readFile(OUT, 'utf8'));
  } catch {
    /* first run */
  }
  const results = {};
  for (const [name, run] of Object.entries(tasks)) {
    try {
      results[name] = await run();
      report.sources[name] = { ok: true, count: results[name].length };
    } catch (e) {
      report.sources[name] = { ok: false, error: String(e.message || e).slice(0, 300) };
      console.error(`${name} failed: ${e.message}`);
    }
  }
  // A failed source keeps yesterday's rows for that source instead of vanishing.
  const keep = (name, list, source) =>
    results[name] ?? (previous?.[list] || []).filter((r) => r.source === source);
  const programs = [...keep('nsfPrograms', 'programs', 'nsf-reu'), ...keep('nihPrograms', 'programs', 'nih-r25')]
    .map(({ fiscalYear, ...p }) => p)
    .sort((a, b) => a.title.localeCompare(b.title));
  // Joint grants appear once per university; keep one card per professor and project.
  const labMap = new Map();
  for (const l of [...keep('nsfLabs', 'labs', 'nsf'), ...keep('nihLabs', 'labs', 'nih')]) {
    const key = `${l.pi.toLowerCase()}|${l.title.toLowerCase()}`;
    if (!labMap.has(key)) labMap.set(key, l);
  }
  const labs = [...labMap.values()].sort((a, b) => (b.awardDate || '').localeCompare(a.awardDate || ''));
  const okCount = Object.values(report.sources).filter((s) => s.ok).length;
  const summary = {
    generatedAt: new Date().toISOString(),
    windowDays: DAYS,
    programCount: programs.length,
    labCount: labs.length,
  };
  await writeFile(REPORT, JSON.stringify({ ...summary, ...report }, null, 1) + '\n');
  console.log(JSON.stringify({ ...summary, ...report }));
  if (okCount === 0) {
    console.error('Every source failed; keeping the previous file.');
    process.exit(1);
  }
  await writeFile(OUT, JSON.stringify({ ...summary, programs, labs }) + '\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
