// Small DOM helpers shared by every view. All user and web text goes in via
// textContent, never innerHTML, so search results can't inject markup.

export const $ = (id) => document.getElementById(id);

export function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

export function safeLink(value) {
  try {
    const u = new URL(value);
    return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}

export function externalLink(text, href, className) {
  const a = el('a', text, className);
  const safe = safeLink(href);
  if (safe) {
    a.href = safe;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  }
  return a;
}

export function shortDate(value) {
  const d = new Date(value);
  return Number.isNaN(d.valueOf())
    ? 'unknown date'
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function timestamp(value) {
  const d = new Date(value);
  return Number.isNaN(d.valueOf())
    ? 'unknown time'
    : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Whole days from today until an ISO date (yyyy-mm-dd), or null. */
export function daysUntil(isoDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate || '')) return null;
  const [y, m, d] = isoDate.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

let toastTimer;
export function toast(message) {
  const t = $('toast');
  t.textContent = message;
  t.hidden = false;
  t.classList.remove('show');
  void t.offsetWidth;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 4000);
}

/** Open the shared dialog with a title and optional paragraphs; returns the body node. */
export function openDialog(title, paragraphs = []) {
  const body = $('dialog-body');
  const h = el('h2', title);
  h.id = 'dialog-title';
  body.replaceChildren(h, ...paragraphs.map((p) => el('p', p)));
  const dialog = $('dialog');
  if (!dialog.open) dialog.showModal();
  return body;
}

export function closeDialog() {
  if ($('dialog').open) $('dialog').close();
}

/** Close a <dialog> when its backdrop (not its content) is clicked. */
export function closeOnBackdrop(dialog) {
  dialog.addEventListener('click', (e) => {
    if (e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
      dialog.close();
  });
}

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export const US_STATES = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'],
  ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'],
  ['DC', 'District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'],
  ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'],
  ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'], ['MD', 'Maryland'],
  ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'],
  ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'],
  ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'],
  ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'],
  ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['PR', 'Puerto Rico'], ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'],
  ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'],
  ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
];
export const stateAbbr = (name) => US_STATES.find(([, n]) => n === name)?.[0] || name;

export function fillStateSelect(select, emptyLabel = 'Any state') {
  select.replaceChildren(Object.assign(el('option', emptyLabel), { value: '' }));
  for (const [, name] of US_STATES) select.append(Object.assign(el('option', name), { value: name }));
}
