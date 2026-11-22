// AI Studio: coach chat, résumé and essay review, application builder,
// interview practice and recommendation letters. Every result is rendered as
// text (never HTML), and each tool keeps its state while you move around.
import { $, el, toast, richText, scoreRing, copyText, celebrate, daysUntil, shortDate, externalLink, safeLink } from './ui.js';
import { getState, getResume, setResume, track, updateApplication } from './store.js';
import { icon } from './icons.js';
import { ensurePro, proPost, proStream, profilePayload, workspacePayload, proStatus, isPro, aiAvailable, previewCodeDialog } from './pro.js';

const TOOLS = {
  coach: { title: 'Coach', blurb: 'Ask anything about finding research or internships. Your coach knows your profile, your list and your dates.', icon: 'chat', tone: 'lilac', action: 'chat', build: buildCoach },
  resume: { title: 'Résumé review', blurb: 'A score, line-by-line fixes you can apply in one click, and tailoring for a specific listing.', icon: 'file', tone: 'sun', action: 'review', build: buildResume },
  essay: { title: 'Essay review', blurb: 'Feedback and edits for personal statements and short answers, in your own voice.', icon: 'pen', tone: 'violet', action: 'review', build: buildEssay },
  application: { title: 'Application builder', blurb: 'Give it a listing. Get eligibility, the deadline, a checklist and drafted answers.', icon: 'checklist', tone: 'mint', action: 'application', build: buildApplication },
  interview: { title: 'Interview practice', blurb: 'Five questions an interviewer for your role would really ask, with feedback on every answer.', icon: 'mic', tone: 'coral', action: 'interview', build: buildInterview },
  letter: { title: 'Recommendation letters', blurb: 'A respectful request email and a brag sheet that makes the letter easy to write.', icon: 'mail', tone: 'sky', action: 'letter', build: buildLetter },
};
const built = new Map();

// ---- Shell -----------------------------------------------------------------------

function paintPlanBar() {
  const bar = $('studio-plan');
  bar.replaceChildren();
  if (!aiAvailable()) {
    bar.append(el('span', 'AI tools are switching on soon.', 'plan-chip'));
    return;
  }
  if (isPro()) {
    const s = proStatus();
    bar.append(el('span', s.plan === 'preview' ? 'Pro preview is on' : 'Pro is on', 'plan-chip on'));
    return;
  }
  bar.append(el('span', 'You’re on Free', 'plan-chip'));
  const get = el('a', 'See Pro', 'button small');
  get.href = '#plans';
  const code = el('button', 'I have a preview code', 'link-button');
  code.type = 'button';
  code.addEventListener('click', previewCodeDialog);
  bar.append(get, code);
}

function remainingChip(action) {
  const r = proStatus().remaining;
  return r && typeof r[action] === 'number' ? el('span', `${r[action]} left this month`, 'left-chip') : null;
}

export function showStudio(sub) {
  paintPlanBar();
  const home = $('studio-home');
  const tool = $('studio-tool');
  const meta = TOOLS[sub];
  if (!meta) {
    home.hidden = false;
    tool.hidden = true;
    return;
  }
  home.hidden = true;
  tool.hidden = false;
  if (!built.has(sub)) {
    const wrap = el('div', null, `tool tool-${sub}`);
    const head = el('div', null, `tool-head ${meta.tone}`);
    const back = el('a', 'AI Studio', 'back-link');
    back.href = '#ai';
    back.prepend(icon('arrow', 'icon flip'));
    const title = el('div', null, 'tool-title');
    const h = el('h1', meta.title);
    title.append(icon(meta.icon, 'icon tool-icon'), h);
    const chipSlot = el('div', null, 'chip-slot');
    head.append(back, title, el('p', meta.blurb), chipSlot);
    wrap.append(head, meta.build());
    built.set(sub, { wrap, chipSlot, action: meta.action });
  }
  const b = built.get(sub);
  b.chipSlot.replaceChildren(...[remainingChip(b.action)].filter(Boolean));
  tool.replaceChildren(b.wrap);
}

// ---- Small builders ------------------------------------------------------------------

function field(label, control, hint) {
  const l = el('label', null, 'field');
  l.append(el('span', label, 'field-label'), control);
  if (hint) l.append(el('span', hint, 'fine'));
  return l;
}
function input(attrs = {}) {
  const i = el('input');
  Object.assign(i, attrs);
  return i;
}
function area(attrs = {}) {
  const t = el('textarea');
  Object.assign(t, attrs);
  return t;
}
function button(text, iconName, className = 'button') {
  const b = el('button', null, className);
  b.type = 'button';
  if (iconName) b.append(icon(iconName));
  b.append(el('span', text));
  return b;
}
async function busy(btn, text, fn) {
  const label = btn.querySelector('span:last-child');
  const old = label.textContent;
  btn.disabled = true;
  btn.classList.add('is-busy');
  label.textContent = text;
  try {
    return await fn();
  } finally {
    btn.disabled = false;
    btn.classList.remove('is-busy');
    label.textContent = old;
  }
}
function errorBox(message) {
  const box = el('div', null, 'error-box');
  box.append(icon('x'), el('span', message));
  return box;
}
function section(title, iconName, ...children) {
  const s = el('section', null, 'result-section');
  const h = el('h3');
  if (iconName) h.append(icon(iconName));
  h.append(el('span', title));
  s.append(h, ...children);
  return s;
}
function bulletList(items, className = '') {
  const ul = el('ul', null, `nice-list ${className}`);
  for (const t of items) ul.append(el('li', t));
  return ul;
}
const words = (s) => (String(s).trim().match(/\S+/g) || []).length;
function wordCounter(textarea, limitInput) {
  const c = el('span', '0 words', 'word-count');
  const update = () => {
    const n = words(textarea.value);
    const limit = Number(limitInput?.value) || 0;
    c.textContent = limit ? `${n} / ${limit} words` : `${n} words`;
    c.classList.toggle('over', !!limit && n > limit);
  };
  textarea.addEventListener('input', update);
  limitInput?.addEventListener('input', update);
  update();
  return Object.assign(c, { update });
}
function loadingCard(text) {
  const c = el('div', null, 'loading-card');
  c.append(el('span', null, 'dots'), el('p', text));
  return c;
}
function targets() {
  const { saved, applications } = getState();
  const seen = new Set();
  const out = [];
  for (const a of applications) if (!seen.has(a.id)) seen.add(a.id), out.push({ id: a.id, title: a.title, url: a.url || '' });
  for (const s of saved) if (!seen.has(s.id)) seen.add(s.id), out.push({ id: s.id, title: s.title, url: s.url || '', snippet: s.snippet || '' });
  return out;
}
function targetSelect(placeholder) {
  const sel = el('select');
  sel.append(Object.assign(el('option', placeholder), { value: '' }));
  for (const t of targets()) sel.append(Object.assign(el('option', t.title.slice(0, 90)), { value: t.id }));
  return sel;
}
const findTarget = (id) => targets().find((t) => t.id === id);
const query = (params) =>
  Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
function mailButtons(getTo, getSubject, getBody) {
  const row = el('div', null, 'row-actions');
  const g = button('Open in Gmail', 'mail', 'button');
  g.addEventListener('click', () => window.open(`https://mail.google.com/mail/?${query({ view: 'cm', fs: '1', to: getTo(), su: getSubject(), body: getBody() })}`, '_blank', 'noopener'));
  const o = button('Open in Outlook', null, 'button ghost');
  o.addEventListener('click', () => window.open(`https://outlook.office.com/mail/deeplink/compose?${query({ to: getTo(), subject: getSubject(), body: getBody() })}`, '_blank', 'noopener'));
  const c = button('Copy', 'copy', 'button ghost');
  c.addEventListener('click', () => copyText(`Subject: ${getSubject()}\n\n${getBody()}`));
  row.append(g, o, c);
  return row;
}

// ---- Coach --------------------------------------------------------------------------

const COACH_KEY = 'fieldwork-coach';
const loadChat = () => {
  try {
    const v = JSON.parse(localStorage.getItem(COACH_KEY));
    return Array.isArray(v) ? v.filter((m) => m && typeof m.content === 'string').slice(-40) : [];
  } catch {
    return [];
  }
};
const saveChat = (msgs) => {
  try {
    localStorage.setItem(COACH_KEY, JSON.stringify(msgs.slice(-40)));
  } catch {
    /* storage full or blocked */
  }
};

function buildCoach() {
  const wrap = el('div', null, 'coach');
  const log = el('div', null, 'chat-log');
  log.setAttribute('aria-live', 'polite');
  const messages = loadChat();
  const SUGGEST = [
    'Make me a plan for finding a summer research position',
    'Which of my saved opportunities fits me best, and why?',
    'How do I ask a professor if I can join their lab?',
    'I have no research experience. Where do I start?',
  ];

  const bubble = (m) => {
    const b = el('div', null, `bubble ${m.role}`);
    if (m.role === 'assistant') b.append(richText(m.content));
    else b.textContent = m.content;
    return b;
  };
  const render = () => {
    log.replaceChildren();
    if (!messages.length) {
      const hello = el('div', null, 'coach-empty');
      hello.append(icon('sparkle', 'icon big-icon'), el('h3', 'What can I help with?'), el('p', 'Pick a question or ask your own.'));
      const chips = el('div', null, 'suggestions');
      for (const s of SUGGEST) {
        const c = el('button', s, 'suggestion');
        c.type = 'button';
        c.addEventListener('click', () => send(s));
        chips.append(c);
      }
      hello.append(chips);
      log.append(hello);
    }
    for (const m of messages) log.append(bubble(m));
    log.scrollTop = log.scrollHeight;
  };

  const form = el('form', null, 'chat-form');
  const box = area({ rows: 1, placeholder: 'Ask your coach…', maxLength: 3000 });
  box.setAttribute('aria-label', 'Message');
  const sendBtn = button('Send', 'send', 'button send');
  sendBtn.type = 'submit';
  const fresh = button('New chat', 'refresh', 'link-button');
  fresh.addEventListener('click', () => {
    messages.length = 0;
    saveChat(messages);
    render();
  });
  form.append(box, sendBtn);
  box.addEventListener('input', () => {
    box.style.height = 'auto';
    box.style.height = `${Math.min(box.scrollHeight, 180)}px`;
  });
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  let sending = false;
  async function send(text) {
    text = text.trim();
    if (!text || sending) return;
    if (!(await ensurePro('Ask the coach'))) return;
    sending = true;
    sendBtn.disabled = true;
    messages.push({ role: 'user', content: text });
    box.value = '';
    box.style.height = 'auto';
    render();
    const live = el('div', null, 'bubble assistant typing');
    live.append(el('span', null, 'dots'));
    log.append(live);
    log.scrollTop = log.scrollHeight;
    let acc = '';
    try {
      await proStream(
        '/api/pro/coach',
        { messages: messages.slice(-12), profile: profilePayload(), resume: getResume(), workspace: workspacePayload() },
        (t) => {
          acc += t;
          live.classList.remove('typing');
          live.replaceChildren(richText(acc));
          log.scrollTop = log.scrollHeight;
        },
      );
      messages.push({ role: 'assistant', content: acc || '…' });
      saveChat(messages);
      render();
    } catch (e) {
      live.remove();
      messages.pop();
      box.value = text;
      log.append(errorBox(e.message));
    } finally {
      sending = false;
      sendBtn.disabled = false;
      box.focus();
    }
  }
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    send(box.value);
  });
  const foot = el('div', null, 'chat-foot');
  foot.append(el('span', 'The coach can be wrong about programs and dates. Check anything important.', 'fine'), fresh);
  wrap.append(log, form, foot);
  render();
  return wrap;
}

// ---- Résumé review ----------------------------------------------------------------------

function fixesSection(fixes, textarea, onApply) {
  const listEl = el('div', null, 'fixes');
  fixes.forEach((f, i) => {
    const card = el('article', null, 'fix');
    const num = el('span', String(i + 1), 'fix-num');
    const body = el('div', null, 'fix-body');
    if (f.original) {
      const before = el('p', null, 'before');
      before.append(el('small', 'Before'), document.createTextNode(f.original));
      body.append(before);
    }
    const after = el('p', null, 'after');
    after.append(el('small', f.original ? 'After' : 'Add'), document.createTextNode(f.suggestion));
    body.append(after);
    if (f.why) body.append(el('p', f.why, 'why'));
    const actions = el('div', null, 'row-actions');
    if (f.found && textarea) {
      const apply = button('Apply fix', 'check', 'button small');
      apply.addEventListener('click', () => {
        if (!textarea.value.includes(f.original)) {
          toast('That line changed since the review. Copy the fix instead.');
          return;
        }
        textarea.value = textarea.value.replace(f.original, f.suggestion);
        textarea.dispatchEvent(new Event('input'));
        card.classList.add('applied');
        apply.disabled = true;
        apply.querySelector('span:last-child').textContent = 'Applied';
        onApply?.();
      });
      actions.append(apply);
    }
    const copy = button('Copy', 'copy', 'button small ghost');
    copy.addEventListener('click', () => copyText(f.suggestion));
    actions.append(copy);
    body.append(actions);
    card.append(num, body);
    listEl.append(card);
  });
  return listEl;
}

function reviewHeader(r, kind) {
  const head = el('div', null, 'review-head');
  const text = el('div');
  text.append(el('p', kind === 'resume' ? 'Résumé score' : 'Essay score', 'eyebrow-line'), el('h2', r.headline || 'Here’s your review'));
  if (r.strengths.length) {
    const chips = el('div', null, 'chip-row');
    for (const s of r.strengths) chips.append(el('span', s, 'good-chip'));
    text.append(chips);
  }
  head.append(scoreRing(r.score), text);
  return head;
}

function buildResume() {
  const wrap = el('div', null, 'tool-body two-col');
  const left = el('div', null, 'tool-form card-surface');
  const text = area({ rows: 16, maxLength: 12000, placeholder: 'Paste your résumé here, or upload a file.' });
  text.value = getResume();
  const saveNote = el('span', '', 'fine');
  text.addEventListener('input', () => (saveNote.textContent = 'Not saved yet.'));
  const file = input({ type: 'file', accept: '.pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain' });
  file.hidden = true;
  const drop = el('div', null, 'drop-zone');
  drop.append(icon('upload', 'icon big-icon'), el('strong', 'Upload your résumé'), el('span', 'PDF, Word (.docx) or text, up to 4 MB. Or drop it here.', 'fine'));
  drop.tabIndex = 0;
  drop.setAttribute('role', 'button');
  const importFile = async (f) => {
    if (!f) return;
    if (f.size > 4 * 1024 * 1024) return toast('That file is over 4 MB.');
    if (!(await ensurePro('Upload your résumé'))) return;
    drop.classList.add('is-busy');
    drop.querySelector('strong').textContent = `Reading ${f.name}…`;
    try {
      const data = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(',')[1] || '');
        r.onerror = () => rej(new Error('Couldn’t read that file.'));
        r.readAsDataURL(f);
      });
      const { text: t } = await proPost('/api/pro/resume-import', { name: f.name, data });
      text.value = t;
      setResume(t);
      saveNote.textContent = 'Imported and saved to your profile.';
      toast('Résumé imported. Check it over, then review it.');
    } catch (e) {
      toast(e.message);
    } finally {
      drop.classList.remove('is-busy');
      drop.querySelector('strong').textContent = 'Upload your résumé';
      file.value = '';
    }
  };
  drop.addEventListener('click', () => file.click());
  drop.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), file.click()));
  file.addEventListener('change', () => importFile(file.files[0]));
  drop.addEventListener('dragover', (e) => (e.preventDefault(), drop.classList.add('over')));
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    importFile(e.dataTransfer.files[0]);
  });
  const saveBtn = button('Save as my résumé', 'check', 'link-button');
  saveBtn.addEventListener('click', () => {
    setResume(text.value);
    saveNote.textContent = 'Saved to your profile.';
  });
  const target = targetSelect('No specific listing');
  const pasted = area({ rows: 4, maxLength: 6000, placeholder: 'Or paste a job or program description to tailor for' });
  const go = button('Review my résumé', 'sparkle', 'button big');
  const saveRow = el('div', null, 'row-actions');
  saveRow.append(saveBtn, saveNote);
  left.append(drop, file, field('Résumé text', text), saveRow, field('Tailor it for (optional)', target), pasted, go);

  const right = el('div', null, 'tool-result');
  right.append(emptyResult('file', 'Your review shows up here', 'You’ll get a score, what already works, and fixes you can apply with one click.'));
  go.addEventListener('click', async () => {
    if (text.value.trim().length < 80) return toast('Add your résumé first: paste it or upload a file.');
    if (!(await ensurePro('Review my résumé'))) return;
    const t = findTarget(target.value);
    const targetText = [t ? `${t.title}\n${t.snippet || ''}\n${t.url}` : '', pasted.value.trim()].filter(Boolean).join('\n\n');
    right.replaceChildren(loadingCard('Reading your résumé like a recruiter would. This takes about 30 seconds.'));
    await busy(go, 'Reviewing…', async () => {
      try {
        const { review } = await proPost('/api/pro/review', { kind: 'resume', text: text.value, target: targetText, profile: profilePayload() });
        const nodes = [reviewHeader(review, 'resume')];
        if (review.fixes.length)
          nodes.push(section('Fixes', 'pen', fixesSection(review.fixes, text, () => (saveNote.textContent = 'Changed. Save when you’re happy.'))));
        if (review.missing.length) nodes.push(section('Worth adding', 'plus', bulletList(review.missing, 'sun')));
        if (review.tailoring.length) nodes.push(section('Tailoring for this listing', 'target', bulletList(review.tailoring, 'sky')));
        right.replaceChildren(...nodes);
        if (review.score >= 90) celebrate();
      } catch (e) {
        right.replaceChildren(errorBox(e.message));
      }
    });
  });
  wrap.append(left, right);
  return wrap;
}

function emptyResult(iconName, title, text) {
  const e = el('div', null, 'empty-result');
  e.append(icon(iconName, 'icon big-icon'), el('h3', title), el('p', text));
  return e;
}

// ---- Essay review -------------------------------------------------------------------------

const HANDOFF = 'fieldwork-essay-handoff';

function buildEssay() {
  const wrap = el('div', null, 'tool-body two-col');
  const left = el('div', null, 'tool-form card-surface');
  const prompt = area({ rows: 3, maxLength: 2000, placeholder: 'e.g. Describe a research question you’d like to explore and why.' });
  const limit = input({ type: 'number', min: 50, max: 2000, placeholder: 'e.g. 500' });
  const essay = area({ rows: 16, maxLength: 15000, placeholder: 'Paste your draft here.' });
  const counter = wordCounter(essay, limit);
  const go = button('Review my essay', 'sparkle', 'button big');
  const limitRow = el('div', null, 'inline-fields');
  limitRow.append(field('Word limit (optional)', limit));
  const essayField = field('Your draft', essay);
  essayField.append(counter);
  left.append(field('The prompt', prompt), limitRow, essayField, go);

  // Drafts handed over from the application builder.
  const takeHandoff = () => {
    try {
      const h = JSON.parse(sessionStorage.getItem(HANDOFF) || 'null');
      if (!h) return;
      sessionStorage.removeItem(HANDOFF);
      prompt.value = h.prompt || '';
      essay.value = h.draft || '';
      counter.update();
    } catch {
      /* ignore */
    }
  };
  takeHandoff();
  window.addEventListener('hashchange', () => location.hash === '#ai/essay' && takeHandoff());

  const right = el('div', null, 'tool-result');
  right.append(emptyResult('pen', 'Your feedback shows up here', 'A score, what’s working, precise edits, and a revised version that keeps your voice.'));
  go.addEventListener('click', async () => {
    if (essay.value.trim().length < 80) return toast('Paste your draft first.');
    if (!(await ensurePro('Review my essay'))) return;
    right.replaceChildren(loadingCard('Reading your essay closely. This takes about 30 seconds.'));
    await busy(go, 'Reviewing…', async () => {
      try {
        const p = [prompt.value.trim(), limit.value ? `Word limit: ${limit.value}` : ''].filter(Boolean).join('\n');
        const { review } = await proPost('/api/pro/review', { kind: 'essay', text: essay.value, prompt: p, profile: profilePayload() });
        const nodes = [reviewHeader(review, 'essay')];
        if (review.fixes.length) nodes.push(section('Edits', 'pen', fixesSection(review.fixes, essay)));
        if (review.missing.length) nodes.push(section('What’s missing', 'plus', bulletList(review.missing, 'sun')));
        if (review.revised) {
          const rev = el('div', null, 'revised');
          rev.append(el('p', `${words(review.revised)} words`, 'word-count'), el('div', review.revised, 'revised-text'));
          const actions = el('div', null, 'row-actions');
          const use = button('Use this version', 'check', 'button small');
          use.addEventListener('click', () => {
            essay.value = review.revised;
            counter.update();
            toast('Draft replaced. Make it yours before you submit.');
          });
          const copy = button('Copy', 'copy', 'button small ghost');
          copy.addEventListener('click', () => copyText(review.revised));
          actions.append(use, copy);
          rev.append(actions);
          nodes.push(section('A revised version', 'sparkle', rev));
        }
        right.replaceChildren(...nodes);
        if (review.score >= 90) celebrate();
      } catch (e) {
        right.replaceChildren(errorBox(e.message));
      }
    });
  });
  wrap.append(left, right);
  return wrap;
}

// ---- Application builder ---------------------------------------------------------------------

const CHECKS_KEY = 'fieldwork-app-checks';
const loadChecks = () => {
  try {
    return JSON.parse(localStorage.getItem(CHECKS_KEY)) || {};
  } catch {
    return {};
  }
};

function buildApplication() {
  const wrap = el('div', null, 'tool-body stack-col');
  const form = el('div', null, 'tool-form card-surface app-form');
  const pick = targetSelect('Pick from your saved list');
  const link = input({ type: 'url', placeholder: 'https://… link to the listing' });
  const pasteToggle = el('details', null, 'paste-toggle');
  pasteToggle.append(el('summary', 'Or paste the listing text'));
  const pasted = area({ rows: 6, maxLength: 40000, placeholder: 'Copy everything on the listing page and paste it here.' });
  pasteToggle.append(pasted);
  pick.addEventListener('change', () => {
    const t = findTarget(pick.value);
    if (t?.url) link.value = t.url;
  });
  const go = button('Build my application', 'sparkle', 'button big');
  const row = el('div', null, 'inline-fields');
  row.append(field('From your list', pick), field('Or a link', link));
  form.append(row, pasteToggle, go);
  const out = el('div', null, 'tool-result');
  out.append(emptyResult('checklist', 'Your application plan shows up here', 'We read the listing and check it against your profile, then write a first draft of each answer.'));

  go.addEventListener('click', async () => {
    const text = pasted.value.trim();
    const url = link.value.trim();
    if (text.length < 200 && !safeLink(url)) return toast('Add a link to the listing, or paste the listing text.');
    if (!(await ensurePro('Build an application'))) return;
    const t = findTarget(pick.value);
    out.replaceChildren(loadingCard('Reading the listing and preparing everything. This takes up to a minute.'));
    await busy(go, 'Building…', async () => {
      try {
        const { application: a } = await proPost('/api/pro/application', {
          url,
          title: t?.title || '',
          text,
          profile: profilePayload(),
          resume: getResume(),
        });
        out.replaceChildren(...renderApplication(a, url));
      } catch (e) {
        out.replaceChildren(errorBox(e.message));
      }
    });
  });
  wrap.append(form, out);
  return wrap;
}

function renderApplication(a, url) {
  const key = url || a.title;
  const checks = loadChecks();
  const nodes = [];
  const head = el('div', null, 'app-head card-surface');
  const title = el('div');
  title.append(el('p', a.organization || 'Application', 'eyebrow-line'), el('h2', a.title || 'Your application'));
  const badges = el('div', null, 'chip-row');
  const v = a.eligibility.verdict;
  badges.append(el('span', v === 'likely' ? 'You likely qualify' : v === 'unlikely' ? 'You may not qualify' : 'Eligibility unclear', `verdict ${v}`));
  const d = daysUntil(a.deadline.date);
  if (a.deadline.date) badges.append(el('span', `Due ${shortDate(a.deadline.date + 'T12:00:00')}${d !== null && d >= 0 ? ` (${d} days)` : ''}`, `due-chip ${d !== null && d <= 14 ? 'hot' : ''}`));
  else badges.append(el('span', a.deadline.text || 'Deadline not stated', 'due-chip'));
  title.append(badges);
  const add = button('Add to Applications', 'plus', 'button');
  add.addEventListener('click', () => {
    const id = `ab:${key}`.slice(0, 190);
    const r = track({ id, title: a.title || 'Application', url: safeLink(url) ? url : '' });
    updateApplication(id, { status: 'Preparing', deadline: a.deadline.date || '', notes: a.eligibility.summary.slice(0, 500) });
    toast(r === 'full' ? 'Applications is full.' : r === 'exists' ? 'Updated in Applications.' : 'Added to Applications.');
  });
  head.append(title, add);
  nodes.push(head);

  const grid = el('div', null, 'app-grid');
  const elig = el('div');
  if (a.eligibility.summary) elig.append(el('p', a.eligibility.summary, 'lead'));
  if (a.eligibility.reasons.length) elig.append(bulletList(a.eligibility.reasons));
  for (const q of a.eligibility.quotes) elig.append(el('blockquote', q));
  if (!a.eligibility.quotes.length) elig.append(el('p', 'We couldn’t find the exact rule on the page. Check it before applying.', 'fine'));
  grid.append(section('Can you apply?', 'target', elig));

  if (a.requirements.length) {
    const ul = el('ul', null, 'check-list');
    const state = checks[key] || {};
    a.requirements.forEach((r, i) => {
      const li = el('li');
      const lab = el('label', null, 'check');
      const box = input({ type: 'checkbox', checked: !!state[i] });
      box.addEventListener('change', () => {
        const all = loadChecks();
        all[key] = { ...(all[key] || {}), [i]: box.checked };
        try {
          localStorage.setItem(CHECKS_KEY, JSON.stringify(all));
        } catch {
          /* ignore */
        }
        const done = ul.querySelectorAll('input:checked').length;
        progress.textContent = `${done} of ${a.requirements.length} ready`;
        if (done === a.requirements.length) celebrate();
      });
      const text = el('span');
      text.append(el('strong', r.item), document.createTextNode(r.detail ? ` ${r.detail}` : ''));
      lab.append(box, text);
      li.append(lab);
      ul.append(li);
    });
    const progress = el('p', `${Object.values(state).filter(Boolean).length} of ${a.requirements.length} ready`, 'progress-line');
    grid.append(section('What you need', 'checklist', progress, ul));
  }
  nodes.push(grid);

  if (a.questions.length) {
    const qs = el('div', null, 'answers');
    for (const q of a.questions) {
      const card = el('article', null, 'answer-card card-surface');
      card.append(el('h4', q.question));
      const t = area({ rows: 8, value: q.draft });
      t.value = q.draft;
      const counter = wordCounter(t);
      const actions = el('div', null, 'row-actions');
      const copy = button('Copy', 'copy', 'button small ghost');
      copy.addEventListener('click', () => copyText(t.value));
      const polish = button('Polish in Essay review', 'pen', 'button small');
      polish.addEventListener('click', () => {
        sessionStorage.setItem(HANDOFF, JSON.stringify({ prompt: q.question, draft: t.value }));
        location.hash = '#ai/essay';
      });
      actions.append(counter, copy, polish);
      card.append(t, actions);
      qs.append(card);
    }
    nodes.push(section('Your answers, first drafts', 'pen', el('p', 'Built only from your profile and résumé. Fill in any [brackets] and make each one sound like you.', 'fine'), qs));
  }
  if (a.plan.length) {
    const ol = el('ol', null, 'timeline');
    for (const p of a.plan) {
      const li = el('li');
      li.append(el('strong', p.when), el('span', p.task));
      ol.append(li);
    }
    nodes.push(section('Your plan', 'calendar', ol));
  }
  if (a.tips.length) nodes.push(section('Tips', 'bolt', bulletList(a.tips, 'mint')));
  if (safeLink(url)) nodes.push(externalLink('Open the listing', url, 'button ghost'));
  return nodes;
}

// ---- Interview practice --------------------------------------------------------------------

const VOICE_ERRORS = {
  'not-allowed': 'Microphone access is blocked. Click the icon at the left of the address bar, allow the microphone for this site, then press the mic again.',
  'service-not-allowed': 'This browser has speech recognition turned off. Try Chrome, Edge or Safari, or type your answer.',
  'audio-capture': 'No microphone was found. Plug one in or check your sound settings, then try again.',
  network: 'Voice answers need an internet connection. Check yours and try again.',
  'no-speech': 'We didn’t hear anything. Press the mic and start talking.',
  'language-not-supported': 'Voice answers aren’t available for your browser’s language. Type your answer instead.',
};

/** Dictation for a textarea using the browser's speech recognition. */
function voiceInput(answer, counter) {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = button('Answer by voice', 'mic', 'button ghost');
  const hint = el('p', '', 'fine voice-hint');
  hint.setAttribute('aria-live', 'polite');
  hint.hidden = true;
  const label = () => mic.querySelector('span:last-child');
  const say = (text, isError = false) => {
    hint.textContent = text;
    hint.hidden = !text;
    hint.classList.toggle('error', isError);
  };
  if (!SpeechRec) {
    mic.disabled = true;
    mic.title = 'Voice answers work in Chrome, Edge and Safari.';
    say('Voice answers work in Chrome, Edge and Safari. In this browser, type your answer.');
    return { mic, hint, stop() {} };
  }
  let rec = null;
  let wanted = false;
  let failed = false;
  let base = '';
  let heard = '';
  let restarts = 0;
  const render = (interim = '') => {
    answer.value = [base, heard, interim].join(' ').replace(/\s+/g, ' ').trim();
    counter.update();
    answer.scrollTop = answer.scrollHeight;
  };
  const finish = () => {
    rec = null;
    wanted = false;
    answer.readOnly = false;
    mic.classList.remove('recording');
    mic.setAttribute('aria-pressed', 'false');
    label().textContent = 'Answer by voice';
    if (!failed) say(heard.trim() ? 'Got it. Edit the text if anything is off, then get feedback.' : '');
  };
  const listen = () => {
    rec = new SpeechRec();
    rec.lang = /^en/i.test(navigator.language || '') ? navigator.language : 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onstart = () => {
      mic.classList.add('recording');
      mic.setAttribute('aria-pressed', 'true');
      label().textContent = 'Stop recording';
      answer.readOnly = true;
      say('Listening… speak your answer, then press Stop recording.');
    };
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript;
        if (e.results[i].isFinal) heard += ` ${text}`;
        else interim += ` ${text}`;
      }
      restarts = 0;
      render(interim);
    };
    rec.onerror = (e) => {
      if (e.error === 'aborted') return;
      failed = true;
      wanted = false;
      say(VOICE_ERRORS[e.error] || 'Voice input stopped. Press the mic to try again, or type your answer.', true);
    };
    rec.onend = () => {
      render();
      // Browsers end a session after a pause; keep listening until the student presses Stop.
      if (wanted && restarts < 3) {
        restarts++;
        try {
          listen();
          return;
        } catch {
          /* fall through */
        }
      }
      finish();
    };
    rec.start();
  };
  mic.addEventListener('click', () => {
    if (rec) {
      wanted = false;
      rec.stop();
      return;
    }
    base = answer.value.trim();
    heard = '';
    failed = false;
    restarts = 0;
    wanted = true;
    try {
      listen();
    } catch {
      failed = true;
      say('Couldn’t start the microphone. Reload the page and try again.', true);
      finish();
    }
  });
  return {
    mic,
    hint,
    stop() {
      if (!rec) return;
      wanted = false;
      rec.stop();
    },
  };
}

function buildInterview() {
  const wrap = el('div', null, 'tool-body interview');
  const setup = el('div', null, 'tool-form card-surface');
  const role = input({ maxLength: 200, placeholder: 'e.g. Undergraduate researcher, Doe Lab (neuroscience)' });
  const list = el('datalist');
  list.id = 'role-options';
  for (const t of targets()) list.append(Object.assign(el('option'), { value: t.title.slice(0, 120) }));
  role.setAttribute('list', 'role-options');
  const details = area({ rows: 4, maxLength: 4000, placeholder: 'Optional: paste the listing or what the lab works on, for sharper questions.' });
  const start = button('Start practice', 'mic', 'button big');
  setup.append(field('What are you interviewing for?', role), list, field('Details', details), start);
  const stage = el('div', null, 'interview-stage');
  wrap.append(setup, stage);

  let session = null;

  function dots() {
    const d = el('div', null, 'progress-dots');
    session.questions.forEach((_, i) => {
      const s = el('span', null, i < session.idx ? 'done' : i === session.idx ? 'now' : '');
      d.append(s);
    });
    return d;
  }
  function scoreDots(n) {
    const d = el('div', null, 'score-dots');
    d.setAttribute('aria-label', `${n} out of 5`);
    for (let i = 1; i <= 5; i++) d.append(el('span', null, i <= n ? 'on' : ''));
    return d;
  }
  function askCurrent() {
    const q = session.questions[session.idx];
    const card = el('div', null, 'question-card card-surface');
    card.append(dots(), el('p', `Question ${session.idx + 1} of ${session.questions.length}`, 'eyebrow-line'), el('h2', q));
    const answer = area({ rows: 7, maxLength: 4000, placeholder: 'Answer as you would out loud. Aim for about a minute.' });
    const counter = wordCounter(answer);
    const actions = el('div', null, 'row-actions');
    const voice = voiceInput(answer, counter);
    actions.append(voice.mic);
    const submit = button('Get feedback', 'sparkle', 'button');
    actions.append(counter, submit);
    card.append(answer, actions, voice.hint);
    const feedback = el('div');
    stage.replaceChildren(card, feedback);
    answer.focus();
    submit.addEventListener('click', async () => {
      voice.stop();
      if (answer.value.trim().length < 5) return toast('Write or say your answer first.');
      await busy(submit, 'Reading your answer…', async () => {
        try {
          const { feedback: f } = await proPost('/api/pro/interview/answer', { role: session.role, question: q, answer: answer.value, profile: profilePayload() });
          session.answers.push({ q, a: answer.value, score: f.score });
          const fb = el('div', null, 'feedback card-surface');
          fb.append(scoreDots(f.score));
          if (f.good) fb.append(section('What worked', 'check', el('p', f.good)));
          if (f.improve) fb.append(section('Make it stronger', 'bolt', el('p', f.improve)));
          if (f.example) fb.append(section('A stronger answer could sound like', 'chat', el('blockquote', f.example)));
          const last = session.idx === session.questions.length - 1;
          const next = button(last ? 'See my summary' : 'Next question', 'arrow', 'button');
          next.addEventListener('click', () => {
            voice.stop();
            session.idx++;
            last ? summary() : askCurrent();
          });
          fb.append(next);
          feedback.replaceChildren(fb);
          submit.disabled = true;
          fb.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } catch (e) {
          feedback.replaceChildren(errorBox(e.message));
        }
      });
    });
  }
  function summary() {
    const avg = session.answers.reduce((n, x) => n + x.score, 0) / Math.max(1, session.answers.length);
    const card = el('div', null, 'summary card-surface');
    card.append(scoreRing(avg * 20, 'overall'), el('h2', avg >= 4 ? 'You’re ready. Nice work.' : avg >= 3 ? 'Solid. A bit more practice will help.' : 'Good start. Practice these again.'));
    const ul = el('ul', null, 'summary-list');
    for (const x of session.answers) {
      const li = el('li');
      li.append(scoreDots(x.score), el('span', x.q));
      ul.append(li);
    }
    const again = button('Practice again', 'refresh', 'button');
    again.addEventListener('click', () => start.click());
    card.append(ul, again);
    stage.replaceChildren(card);
    if (avg >= 4) celebrate();
  }
  start.addEventListener('click', async () => {
    if (role.value.trim().length < 3) return toast('Say what you’re interviewing for.');
    if (!(await ensurePro('Practice an interview'))) return;
    stage.replaceChildren(loadingCard('Writing questions for this role…'));
    await busy(start, 'Preparing…', async () => {
      try {
        const { interview } = await proPost('/api/pro/interview/start', { role: role.value, details: details.value, profile: profilePayload(), resume: getResume() });
        session = { role: role.value, questions: interview.questions, idx: 0, answers: [] };
        if (interview.intro) toast(interview.intro);
        askCurrent();
      } catch (e) {
        stage.replaceChildren(errorBox(e.message));
      }
    });
  });
  return wrap;
}

// ---- Recommendation letters -------------------------------------------------------------------

function buildLetter() {
  const wrap = el('div', null, 'tool-body two-col');
  const left = el('div', null, 'tool-form card-surface');
  const who = input({ maxLength: 100, placeholder: 'e.g. Professor Jane Ray' });
  const relation = input({ maxLength: 200, placeholder: 'e.g. My BIOL 12 professor; I’ve worked in her lab since June' });
  const knows = area({ rows: 5, maxLength: 2000, placeholder: 'What they’ve seen you do: projects, grades, how you worked, anything specific.' });
  const forWhat = input({ maxLength: 300, placeholder: 'e.g. NIH Summer Internship Program' });
  forWhat.setAttribute('list', 'letter-targets');
  const dl = el('datalist');
  dl.id = 'letter-targets';
  for (const t of targets()) dl.append(Object.assign(el('option'), { value: t.title.slice(0, 120) }));
  const due = input({ type: 'date' });
  const go = button('Write my request', 'sparkle', 'button big');
  const row = el('div', null, 'inline-fields');
  row.append(field('What it’s for', forWhat), field('Letter due', due));
  left.append(field('Who are you asking?', who), field('How do they know you?', relation), field('What they know about your work', knows), row, dl, go);
  const right = el('div', null, 'tool-result');
  right.append(emptyResult('mail', 'Your request kit shows up here', 'A short, respectful email and a brag sheet you can attach, plus when to send reminders.'));
  go.addEventListener('click', async () => {
    if (!who.value.trim()) return toast('Add who you’re asking.');
    if (!(await ensurePro('Ask for a recommendation'))) return;
    right.replaceChildren(loadingCard('Writing your request…'));
    await busy(go, 'Writing…', async () => {
      try {
        const { letter } = await proPost('/api/pro/letter', {
          recommender: who.value,
          relation: relation.value,
          knows: knows.value,
          target: forWhat.value,
          deadline: due.value,
          profile: profilePayload(),
          resume: getResume(),
        });
        const to = input({ type: 'email', placeholder: 'Their email' });
        const subj = input({ value: letter.subject });
        subj.value = letter.subject;
        const body = area({ rows: 12 });
        body.value = letter.email;
        const mail = el('div', null, 'mail-card card-surface');
        mail.append(field('To', to), field('Subject', subj), field('Email', body), mailButtons(() => to.value, () => subj.value, () => body.value));
        const brag = el('div', null, 'brag card-surface');
        for (const s of letter.brag) {
          brag.append(el('h4', s.heading), bulletList(s.points));
        }
        const bragText = letter.brag.map((s) => `${s.heading}\n${s.points.map((p) => `- ${p}`).join('\n')}`).join('\n\n');
        const copyBrag = button('Copy brag sheet', 'copy', 'button small ghost');
        copyBrag.addEventListener('click', () => copyText(bragText));
        brag.append(copyBrag);
        const nodes = [section('Your request', 'mail', mail), section('Brag sheet to attach', 'file', brag)];
        if (letter.timeline.length) nodes.push(section('When to send what', 'calendar', bulletList(letter.timeline, 'sky')));
        right.replaceChildren(...nodes);
      } catch (e) {
        right.replaceChildren(errorBox(e.message));
      }
    });
  });
  wrap.append(left, right);
  return wrap;
}
