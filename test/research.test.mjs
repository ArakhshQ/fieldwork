import test from 'node:test';
import assert from 'node:assert/strict';
import {
  nsfProgram, nsfLab, nihProgram, nihLab, siteUrlIn, personName, summaryOf, fromUsDate,
} from '../scripts/collect-research.mjs';
import { searchResearch } from '../lib/research.mjs';
import { createDataset, dataUrlFor } from '../lib/datasets.mjs';

test('helpers clean names, dates, summaries and links', () => {
  assert.equal(personName('SMITH, JANE A'), 'Jane A Smith');
  assert.equal(personName('Jane Smith'), 'Jane Smith');
  assert.equal(fromUsDate('03/15/2027'), '2027-03-15');
  assert.equal(summaryOf("Good science. This award reflects NSF's statutory mission and more."), 'Good science.');
  assert.equal(siteUrlIn('See https://www.nsf.gov/x and https://reu.example.edu/apply.'), 'https://reu.example.edu/apply');
  assert.equal(siteUrlIn('No links here'), '');
});

test('NSF awards become REU programs or newly funded labs', () => {
  const reu = nsfProgram({
    id: '2400001', title: 'REU Site: Neural Engineering in the Wild', awardeeName: 'TRUSTEES OF BOSTON UNIVERSITY',
    awardeeCity: 'BOSTON', awardeeStateCode: 'MA', piFirstName: 'Ada', piLastName: 'Lovelace',
    startDate: '03/01/2025', expDate: '02/28/2028', abstractText: 'Ten weeks. Apply at https://reu.bu.edu/neuro.',
  });
  assert.equal(reu.title, 'Neural Engineering in the Wild');
  assert.equal(reu.institution, 'Trustees of Boston University');
  assert.equal(reu.city, 'Boston');
  assert.equal(reu.url, 'https://reu.bu.edu/neuro');
  assert.equal(reu.end, '2028-02-28');
  assert.equal(nsfProgram({ id: '1', title: 'Collaborative Research: Ocean Mixing' }), null);

  const lab = nsfLab({
    id: '2400002', title: 'CAREER: Light-Sheet Imaging of Tissue', awardeeName: 'Dartmouth College',
    awardeeCity: 'HANOVER', awardeeStateCode: 'NH', piFirstName: 'Grace', piLastName: 'Hopper', date: '10/01/2026',
  });
  assert.equal(lab.newFaculty, true);
  assert.equal(lab.awardDate, '2026-10-01');
  assert.equal(nsfLab({ id: '3', title: 'Conference: Optics 2027', awardeeName: 'Some University', piFirstName: 'A', piLastName: 'B' }), null);
  assert.equal(nsfLab({ id: '4', title: 'SBIR Phase I: Widgets', awardeeName: 'Widget University', piFirstName: 'A', piLastName: 'B' }), null);
  assert.equal(nsfLab({ id: '5', title: 'Better Widgets', awardeeName: 'Widget LLC', piFirstName: 'A', piLastName: 'B' }), null);
});

test('NIH projects become undergraduate programs or new labs', () => {
  const org = { org_name: 'UNIVERSITY OF MINNESOTA', org_city: 'MINNEAPOLIS', org_state: 'MN' };
  const prog = nihProgram({
    appl_id: 11, core_project_num: 'R25NS1', project_title: 'Summer Research in Neuroscience',
    abstract_text: 'A summer research experience for undergraduates.', organization: org,
    principal_investigators: [{ full_name: 'Alfonso Araque', is_contact_pi: true }], fiscal_year: 2026,
  });
  assert.equal(prog.id, 'nih-r25:R25NS1');
  assert.equal(prog.pi, 'Alfonso Araque');
  assert.equal(prog.url, 'https://reporter.nih.gov/project-details/11');
  assert.equal(
    nihProgram({ project_title: 'High School Science Teams', abstract_text: 'summer, some undergraduates', organization: org }),
    null,
  );
  const lab = nihLab({
    appl_id: 12, core_project_num: 'R01GM9', project_num: '1R01GM9-01', activity_code: 'R01',
    project_title: 'CELL MECHANICS', organization: org, contact_pi_name: 'DOE, JOHN', award_notice_date: '2026-10-02T00:00:00',
    agency_ic_admin: { abbreviation: 'NIGMS' },
  });
  assert.equal(lab.pi, 'John Doe');
  assert.equal(lab.agency, 'NIH NIGMS');
  assert.equal(lab.title, 'Cell Mechanics');
  assert.equal(nihLab({ project_num: '5R01GM9-03', activity_code: 'R01', organization: org, contact_pi_name: 'X, Y' }), null);
  assert.equal(nihLab({ project_num: '1R01X-01', activity_code: 'R01', organization: { org_name: 'OCHIN, INC.' }, contact_pi_name: 'X, Y' }), null);
  assert.equal(nihLab({ project_num: '4R00X-03', activity_code: 'R00', organization: org, contact_pi_name: 'NEW, PROF' }).newFaculty, true);
});

const CATALOG = {
  generatedAt: '2026-11-18T00:00:00Z',
  programs: [
    { id: 'p1', source: 'nsf-reu', title: 'Neural Engineering in the Wild', institution: 'Boston University', city: 'Boston', state: 'MA', topics: 'neural engineering brain devices', url: 'https://reu.bu.edu' },
    { id: 'p2', source: 'nsf-reu', title: 'Coastal Oceanography', institution: 'UC San Diego', city: 'San Diego', state: 'CA', topics: 'ocean waves coastal', url: 'https://www.nsf.gov/x' },
    { id: 'p3', source: 'nih-r25', title: 'Summer Research in Neuroscience', institution: 'University of Minnesota', city: 'Minneapolis', state: 'MN', topics: 'neuroscience brain', url: 'https://reporter.nih.gov/x' },
  ],
  labs: [
    { id: 'l1', source: 'nih', pi: 'Jane Doe', institution: 'Harvard Medical School', city: 'Boston', state: 'MA', title: 'Neural Circuits of Memory', topics: 'neural circuits memory hippocampus', agency: 'NIH NIMH', url: 'https://reporter.nih.gov/l1' },
    { id: 'l2', source: 'nsf', pi: 'Max Roe', institution: 'MIT', city: 'Cambridge', state: 'MA', title: 'Machine Learning for Materials', topics: 'machine learning materials', agency: 'NSF', url: 'https://www.nsf.gov/l2' },
  ],
};

test('research search matches topic and place, and skips summer programs off-season', () => {
  const ids = (p) => {
    const r = searchResearch(CATALOG, p);
    return [...r.programs.results, ...r.labs.results].map((x) => x.id);
  };
  assert.deepEqual(ids({ q: 'neuroscience' }), ['p3', 'p1', 'l1']);
  assert.deepEqual(ids({ q: 'neural', city: 'Boston', state: 'Massachusetts', radius: 25 }), ['p1', 'l1']);
  assert.deepEqual(ids({ q: 'machine learning' }), ['l2']);
  assert.deepEqual(ids({ q: 'learning machine', state: 'California' }), []);
  assert.deepEqual(ids({ q: 'neural', season: 'Fall 2027' }), ['l1']);
  const prog = searchResearch(CATALOG, { q: 'neural engineering' }).programs.results[0];
  assert.equal(prog.status, 'active_award');
  assert.match(prog.eligibilityEvidence, /permanent residents/);
  const lab = searchResearch(CATALOG, { q: 'memory' }).labs.results[0];
  assert.equal(lab.title, 'Jane Doe, Harvard Medical School');
  assert.equal(lab.group, 'labs');
});

test('datasets prefer a newer download and keep the old copy when downloads fail', async () => {
  let clock = 0;
  let reply = { ok: true, body: { generatedAt: '2026-11-18T12:00:00Z', jobs: [1, 2] } };
  const fetchImpl = async () => ({ ok: reply.ok, text: async () => JSON.stringify(reply.body) });
  const ds = createDataset({
    name: 'x.json', file: '/nonexistent/x.json', remoteBase: 'https://example.test', refreshMs: 1000,
    validate: (d) => Array.isArray(d?.jobs), empty: { jobs: [] }, fetchImpl, now: () => clock,
  });
  assert.equal((await ds.get()).jobs.length, 2);
  assert.equal(ds.status().source, 'live');
  reply = { ok: false, body: {} };
  clock = 5000;
  await ds.get();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal((await ds.get()).jobs.length, 2, 'failed refresh keeps data');
  reply = { ok: true, body: { generatedAt: '2026-11-17T00:00:00Z', jobs: [] } };
  clock = 10000;
  await ds.get();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal((await ds.get()).jobs.length, 2, 'older download is ignored');
  reply = { ok: true, body: { generatedAt: '2026-11-19T00:00:00Z', jobs: [1, 2, 3] } };
  clock = 20000;
  await ds.get();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal((await ds.get()).jobs.length, 3, 'newer download replaces');
});

test('remote data is on in production, off in tests, and must be https', () => {
  assert.equal(dataUrlFor({}), '');
  assert.match(dataUrlFor({ NODE_ENV: 'production' }), /^https:\/\/raw\.githubusercontent\.com\//);
  assert.equal(dataUrlFor({ NODE_ENV: 'production', DATA_URL: '' }), '');
  assert.equal(dataUrlFor({ DATA_URL: 'http://insecure.test' }), '');
  assert.equal(dataUrlFor({ DATA_URL: 'https://cdn.example.com/data/' }), 'https://cdn.example.com/data');
});

test('results carry a Platinum, Gold or Silver match grade', async () => {
  const { matchGrade } = await import('../lib/match.mjs');
  assert.equal(matchGrade(2, 2, 2), 'platinum');
  assert.equal(matchGrade(2, 2, 1), 'gold');
  assert.equal(matchGrade(2, 1, 1), 'silver');
  assert.equal(matchGrade(0, 0, 0), null);
  const byId = (p) => Object.fromEntries([...Object.values(searchResearch(CATALOG, p)).flatMap((g) => g.results)].map((r) => [r.id, r.match]));
  assert.deepEqual(byId({ q: 'neural engineering' }), { p1: 'platinum', l1: 'silver' });
  assert.equal(byId({ q: 'memory hippocampus' }).l1, 'gold');
  assert.equal(searchResearch(CATALOG, {}).labs.results[0].match, undefined);
});
