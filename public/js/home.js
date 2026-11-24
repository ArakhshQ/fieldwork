// Home: greeting, profile readiness, upcoming dates, next steps and progress.
import { $, el, daysUntil, shortDate, downloadCalendar, applicationEvent, toast } from './ui.js';
import { getState, getResume, allOutreach, getOutreach } from './store.js';
import { icon } from './icons.js';

const PROFILE_CHECKS = [
  ['name', 'Add your name'],
  ['school', 'Add your school'],
  ['major', 'Add your field'],
  ['level', 'Pick your study level'],
  ['interests', 'List your interests and skills'],
  ['state', 'Add where you are'],
];

function readiness() {
  const { profile } = getState();
  const done = PROFILE_CHECKS.filter(([k]) => profile[k]).length + (getResume() ? 2 : 0);
  return Math.round((done / (PROFILE_CHECKS.length + 2)) * 100);
}

function greeting(name) {
  const h = new Date().getHours();
  const part = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  return name ? `${part}, ${name.split(' ')[0]}` : `${part}!`;
}

function nextSteps() {
  const { profile, saved, applications } = getState();
  const steps = [];
  const due = applications
    .filter((a) => a.status === 'Applied' && daysUntil(a.deadline) !== null && daysUntil(a.deadline) <= 0)
    .slice(0, 2);
  for (const a of due) steps.push({ text: `Follow up: ${a.title}`, href: '#applications', tone: 'coral', icon: 'mail' });
  if (!profile.major || !profile.school) steps.push({ text: 'Finish your profile so results and drafts fit you', href: '#profile', tone: 'violet', icon: 'user' });
  if (!getResume()) steps.push({ text: 'Add your résumé (paste or upload)', href: '#ai/resume', tone: 'sun', icon: 'file' });
  if (saved.length < 3) steps.push({ text: 'Save at least three opportunities you like', href: '#discover', tone: 'sky', icon: 'bookmark' });
  if (!applications.some((a) => /^(nih|nsf):/.test(a.id)))
    steps.push({ text: 'Email a professor whose lab just got funding', href: '#discover', go: 'research', tone: 'mint', icon: 'flask' });
  if (applications.some((a) => a.status === 'Interview'))
    steps.push({ text: 'Practice for your interview', href: '#ai/interview', tone: 'coral', icon: 'mic' });
  if (applications.length && steps.length < 4) steps.push({ text: 'Ask the coach what to do this week', href: '#ai/coach', tone: 'violet', icon: 'chat' });
  return steps.slice(0, 5);
}

export function renderHome() {
  const { profile, saved, applications } = getState();
  $('home-date').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  $('home-hello').textContent = greeting(profile.name);

  const upcoming = applications
    .map((a) => ({ a, d: daysUntil(a.deadline) }))
    .filter(({ a, d }) => d !== null && d >= 0 && !['Offer', 'Closed'].includes(a.status))
    .sort((x, y) => x.d - y.d);
  const week = upcoming.filter((u) => u.d <= 7).length;
  $('home-summary').textContent = applications.length
    ? `You’re tracking ${applications.length} application${applications.length === 1 ? '' : 's'}${week ? `, with ${week} date${week === 1 ? '' : 's'} this week` : ''}.`
    : 'Let’s find you a research spot or internship. Start with a search, or ask your coach for a plan.';

  // Readiness ring
  const pct = readiness();
  const ring = $('home-ring');
  const circ = 2 * Math.PI * 50;
  ring.style.strokeDasharray = String(circ);
  ring.style.strokeDashoffset = String(circ * (1 - pct / 100));
  $('home-ring-value').textContent = `${pct}%`;

  // Coming up
  const list = $('home-deadlines');
  list.replaceChildren();
  if (!upcoming.length) {
    const li = el('li', null, 'empty-line');
    li.append(el('span', 'No dates yet. Add deadlines in Applications and they’ll show up here.'));
    list.append(li);
  }
  for (const { a, d } of upcoming.slice(0, 5)) {
    const li = el('li');
    const badge = el('span', d === 0 ? 'Today' : d === 1 ? '1 day' : `${d} days`, `day-badge ${d <= 3 ? 'hot' : d <= 7 ? 'warm' : ''}`);
    const text = el('div', null, 'deadline-text');
    text.append(el('strong', a.title), el('small', `${a.status} · ${shortDate(a.deadline + 'T12:00:00')}`));
    li.append(badge, text);
    list.append(li);
  }

  const cal = $('home-calendar');
  cal.hidden = !upcoming.length;
  cal.onclick = () => {
    downloadCalendar(upcoming.map(({ a }) => applicationEvent(a, a.status === 'Applied' && !!getOutreach(a.id))));
    toast('Calendar file downloaded. Open it to add the dates, with a reminder the day before each one.');
  };

  // Next steps
  const steps = $('home-steps');
  steps.replaceChildren();
  const todo = nextSteps();
  if (!todo.length) steps.append(el('li', 'You’re all caught up. Nice work.', 'empty-line'));
  for (const s of todo) {
    const li = el('li');
    const a = el('a', null, `step ${s.tone}`);
    a.href = s.href;
    if (s.go) a.dataset.go = s.go;
    a.append(icon(s.icon), el('span', s.text), icon('arrow', 'icon go-arrow'));
    li.append(a);
    steps.append(li);
  }

  // Progress
  const count = (st) => applications.filter((a) => a.status === st).length;
  const sent = allOutreach();
  const replies = sent.filter((o) => o.repliedAt).length;
  const rate = sent.length ? Math.round((replies / sent.length) * 100) : null;
  const stats = [
    ['Saved', saved.length, 'bookmark'],
    ['Applying', count('Preparing') + count('Applied'), 'briefcase'],
    ['Professors emailed', sent.length, 'send'],
    [rate === null ? 'Replies' : `Replies (${rate}%)`, replies, 'mail'],
    ['Interviews', count('Interview'), 'mic'],
    ['Offers', count('Offer'), 'check'],
  ];
  $('home-stats').replaceChildren(
    ...stats.map(([label, n, ic]) => {
      const s = el('div', null, 'stat');
      s.append(icon(ic), el('strong', String(n)), el('span', label));
      return s;
    }),
  );
}
