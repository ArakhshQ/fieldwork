// Discover: the sentence-style search, its pickers, filters and results.
import { $, el, toast, fillStateSelect, stateAbbr, reducedMotion, closeOnBackdrop, ago } from './ui.js';
import { getState } from './store.js';
import { opportunityCard } from './cards.js';

const TYPES = [
  ['all', 'research or internships'],
  ['research', 'research'],
  ['internship', 'an internship'],
];
const SEASONS = [
  ['', 'at any time'],
  ['Spring 2027', 'for spring 2027'],
  ['Summer 2027', 'for summer 2027'],
  ['Fall 2027', 'for fall 2027'],
  ['Year-round', 'year-round'],
];
const RADII = [0, 10, 25, 50, 100];
const EXAMPLES = ['biomedical engineering', 'marine biology', 'data science', 'public policy', 'chemistry', 'film production'];

const blank = () => ({
  type: 'all',
  city: '',
  state: '',
  radius: 0,
  season: '',
  paid: false,
  remote: false,
  noExperience: false,
  international: false,
  housing: false,
  level: '',
  duration: '',
  social: false,
});
const prefs = blank();
const refine = { open: false, funding: false, official: false, closed: false };
let lastQuery = null;
let loading = false;

// ---- Sentence ------------------------------------------------------------
function placePhrase() {
  const st = prefs.state ? stateAbbr(prefs.state) : '';
  if (prefs.city) {
    const where = [prefs.city, st].filter(Boolean).join(', ');
    return prefs.radius ? `within ${prefs.radius} miles of ${where}` : `near ${where}`;
  }
  if (prefs.state) return `in ${prefs.state}`;
  return 'anywhere';
}

function renderSentence() {
  $('slot-type').textContent = TYPES.find(([v]) => v === prefs.type)[1];
  $('slot-place').textContent = placePhrase();
  $('slot-season').textContent = (SEASONS.find(([v]) => v === prefs.season) || SEASONS[0])[1];
  for (const chip of document.querySelectorAll('[data-flag]'))
    chip.setAttribute('aria-pressed', String(!!prefs[chip.dataset.flag]));
  sizeQuery();
}

function sizeQuery() {
  const q = $('query');
  const len = Math.max(q.value ? q.value.length : q.placeholder.length, 6);
  q.style.width = `calc(${len}ch + 0.6em)`;
}

// ---- Pickers ---------------------------------------------------------------
let openSlot = null;

function closePicker(returnFocus = true) {
  const picker = $('picker');
  if (picker.hidden) return;
  picker.hidden = true;
  if (openSlot) {
    openSlot.setAttribute('aria-expanded', 'false');
    if (returnFocus) openSlot.focus();
  }
  openSlot = null;
}

function optionList(options, current, onPick) {
  const list = el('div', null, 'picker-options');
  for (const [value, label] of options) {
    const b = el('button', label, 'picker-option');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(value === current));
    b.addEventListener('click', () => onPick(value));
    list.append(b);
  }
  return list;
}

function buildPlacePicker(picker) {
  const city = el('input');
  city.maxLength = 80;
  city.placeholder = 'City, e.g. Boston';
  city.value = prefs.city;
  const state = el('select');
  fillStateSelect(state, 'Any state');
  state.value = prefs.state;
  const radii = el('div', null, 'radius');
  let radius = prefs.radius;
  const paint = () => {
    for (const b of radii.children) b.setAttribute('aria-pressed', String(Number(b.dataset.r) === radius));
    radii.hidden = !city.value.trim();
  };
  for (const r of RADII) {
    const b = el('button', r ? `${r} mi` : 'Any', 'chip small');
    b.type = 'button';
    b.dataset.r = r;
    b.addEventListener('click', () => {
      radius = r;
      paint();
    });
    radii.append(b);
  }
  city.addEventListener('input', paint);
  paint();

  const apply = el('button', 'Use this place', 'button small');
  apply.type = 'button';
  apply.addEventListener('click', () => {
    prefs.city = city.value.trim();
    prefs.state = state.value;
    prefs.radius = prefs.city ? radius : 0;
    renderSentence();
    closePicker();
  });
  const anywhere = el('button', 'Anywhere', 'link-button');
  anywhere.type = 'button';
  anywhere.addEventListener('click', () => {
    Object.assign(prefs, { city: '', state: '', radius: 0 });
    renderSentence();
    closePicker();
  });
  const cityLabel = el('label', 'City');
  cityLabel.append(city);
  const stateLabel = el('label', 'State');
  stateLabel.append(state);
  const actions = el('div', null, 'picker-actions');
  actions.append(apply, anywhere);
  picker.append(el('p', 'Where?', 'picker-title'), cityLabel, stateLabel, radii, actions);
  for (const input of [city, state])
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        apply.click();
      }
    });
  return city;
}

function openPicker(slot) {
  const picker = $('picker');
  if (openSlot === slot) return closePicker();
  closePicker(false);
  openSlot = slot;
  slot.setAttribute('aria-expanded', 'true');
  picker.replaceChildren();
  picker.setAttribute('aria-label', slot.dataset.picker === 'place' ? 'Choose a place' : 'Choose an option');
  let first;
  if (slot.dataset.picker === 'type') {
    picker.append(
      el('p', 'Looking for', 'picker-title'),
      optionList(TYPES, prefs.type, (v) => {
        prefs.type = v;
        renderSentence();
        closePicker();
      }),
    );
  } else if (slot.dataset.picker === 'season') {
    picker.append(
      el('p', 'When?', 'picker-title'),
      optionList(SEASONS, prefs.season, (v) => {
        prefs.season = v;
        renderSentence();
        closePicker();
      }),
    );
  } else {
    first = buildPlacePicker(picker);
  }
  picker.hidden = false;
  if (!matchMedia('(max-width: 640px)').matches) {
    const r = slot.getBoundingClientRect();
    const width = picker.offsetWidth;
    const left = Math.min(Math.max(12, r.left + window.scrollX), window.scrollX + innerWidth - width - 12);
    picker.style.left = `${left}px`;
    picker.style.top = `${r.bottom + window.scrollY + 8}px`;
  } else {
    picker.style.left = picker.style.top = '';
  }
  (first || picker.querySelector('button[aria-pressed="true"]') || picker.querySelector('button, input'))?.focus();
}

// ---- Search ----------------------------------------------------------------
// Three free catalogs refreshed on a schedule (internship postings, research
// programs, newly funded labs) answer instantly; the web search adds anything
// newer or smaller, live, for research and on request for internships.
let config = { searchConfigured: false, internships: { size: 0 }, research: { programs: 0, labs: 0 } };
let listings = [];
let research = { programs: [], labs: [] };
let web = { state: 'idle', results: [], error: '', queries: [], warnings: '' };
const SHOW_STEP = { listings: 9, programs: 6, labs: 6, web: 24 };
let shownCount = { ...SHOW_STEP };

function searchInput() {
  return {
    q: $('query').value,
    type: prefs.type,
    city: prefs.city,
    state: prefs.state,
    radius: prefs.radius,
    season: prefs.season,
    remote: prefs.remote,
    paid: prefs.paid,
    housing: prefs.housing,
    international: prefs.international,
    experience: prefs.noExperience ? 'No experience required' : '',
    level: prefs.level,
    duration: prefs.duration,
    social: prefs.social,
  };
}

function skeletons(n = 6) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const s = el('div', null, 'card skeleton');
    s.style.setProperty('--i', i);
    s.append(el('span'), el('span'), el('span'), el('span'));
    out.push(s);
  }
  return out;
}

const internshipsReady = () => (config.internships?.size || 0) > 0;
const researchReady = () => (config.research?.programs || 0) + (config.research?.labs || 0) > 0;

function catalogParams(input) {
  return new URLSearchParams({
    q: input.q,
    city: input.city,
    state: input.state,
    radius: String(input.radius || ''),
    remote: String(!!input.remote),
    season: input.season,
  });
}

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Search failed.');
  return data;
}

async function runWeb(input) {
  web = { state: 'loading', results: [], error: '', queries: [], warnings: '', started: Date.now() };
  renderResults();
  const timer = setInterval(renderStatus, 1000);
  try {
    const res = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Search-Access-Code': $('access-code').value },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(65000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Web search could not complete. Try again.');
    web = {
      state: 'done',
      results: Array.isArray(data.results) ? data.results : [],
      error: '',
      queries: data.queries || [],
      warnings: [...(data.warnings || []), data.notice].filter(Boolean).join(' '),
    };
  } catch (e) {
    web = {
      state: 'error',
      results: [],
      error: e.name === 'TimeoutError' ? 'The web search took too long. Try a narrower sentence.' : e.message,
      queries: [],
      warnings: '',
    };
  } finally {
    clearInterval(timer);
  }
  renderResults();
}

async function runSearch() {
  if (loading) return;
  const input = searchInput();
  if (input.q.trim().length < 2) {
    $('query').focus();
    toast('Write a field, role or interest first.');
    return;
  }
  loading = true;
  lastQuery = input;
  listings = [];
  research = { programs: [], labs: [] };
  web = { state: 'idle', results: [], error: '', queries: [], warnings: '' };
  shownCount = { ...SHOW_STEP };
  $('starters').hidden = true;
  $('submit').disabled = true;
  $('result-title').textContent = 'Searching…';
  $('status').textContent = '';
  $('cards').replaceChildren(...skeletons());
  document.querySelector('.results').scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });

  const useInternships = input.type !== 'research' && internshipsReady();
  const useResearch = input.type !== 'internship' && researchReady();
  const useWeb = config.searchConfigured && (input.type !== 'internship' || !useInternships);
  const jobs = [];
  const params = catalogParams(input);
  if (useInternships)
    jobs.push(
      getJson('/api/internships?' + params)
        .then((d) => (listings = d.results || []))
        .catch(() => (listings = []))
        .then(renderResults),
    );
  if (useResearch)
    jobs.push(
      getJson('/api/research?' + params)
        .then((d) => (research = { programs: d.programs?.results || [], labs: d.labs?.results || [] }))
        .catch(() => (research = { programs: [], labs: [] }))
        .then(renderResults),
    );
  if (useWeb) jobs.push(runWeb(input));
  if (!jobs.length)
    web = { state: 'error', results: [], error: 'Search is unavailable right now. Try again later.', queries: [], warnings: '' };
  await Promise.all(jobs);
  loading = false;
  $('submit').disabled = false;
  renderResults();
}

function renderStatus() {
  if (!lastQuery) return;
  const parts = [];
  const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
  if (listings.length) parts.push(n(listings.length, 'live internship posting', 'live internship postings'));
  if (research.programs.length) parts.push(n(research.programs.length, 'research program', 'research programs'));
  if (research.labs.length) parts.push(n(research.labs.length, 'newly funded lab', 'newly funded labs'));
  if (web.state === 'loading') {
    const secs = web.started ? ` (${Math.floor((Date.now() - web.started) / 1000)}s)` : '';
    parts.push(`still searching the web${secs}`);
  } else if (web.state === 'done') parts.push(n(web.results.length, 'page from the web', 'pages from the web'));
  const where = [
    TYPES.find(([v]) => v === lastQuery.type)[1],
    placePhrase(),
    (SEASONS.find(([v]) => v === lastQuery.season) || SEASONS[0])[1],
  ].join(', ');
  const text = (parts.length ? parts.join(', ') + '. ' : '') + `Looking for ${where}.`;
  $('status').textContent = text.charAt(0).toUpperCase() + text.slice(1);
}

function passes(r) {
  return (
    (!refine.open || ['open_signal', 'live_posting', 'active_award'].includes(r.status)) &&
    (refine.closed || r.status !== 'closed_signal') &&
    (!refine.funding || !!r.fundingEvidence) &&
    (!refine.official || r.officialHint)
  );
}

function sorted(list) {
  const out = list.filter(passes);
  const sort = $('sort').value;
  if (sort === 'title') out.sort((a, b) => a.title.localeCompare(b.title));
  if (sort === 'source') out.sort((a, b) => Number(!!b.officialHint) - Number(!!a.officialHint));
  return out;
}

function groupHead(title, note, count) {
  const head = el('div', null, 'group-head');
  const h = el('h3');
  h.append(el('span', title), el('span', String(count), 'count'));
  head.append(h, el('p', note, 'fine'));
  return head;
}

function renderResults() {
  const cards = $('cards');
  if (!lastQuery) return;
  const seen = new Set();
  const dedupe = (list) => list.filter((r) => (seen.has(r.url) ? false : seen.add(r.url)));
  const groups = [
    {
      key: 'listings',
      title: 'Live internship postings',
      note: `Open roles on employer job boards. Checked ${ago(config.internships?.generatedAt)}.`,
      items: sorted(dedupe(listings)),
    },
    {
      key: 'programs',
      title: 'Research programs',
      note: `Programs with current NSF or NIH funding, including REU summer sites. Updated ${ago(config.research?.generatedAt)}.`,
      items: sorted(dedupe(research.programs)),
    },
    {
      key: 'labs',
      title: 'Labs with new funding',
      note: 'Professors who won a research grant in the last four months. They rarely post openings, so a short, specific email is the way in.',
      items: refine.open ? [] : sorted(dedupe(research.labs)),
    },
    {
      key: 'web',
      title: 'From the web',
      note: 'Pages found just now. Check each one for current dates.',
      items: sorted(dedupe(web.results)),
    },
  ];
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const anyRaw = listings.length + research.programs.length + research.labs.length + web.results.length;
  const waiting = loading && total === 0;

  $('results-tools').hidden = anyRaw === 0;
  $('result-title').textContent = waiting
    ? 'Searching…'
    : `${total} ${total === 1 ? 'result' : 'results'} for ${lastQuery.q.trim()}`;
  renderStatus();
  $('warnings').textContent = web.state === 'error' ? web.error : web.warnings;
  $('query-list').replaceChildren(...web.queries.map((q) => el('li', q)));
  $('search-details').hidden = !web.queries.length;
  $('web-more').hidden = !(!loading && config.searchConfigured && web.state === 'idle' && lastQuery.type === 'internship');
  $('web-more-text').textContent = listings.length
    ? 'Small and local employers often post outside the job boards we check.'
    : 'No live postings match on the employer job boards we check. The web may have more.';

  if (waiting) return; // keep the skeletons
  const prevIds = new Set([...cards.querySelectorAll('.card[data-id]')].map((c) => c.dataset.id));
  const nodes = [];
  let i = 0;
  for (const g of groups) {
    const webLoading = g.key === 'web' && web.state === 'loading';
    if (!g.items.length && !webLoading) continue;
    nodes.push(groupHead(g.title, g.note, g.items.length));
    for (const r of g.items.slice(0, shownCount[g.key])) {
      const card = opportunityCard(r);
      card.dataset.id = r.id;
      if (!prevIds.has(r.id)) {
        card.style.setProperty('--i', Math.min(i++, 8));
        card.classList.add('enter');
      }
      nodes.push(card);
    }
    if (g.items.length > shownCount[g.key]) {
      const more = el('button', `Show ${Math.min(SHOW_STEP[g.key] * 2, g.items.length - shownCount[g.key])} more`, 'button ghost show-more');
      more.type = 'button';
      more.addEventListener('click', () => {
        shownCount[g.key] += SHOW_STEP[g.key] * 2;
        renderResults();
      });
      nodes.push(more);
    }
    if (webLoading) nodes.push(...skeletons(3));
  }
  cards.replaceChildren(...nodes);
  const empty = !loading && total === 0;
  $('empty').hidden = !empty;
  if (empty) {
    $('empty-title').textContent = anyRaw
      ? 'Nothing matches these filters'
      : web.state === 'error'
        ? 'Search didn’t finish'
        : 'No results for this sentence';
    $('empty-text').textContent = anyRaw
      ? 'Turn off a filter above to see the other results.'
      : web.state === 'error'
        ? web.error
        : 'Try a broader field, a bigger area, or fewer preferences.';
  }
}

// ---- Wiring ----------------------------------------------------------------
function applyPreset(p) {
  Object.assign(prefs, blank(), p);
  $('query').value = p.q || '';
  renderSentence();
}

export function fillFromProfile() {
  const p = getState().profile;
  if (!p.major && !p.interests) {
    location.hash = '#profile';
    toast('Add your field or interests to your profile first.');
    return;
  }
  $('query').value = [p.major, p.interests].filter(Boolean).join(', ').slice(0, 240);
  prefs.city = p.city || '';
  prefs.state = p.state || '';
  prefs.radius = Number(p.radius) || 0;
  prefs.level = p.level || '';
  prefs.remote = p.work === 'Remote';
  renderSentence();
  toast('Filled from your profile. Press Search when ready.');
}

function cyclePlaceholder() {
  if (reducedMotion()) return;
  let i = 0;
  const q = $('query');
  setInterval(() => {
    if (q.value || document.activeElement === q) return;
    i = (i + 1) % EXAMPLES.length;
    q.classList.add('swap');
    setTimeout(() => {
      q.placeholder = EXAMPLES[i];
      sizeQuery();
      q.classList.remove('swap');
    }, 220);
  }, 2800);
}

export function initDiscover() {
  $('search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    closePicker(false);
    runSearch();
  });
  $('query').addEventListener('input', sizeQuery);
  for (const slot of document.querySelectorAll('.slot')) {
    slot.setAttribute('aria-expanded', 'false');
    slot.addEventListener('click', () => openPicker(slot));
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('picker').hidden) closePicker();
  });
  document.addEventListener('pointerdown', (e) => {
    if (!$('picker').hidden && !$('picker').contains(e.target) && !e.target.closest('.slot')) closePicker(false);
  });
  window.addEventListener('resize', () => closePicker(false));

  for (const chip of document.querySelectorAll('[data-flag]'))
    chip.addEventListener('click', () => {
      prefs[chip.dataset.flag] = !prefs[chip.dataset.flag];
      renderSentence();
    });
  for (const chip of document.querySelectorAll('[data-refine]'))
    chip.addEventListener('click', () => {
      refine[chip.dataset.refine] = !refine[chip.dataset.refine];
      chip.setAttribute('aria-pressed', String(refine[chip.dataset.refine]));
      renderResults();
    });
  $('sort').addEventListener('change', () => renderResults());

  for (const b of document.querySelectorAll('[data-preset]'))
    b.addEventListener('click', () => {
      applyPreset(JSON.parse(b.dataset.preset));
      runSearch();
    });
  $('use-profile').addEventListener('click', fillFromProfile);
  $('web-more-button').addEventListener('click', async () => {
    if (!lastQuery || loading) return;
    loading = true;
    $('submit').disabled = true;
    await runWeb(lastQuery);
    loading = false;
    $('submit').disabled = false;
    renderResults();
  });

  // More filters drawer
  const drawer = $('drawer');
  closeOnBackdrop(drawer);
  $('more-filters').addEventListener('click', () => {
    $('f-level').value = prefs.level;
    $('f-duration').value = prefs.duration;
    $('f-social').checked = prefs.social;
    $('f-closed').checked = refine.closed;
    drawer.showModal();
  });
  $('drawer-close').addEventListener('click', () => drawer.close());
  drawer.addEventListener('close', () => {
    prefs.level = $('f-level').value;
    prefs.duration = $('f-duration').value;
    prefs.social = $('f-social').checked;
    refine.closed = $('f-closed').checked;
    const extra = [prefs.level, prefs.duration, prefs.social, refine.closed].filter(Boolean).length;
    $('more-filters').textContent = extra ? `More filters (${extra})` : 'More filters';
    renderResults();
  });
  $('drawer-apply').addEventListener('click', () => drawer.close());
  $('drawer-reset').addEventListener('click', () => {
    Object.assign(prefs, blank());
    Object.assign(refine, { open: false, funding: false, official: false, closed: false });
    for (const chip of document.querySelectorAll('[data-refine]')) chip.setAttribute('aria-pressed', 'false');
    $('sort').value = 'relevance';
    renderSentence();
    drawer.close();
  });

  renderSentence();
  cyclePlaceholder();
}

export function setSearchAvailability(c) {
  config = { ...config, ...c };
  $('setup').hidden = !!config.searchConfigured || internshipsReady() || researchReady();
  $('access').hidden = !config.accessCodeRequired;
}
