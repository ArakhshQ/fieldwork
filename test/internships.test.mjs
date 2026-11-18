import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseLocation, coordinates, distanceMiles } from '../lib/locations.mjs';
import { ADAPTERS, isInternship, seasonOf } from '../scripts/collect-internships.mjs';
import { searchCatalog, createCatalog } from '../lib/internships.mjs';
import { createApp } from '../server.mjs';

test('job-board locations become US city/state pairs', () => {
  const p = (s) => parseLocation(s).places.map((x) => `${x.city}|${x.state}`);
  assert.deepEqual(p('Boston, MA; New York, NY'), ['Boston|MA', 'New York|NY']);
  assert.deepEqual(p('San Francisco, California, United States'), ['San Francisco|CA']);
  assert.deepEqual(p('NYC'), ['New York|NY']);
  assert.deepEqual(p('Portland, OR'), ['Portland|OR']);
  assert.deepEqual(p('New York or San Francisco'), ['New York|NY', 'San Francisco|CA']);
  assert.deepEqual(p('Hybrid - Boston'), ['Boston|MA']);
  assert.deepEqual(p('Mountain View, CA (Hybrid)'), ['Mountain View|CA']);
  assert.equal(parseLocation('Remote - US').remote, true);
  assert.equal(parseLocation('Toronto, ON').nonUs, true);
  assert.equal(parseLocation('Remote (Canada)').nonUs, true);
});

test('distances between real cities are sensible', () => {
  const boston = coordinates('Boston', 'MA');
  const cambridge = coordinates('Cambridge', 'Massachusetts');
  const nyc = coordinates('New York', 'NY');
  assert(boston && cambridge && nyc);
  assert(distanceMiles(boston, cambridge) < 6);
  const bn = distanceMiles(boston, nyc);
  assert(bn > 170 && bn < 210, String(bn));
});

test('internship titles are recognized without catching "internal"', () => {
  assert(isInternship('Software Engineering Intern'));
  assert(isInternship('Summer 2027 Internship - Biology'));
  assert(isInternship('Co-op, Hardware'));
  assert(isInternship('International Business Intern'));
  assert(!isInternship('Internal Audit Manager'));
  assert(!isInternship('International Sales Lead'));
  assert(isInternship('Research Assistant', 'Intern'));
  assert.equal(seasonOf('Summer 2027 Intern'), 'Summer 2027');
  assert.equal(seasonOf("Intern, Fall '26"), 'Fall 2026');
  assert.equal(seasonOf('Data Science Intern'), '');
});

const entry = (ats) => ({ name: 'Acme', ats, token: 'acme' });

test('Greenhouse boards: keeps US internships, drops others', () => {
  const jobs = ADAPTERS.greenhouse
    .parse(
      {
        jobs: [
          { id: 1, title: 'Software Engineering Intern', absolute_url: 'https://boards.greenhouse.io/acme/jobs/1', location: { name: 'New York, NY' }, updated_at: '2026-11-01T00:00:00Z' },
          { id: 2, title: 'Senior Engineer', absolute_url: 'https://boards.greenhouse.io/acme/jobs/2', location: { name: 'New York, NY' } },
          { id: 3, title: 'Marketing Intern', absolute_url: 'https://boards.greenhouse.io/acme/jobs/3', location: { name: 'London, UK' } },
          { id: 4, title: 'Data Intern', absolute_url: 'http://insecure.example/4', location: { name: 'Boston, MA' } },
        ],
      },
      entry('greenhouse'),
    )
    .filter(Boolean);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].id, 'greenhouse:acme:1');
  assert.deepEqual(jobs[0].places, [{ city: 'New York', state: 'NY' }]);
  assert.equal(jobs[0].postedAt, '2026-11-01T00:00:00.000Z');
});

test('Lever and Ashby boards are normalized the same way', () => {
  const [lever] = ADAPTERS.lever
    .parse(
      [
        {
          id: 'abc',
          text: 'Research Assistant',
          hostedUrl: 'https://jobs.lever.co/acme/abc',
          categories: { location: 'Cambridge, MA', team: 'Biology', commitment: 'Intern' },
          createdAt: 1793500000000,
        },
      ],
      entry('lever'),
    )
    .filter(Boolean);
  assert.equal(lever.team, 'Biology');
  assert.deepEqual(lever.places, [{ city: 'Cambridge', state: 'MA' }]);

  const ashby = ADAPTERS.ashby
    .parse(
      {
        jobs: [
          {
            id: 'x1',
            title: 'Product Design Intern (Summer 2027)',
            jobUrl: 'https://jobs.ashbyhq.com/acme/x1',
            location: 'San Francisco',
            secondaryLocations: [{ location: 'New York, NY' }],
            isListed: true,
            publishedAt: '2026-10-20T00:00:00Z',
          },
          { id: 'x2', title: 'Intern', jobUrl: 'https://jobs.ashbyhq.com/acme/x2', location: 'Remote', isRemote: true },
          { id: 'x3', title: 'Hidden Intern', jobUrl: 'https://jobs.ashbyhq.com/acme/x3', location: 'Boston, MA', isListed: false },
        ],
      },
      entry('ashby'),
    )
    .filter(Boolean);
  assert.equal(ashby.length, 2);
  assert.equal(ashby[0].season, 'Summer 2027');
  assert.deepEqual(ashby[0].places.map((p) => p.state), ['CA', 'NY']);
  assert.equal(ashby[1].remote, true);
});

const CATALOG = {
  generatedAt: '2026-11-18T09:00:00Z',
  jobs: [
    { id: 'g:a:1', title: 'Software Engineering Intern', company: 'Acme', url: 'https://x.io/1', places: [{ city: 'New York', state: 'NY' }], remote: false, team: 'Engineering', season: 'Summer 2027', postedAt: '2026-11-10T00:00:00Z' },
    { id: 'g:a:2', title: 'Biology Research Intern', company: 'BioCo', url: 'https://x.io/2', places: [{ city: 'Cambridge', state: 'MA' }], remote: false, team: '', season: 'Summer 2027', postedAt: '2026-11-01T00:00:00Z' },
    { id: 'g:a:3', title: 'Data Science Intern', company: 'Acme', url: 'https://x.io/3', places: [{ city: 'San Francisco', state: 'CA' }], remote: false, team: '', season: 'Fall 2026', postedAt: '' },
    { id: 'g:a:4', title: 'Software Intern', company: 'Remoteco', url: 'https://x.io/4', places: [], remote: true, team: '', season: '', postedAt: '' },
    { id: 'g:a:5', title: 'Lab Intern', company: 'TinyLab', url: 'https://x.io/5', places: [{ city: 'Nowheresville', state: 'MA' }], remote: false, team: '', season: '', postedAt: '' },
  ],
};

test('catalog search matches topic, place, radius, remote and season', () => {
  const ids = (p) => searchCatalog(CATALOG, p).results.map((r) => r.id);
  assert.deepEqual(ids({ q: 'software' }), ['g:a:1', 'g:a:4']);
  assert.deepEqual(ids({ q: 'internship', state: 'Massachusetts' }), ['g:a:2', 'g:a:5']);
  // Boston + 10 miles reaches Cambridge; the unknown town in-state still shows.
  const near = searchCatalog(CATALOG, { q: 'intern', city: 'Boston', state: 'Massachusetts', radius: 10 }).results;
  assert.deepEqual(near.map((r) => r.id), ['g:a:2', 'g:a:5']);
  assert.equal(near[0].status, 'live_posting');
  assert(near[0].distance <= 10);
  assert.deepEqual(ids({ q: 'software', city: 'Boston', state: 'MA', radius: 25 }), []);
  assert.deepEqual(ids({ q: 'software', city: 'Boston', state: 'MA', radius: 25, remote: true }), ['g:a:4']);
  assert.deepEqual(ids({ q: 'data', season: 'Summer 2027' }), []);
  assert.deepEqual(ids({ q: 'data', season: 'Fall 2026' }), ['g:a:3']);
  assert.deepEqual(ids({ q: 'astronomy' }), []);
});

test('internship endpoint serves the catalog for free and config reports its size', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'fw-'));
  const file = path.join(dir, 'internships.json');
  await writeFile(file, JSON.stringify(CATALOG));
  let webCalls = 0;
  const app = createApp({
    env: {},
    catalog: createCatalog({ file }),
    search: async () => {
      webCalls++;
      return { results: [] };
    },
  });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => app.close(r)));
  const base = `http://127.0.0.1:${app.address().port}`;
  const data = await fetch(base + '/api/internships?q=biology&state=Massachusetts').then((r) => r.json());
  assert.equal(data.results.length, 1);
  assert.equal(data.results[0].title, 'Biology Research Intern');
  const config = await fetch(base + '/api/config').then((r) => r.json());
  assert.equal(config.internships.size, 5);
  assert.equal(webCalls, 0);
});

test('a missing catalog file means an empty, working search', async () => {
  const empty = createCatalog({ file: '/nonexistent/internships.json' });
  assert.deepEqual(await empty.info(), { size: 0, generatedAt: null });
  assert.equal((await empty.search({ q: 'software' })).total, 0);
});
