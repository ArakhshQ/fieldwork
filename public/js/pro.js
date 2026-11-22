// Pro: lab briefings and professor emails.
//
// Access is a Pro preview code (saved on this device) today, and a signed-in
// subscription once billing is live. Drafts open in the student's own Gmail or
// Outlook; Fieldwork never sends email itself.
import { $, el, toast, openDialog, closeDialog, externalLink, shortDate } from './ui.js';
import { getState, getResume, getOutreach, setOutreach, track, updateApplication, accessToken } from './store.js';
import { celebrate } from './ui.js';

const CODE_KEY = 'fieldwork-pro-code';
let config = { ai: false, preview: false, checkout: null };
let status = { plan: null, remaining: null };

const getCode = () => {
  try {
    return localStorage.getItem(CODE_KEY) || '';
  } catch {
    return '';
  }
};

async function proHeaders() {
  const h = { 'Content-Type': 'application/json' };
  const code = getCode();
  if (code) h['X-Pro-Code'] = code;
  const token = await accessToken();
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export async function refreshStatus() {
  try {
    status = await fetch('/api/pro/status', { headers: await proHeaders() }).then((r) => r.json());
  } catch {
    status = { plan: null, remaining: null };
  }
  paintPlans();
  window.dispatchEvent(new CustomEvent('fieldwork:plan'));
  return status;
}

export const isPro = () => status.plan === 'pro' || status.plan === 'preview';
export const proStatus = () => status;
export const aiAvailable = () => !!config.ai;
export const planLabel = () => (status.plan === 'pro' ? 'Pro' : status.plan === 'preview' ? 'Pro preview' : 'Free');

/** True when Pro tools can run; otherwise shows the upgrade dialog and returns false. */
export async function ensurePro(title = 'This is a Pro tool') {
  if (!config.ai) {
    upsell(title);
    return false;
  }
  if (!isPro()) await refreshStatus();
  if (!isPro()) {
    upsell(title);
    return false;
  }
  return true;
}

function paintPlans() {
  const tag = $('pro-tag');
  if (!tag) return;
  $('upgrade-link').hidden = !config.checkout || isPro();
  if (isPro()) {
    tag.textContent = status.plan === 'preview' ? 'Preview active' : 'Active';
    const r = status.remaining;
    $('pro-note').textContent = r
      ? `Left this month: ${r.review ?? '–'} reviews, ${r.application ?? '–'} applications, ${r.briefing} lab briefings, ${r.email} emails, ${r.chat ?? '–'} coach messages.`
      : 'Pro is active on this device.';
  } else {
    tag.textContent = config.checkout ? 'Available' : 'Coming soon';
  }
  $('preview-code').hidden = !config.preview || status.plan === 'pro';
}

export function previewCodeDialog() {
  const body = openDialog('Pro preview code', ['Enter the code you were given. It’s saved on this device only.']);
  const form = el('form', null, 'stack');
  const label = el('label', 'Code');
  const input = el('input');
  input.autocomplete = 'off';
  input.required = true;
  input.value = getCode();
  label.append(input);
  const save = el('button', 'Save code', 'button');
  const remove = el('button', 'Remove code', 'link-button');
  remove.type = 'button';
  const actions = el('div', null, 'form-actions');
  actions.append(save, remove);
  form.append(label, actions);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      localStorage.setItem(CODE_KEY, input.value.trim());
    } catch {
      /* storage blocked */
    }
    await refreshStatus();
    if (status.plan === 'preview') {
      closeDialog();
      toast('Pro preview is on.');
    } else {
      form.querySelector('.form-error')?.remove();
      form.append(el('p', 'That code didn’t work. Check it and try again.', 'form-error'));
    }
  });
  remove.addEventListener('click', async () => {
    localStorage.removeItem(CODE_KEY);
    await refreshStatus();
    closeDialog();
    toast('Preview code removed.');
  });
  body.append(form);
  input.focus();
}

function upsell(title) {
  const body = openDialog(title, [
    'Pro gives you an application team: a coach, résumé and essay reviews, an application builder, interview practice, letter requests, and personal emails to professors.',
  ]);
  const actions = el('div', null, 'form-actions');
  if (config.checkout) {
    const a = el('a', 'Get Pro for $19 a month', 'button');
    a.href = '/upgrade';
    actions.append(a);
  } else {
    body.append(el('p', 'Pro opens soon.', 'fine'));
  }
  if (config.preview) {
    const b = el('button', 'I have a preview code', 'link-button');
    b.type = 'button';
    b.addEventListener('click', previewCodeDialog);
    actions.append(b);
  }
  body.append(actions);
}

function afterUse(data) {
  if (data && typeof data.remaining === 'number') refreshStatus();
}

export async function proPost(path, payload) {
  const res = await fetch(path, { method: 'POST', headers: await proHeaders(), body: JSON.stringify(payload) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (data.code === 'pro_required') upsell('This is a Pro tool');
    throw Object.assign(new Error(data.error || 'Something went wrong. Try again.'), { code: data.code });
  }
  afterUse(data);
  return data;
}

/** POST and read a server-sent event stream; onText gets each piece of text. */
export async function proStream(path, payload, onText) {
  const res = await fetch(path, { method: 'POST', headers: await proHeaders(), body: JSON.stringify(payload) });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (data.code === 'pro_required') upsell('This is a Pro tool');
    throw new Error(data.error || 'Something went wrong. Try again.');
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let done = null;
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    buffer += decoder.decode(value, { stream: true });
    let i;
    while ((i = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, i).replace(/^data: ?/, '');
      buffer = buffer.slice(i + 2);
      let evt;
      try {
        evt = JSON.parse(chunk);
      } catch {
        continue;
      }
      if (evt.t) onText(evt.t);
      if (evt.error) throw new Error(evt.error);
      if (evt.done) done = evt;
    }
  }
  afterUse(done);
  return done;
}

export const profilePayload = () => {
  const p = getState().profile;
  return { name: p.name, school: p.school, level: p.level, major: p.major, interests: p.interests, available: p.available, city: p.city, state: p.state };
};

export const workspacePayload = () => {
  const { saved, applications } = getState();
  return {
    saved: saved.slice(0, 25).map((s) => `${s.title}${s.host ? ` (${s.host})` : ''}`),
    applications: applications.slice(0, 25).map((a) => ({ title: a.title, status: a.status, deadline: a.deadline })),
  };
};

function section(title, ...children) {
  const s = el('section', null, 'brief-section');
  s.append(el('h3', title), ...children);
  return s;
}

// encodeURIComponent writes spaces as %20; "+" can show up literally in Outlook.
const query = (params) =>
  Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
function composeLinks(to, subject, body) {
  return {
    gmail: `https://mail.google.com/mail/?${query({ view: 'cm', fs: '1', to, su: subject, body })}`,
    outlook: `https://outlook.office.com/mail/deeplink/compose?${query({ to, subject, body })}`,
  };
}

function emailEditor(container, lab, draft, { to, onSent, regenerate }) {
  const toLabel = el('label', 'To');
  const toInput = el('input');
  toInput.type = 'email';
  toInput.placeholder = 'Professor’s email';
  toInput.value = to || '';
  toLabel.append(toInput);
  const subjLabel = el('label', 'Subject');
  const subj = el('input');
  subj.maxLength = 150;
  subj.value = draft.subject;
  subjLabel.append(subj);
  const bodyLabel = el('label', 'Email');
  const body = el('textarea', null, 'email-body');
  body.rows = 12;
  body.value = draft.body;
  bodyLabel.append(body);
  const hint = el('p', 'Read it once and make it yours. Replace anything in [brackets]. Attach your résumé before sending.', 'fine');

  const open = (which) => {
    const links = composeLinks(toInput.value.trim(), subj.value, body.value);
    window.open(links[which], '_blank', 'noopener');
  };
  const gmail = el('button', 'Open in Gmail', 'button');
  gmail.type = 'button';
  gmail.addEventListener('click', () => open('gmail'));
  const outlook = el('button', 'Open in Outlook', 'button ghost');
  outlook.type = 'button';
  outlook.addEventListener('click', () => open('outlook'));
  const copy = el('button', 'Copy', 'button ghost');
  copy.type = 'button';
  copy.addEventListener('click', async () => {
    await navigator.clipboard.writeText(`Subject: ${subj.value}\n\n${body.value}`).catch(() => {});
    toast('Copied.');
  });
  const redo = el('button', 'Write a different version', 'link-button');
  redo.type = 'button';
  redo.addEventListener('click', regenerate);
  const sendRow = el('div', null, 'form-actions');
  sendRow.append(gmail, outlook, copy, redo);

  const sent = el('button', 'I sent it: remind me to follow up', 'button ghost');
  sent.type = 'button';
  sent.addEventListener('click', () => onSent({ to: toInput.value.trim(), subject: subj.value, body: body.value }));
  const sentRow = el('div', null, 'form-actions sent-row');
  sentRow.append(sent);
  container.replaceChildren(toLabel, subjLabel, bodyLabel, hint, sendRow, sentRow);
}

function loading(container, text) {
  const p = el('p', text, 'status loading-line');
  container.replaceChildren(p);
}

/** Entry point from a lab card. */
export async function writeToProfessor(lab) {
  if (!(await ensurePro('Write to this professor'))) return;
  const body = openDialog(lab.pi ? `Write to ${lab.pi}` : 'Write to this professor', []);
  body.closest('dialog').classList.add('wide');
  const resume = getResume();
  const brief = el('div', null, 'brief');
  const mail = el('div', null, 'mail');
  body.append(brief, mail);
  if (!resume || !getState().profile.major)
    body.insertBefore(
      Object.assign(el('p', null, 'notice-inline'), {
        textContent: 'Tip: add your field and paste your résumé in Profile. Drafts are much better with them.',
      }),
      brief,
    );
  loading(brief, 'Reading the lab’s grant, recent papers and website. This takes about 20 seconds.');
  let result;
  try {
    result = await proPost('/api/pro/briefing', { labId: lab.id, profile: profilePayload(), resume });
  } catch (e) {
    brief.replaceChildren(el('p', e.message, 'form-error'));
    if (e.code === 'pro_required') upsell('Write to this professor');
    return;
  }
  const b = result.briefing;
  const nodes = [section('What the lab studies', el('p', b.summary))];
  if (b.projects.length) {
    const ul = el('ul');
    for (const p of b.projects) {
      const li = el('li');
      li.append(el('strong', p.title), document.createTextNode(p.plain ? ` ${p.plain}` : ''));
      ul.append(li);
    }
    nodes.push(section('Current projects', ul));
  }
  if (b.studentWork) nodes.push(section('What a student might do', el('p', b.studentWork)));
  if (b.fit) nodes.push(section('How you fit', el('p', b.fit)));
  if (b.questions.length) {
    const ul = el('ul');
    for (const q of b.questions) ul.append(el('li', q));
    nodes.push(section('Good questions to ask', ul));
  }
  const where = el('div', null, 'brief-links');
  if (result.labUrl) where.append(externalLink('Lab website', result.labUrl));
  where.append(externalLink('Grant record', lab.url));
  for (const p of result.papers.slice(0, 3)) if (p.url) where.append(externalLink(`${p.title.slice(0, 60)}${p.title.length > 60 ? '…' : ''} (${p.year || ''})`, p.url));
  nodes.push(where);
  if (b.unclear) nodes.push(el('p', `Not certain: ${b.unclear}`, 'fine'));
  const to = result.emails[0]?.email || '';
  nodes.push(
    el(
      'p',
      to
        ? `Email found on ${new URL(result.emails[0].sourceUrl).hostname}: ${to}. Double-check it on the lab’s page.`
        : 'We couldn’t find their email on a public page. Check the lab website or the university directory.',
      'fine',
    ),
  );
  const write = el('button', 'Write my email', 'button');
  write.type = 'button';
  nodes.push(write);
  brief.replaceChildren(...nodes);

  const draft = async () => {
    write.disabled = true;
    loading(mail, 'Writing your email…');
    mail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    try {
      const { email, remaining } = await proPost('/api/pro/email', {
        labId: lab.id,
        briefing: b,
        profile: profilePayload(),
        resume,
      });
      emailEditor(mail, lab, email, {
        to,
        regenerate: draft,
        onSent: (sentMail) => {
          setOutreach(lab.id, { ...sentMail, briefing: b, labTitle: lab.title, pi: lab.pi, institution: lab.institution });
          const followUp = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
          const result2 = track({ id: lab.id, title: `${lab.pi}, ${lab.institution}`, url: lab.url });
          updateApplication(lab.id, {
            status: 'Applied',
            deadline: followUp,
            notes: `Emailed ${shortDate(new Date())}${sentMail.to ? ` to ${sentMail.to}` : ''}. Follow up if no reply by ${shortDate(followUp)}.`,
          });
          closeDialog();
          celebrate();
          toast(result2 === 'full' ? 'Applications is full.' : 'Sent! Added to Applications with a follow-up countdown.');
        },
      });
      if (typeof remaining === 'number') status.remaining = { ...(status.remaining || {}), email: remaining };
      // proPost refreshed the plan counts already.
    } catch (e) {
      mail.replaceChildren(el('p', e.message, 'form-error'));
    } finally {
      write.disabled = false;
    }
  };
  write.addEventListener('click', draft);
}

/** Follow-up from the Applications board, for labs the student emailed through Fieldwork. */
export async function draftFollowUp(app) {
  const sent = getOutreach(app.id);
  if (!sent) {
    toast('We only have follow-ups for emails written here.');
    return;
  }
  if (!(await ensurePro('Follow up with this professor'))) return;
  const body = openDialog(`Follow up with ${sent.pi || 'the professor'}`, []);
  body.closest('dialog').classList.add('wide');
  const mail = el('div', null, 'mail');
  body.append(mail);
  loading(mail, 'Writing a short follow-up…');
  try {
    const { email } = await proPost('/api/pro/email', {
      labId: app.id,
      briefing: sent.briefing || {},
      profile: profilePayload(),
      resume: getResume(),
      kind: 'followup',
      previous: `Subject: ${sent.subject}\n\n${sent.body}`,
    });
    emailEditor(mail, null, { subject: email.subject.startsWith('Re:') ? email.subject : `Re: ${sent.subject}`, body: email.body }, {
      to: sent.to,
      regenerate: () => draftFollowUp(app),
      onSent: () => {
        const next = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
        updateApplication(app.id, {
          deadline: next,
          notes: `${app.notes ? app.notes + ' ' : ''}Followed up ${shortDate(new Date())}.`.slice(0, 1000),
        });
        closeDialog();
        toast('Noted. If there’s still no reply in two weeks, it’s fine to move on.');
      },
    });
  } catch (e) {
    mail.replaceChildren(el('p', e.message, 'form-error'));
  }
}

export function hasOutreach(id) {
  return !!getOutreach(id);
}

export async function initPro(c) {
  config = { ai: false, preview: false, checkout: null, ...(c || {}) };
  $('preview-code')?.addEventListener('click', previewCodeDialog);
  paintPlans();
  if (config.ai) await refreshStatus();
}
