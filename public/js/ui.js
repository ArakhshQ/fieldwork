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

/** "12 minutes ago", "3 hours ago", "2 days ago" for an ISO time. */
export function ago(value) {
  const t = new Date(value).valueOf();
  if (Number.isNaN(t)) return 'recently';
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 36) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} days ago`;
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

// ---- Celebrations ---------------------------------------------------------
/** A short burst of confetti. Skipped when the student prefers reduced motion. */
export function celebrate() {
  const canvas = $('confetti');
  if (!canvas || reducedMotion()) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  ctx.scale(dpr, dpr);
  const colors = ['#b8924a', '#e3c88f', '#c9cdd3', '#eef0f3', '#1f4e8c'];
  const parts = Array.from({ length: 140 }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 120,
    y: innerHeight * 0.38,
    vx: (Math.random() - 0.5) * 14,
    vy: -Math.random() * 13 - 5,
    r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    w: 6 + Math.random() * 6,
    h: 8 + Math.random() * 8,
    c: colors[Math.floor(Math.random() * colors.length)],
  }));
  canvas.classList.add('on');
  const start = performance.now();
  const frame = (t) => {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += 0.35;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (t - start < 2200) requestAnimationFrame(frame);
    else {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      canvas.classList.remove('on');
    }
  };
  requestAnimationFrame(frame);
}

// ---- Small rich text ------------------------------------------------------------
/** Render the coach's light markdown (paragraphs, "- " lists, **bold**) safely as DOM. */
export function richText(text) {
  const frag = document.createDocumentFragment();
  const inline = (parent, str) => {
    const parts = String(str).split(/(\*\*[^*]+\*\*)/g);
    for (const part of parts) {
      if (/^\*\*[^*]+\*\*$/.test(part)) parent.append(el('strong', part.slice(2, -2)));
      else if (part) parent.append(document.createTextNode(part));
    }
  };
  let list = null;
  for (const raw of String(text).split('\n')) {
    const lineText = raw.trimEnd();
    const bullet = lineText.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (bullet) {
      if (!list) {
        list = el(/^\s*\d/.test(lineText) ? 'ol' : 'ul');
        frag.append(list);
      }
      const li = el('li');
      inline(li, bullet[1]);
      list.append(li);
      continue;
    }
    list = null;
    if (!lineText.trim()) continue;
    const heading = lineText.match(/^#{1,4}\s+(.*)$/);
    const node = el(heading ? 'h4' : 'p');
    inline(node, heading ? heading[1] : lineText);
    frag.append(node);
  }
  return frag;
}

/** An animated score ring (0-100). */
export function scoreRing(value, label = 'score') {
  const wrap = el('div', null, 'score-ring');
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const tone = v >= 85 ? 'mint' : v >= 65 ? 'sun' : 'coral';
  wrap.classList.add(tone);
  wrap.innerHTML =
    '<svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="50" class="ring-track"/><circle cx="60" cy="60" r="50" class="ring-fill"/></svg>';
  const fill = wrap.querySelector('.ring-fill');
  const circ = 2 * Math.PI * 50;
  fill.style.strokeDasharray = String(circ);
  fill.style.strokeDashoffset = String(circ);
  requestAnimationFrame(() => requestAnimationFrame(() => (fill.style.strokeDashoffset = String(circ * (1 - v / 100)))));
  const text = el('div', null, 'score-text');
  text.append(el('strong', String(Math.round(v))), el('span', label));
  wrap.append(text);
  wrap.setAttribute('role', 'img');
  wrap.setAttribute('aria-label', `${label}: ${Math.round(v)} out of 100`);
  return wrap;
}

export async function copyText(text, message = 'Copied.') {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    toast('Couldn’t copy. Select the text and copy it yourself.');
  }
}

const icsText = (v) => String(v || '').replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\r?\n/g, '\\n');
const icsDate = (iso) => iso.replaceAll('-', '');
function fold(line) {
  const out = [];
  while (line.length > 74) {
    out.push(line.slice(0, 74));
    line = ` ${line.slice(74)}`;
  }
  out.push(line);
  return out.join('\r\n');
}

/**
 * Download an .ics file of all-day events with a reminder at 9am the day before.
 * @param events [{ date: 'YYYY-MM-DD', title, details, id }]
 */
export function downloadCalendar(events, filename = 'fieldwork-dates.ics') {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Fieldwork//Deadlines//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const e of events) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || '')) continue;
    const next = new Date(`${e.date}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${icsText(`${e.id || e.title}-${e.date}`).replace(/[^A-Za-z0-9.@-]/g, '')}@fieldwork`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(e.date)}`,
      `DTEND;VALUE=DATE:${icsDate(next.toISOString().slice(0, 10))}`,
      fold(`SUMMARY:${icsText(String(e.title).slice(0, 120))}`),
      ...(e.details ? [fold(`DESCRIPTION:${icsText(String(e.details).slice(0, 800))}`)] : []),
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      fold(`DESCRIPTION:${icsText(String(e.title).slice(0, 120))}`),
      'TRIGGER:-PT15H',
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  const blob = new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** The calendar event for an application's date: a deadline, or a follow-up for an emailed lab. */
export function applicationEvent(a, followUp = false) {
  const what = followUp ? `Follow up: ${a.title}` : a.status === 'Interview' ? `Interview: ${a.title}` : `Deadline: ${a.title}`;
  return { id: a.id, date: a.deadline, title: what, details: [a.notes, a.url].filter(Boolean).join('\n') };
}
