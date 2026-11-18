// Applications board: drag cards between stages (or use the stage menu).
import { $, el, externalLink, toast, daysUntil, openDialog, closeDialog, safeLink } from './ui.js';
import { getState, STAGES, updateApplication, removeApplication, track, exportData } from './store.js';

let dragId = null;

function deadlineChip(a) {
  const d = daysUntil(a.deadline);
  if (d === null || ['Offer', 'Closed'].includes(a.status)) return null;
  const text = d < 0 ? 'Deadline passed' : d === 0 ? 'Due today' : d === 1 ? 'Due tomorrow' : `${d} days left`;
  return el('span', text, `due ${d < 0 ? 'past' : d <= 7 ? 'soon' : 'later'}`);
}

function checklist(a) {
  const p = getState().profile;
  const body = openDialog(`Get ready: ${a.title}`, [
    'A general checklist to work through. It is not a list of this program’s exact requirements.',
  ]);
  const items = [
    !p.major && 'Add your field to your profile so searches and drafts fit you.',
    'Open the listing and confirm the current deadline and who can apply.',
    'Update your résumé or academic CV for this role.',
    'Write a short statement on why this lab or team, and what you want to learn.',
    'Check whether they ask for a transcript, references or a writing sample.',
    'Ask recommenders at least three weeks before the deadline.',
    'Read the whole application once more before you submit it.',
  ].filter(Boolean);
  const list = el('ul', null, 'checklist');
  for (const text of items) {
    const li = el('li');
    const label = el('label', null, 'check');
    const box = el('input');
    box.type = 'checkbox';
    label.append(box, el('span', text));
    li.append(label);
    list.append(li);
  }
  body.append(list);
  if (a.status === 'Saved') {
    const b = el('button', 'Move to Preparing', 'button');
    b.addEventListener('click', () => {
      updateApplication(a.id, { status: 'Preparing' });
      closeDialog();
      toast('Moved to Preparing.');
    });
    body.append(b);
  }
}

function card(a) {
  const node = el('article', null, 'app-card');
  node.draggable = true;
  node.dataset.id = a.id;
  node.addEventListener('dragstart', (e) => {
    dragId = a.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', a.id);
    requestAnimationFrame(() => node.classList.add('dragging'));
  });
  node.addEventListener('dragend', () => {
    dragId = null;
    node.classList.remove('dragging');
  });

  const top = el('div', null, 'app-top');
  top.append(el('h4', a.title));
  const chip = deadlineChip(a);
  if (chip) top.append(chip);
  node.append(top);
  if (safeLink(a.url)) node.append(externalLink('Open listing', a.url, 'app-link'));

  const more = el('details', null, 'app-more');
  more.append(el('summary', 'Details'));
  const stageLabel = el('label', 'Stage');
  const stage = el('select');
  for (const s of STAGES) stage.append(el('option', s));
  stage.value = a.status;
  stage.addEventListener('change', () => updateApplication(a.id, { status: stage.value }));
  stageLabel.append(stage);
  const dueLabel = el('label', 'Your deadline');
  const due = el('input');
  due.type = 'date';
  due.value = a.deadline || '';
  due.addEventListener('change', () => updateApplication(a.id, { deadline: due.value }));
  dueLabel.append(due);
  const notesLabel = el('label', 'Notes');
  const notes = el('textarea');
  notes.maxLength = 1000;
  notes.rows = 3;
  notes.placeholder = 'Next step, contact, requirements…';
  notes.value = a.notes || '';
  notes.addEventListener('change', () => updateApplication(a.id, { notes: notes.value }));
  notesLabel.append(notes);
  const actions = el('div', null, 'app-actions');
  const prep = el('button', 'Checklist', 'button small ghost');
  prep.type = 'button';
  prep.addEventListener('click', () => checklist(a));
  const remove = el('button', 'Remove', 'link-button danger');
  remove.type = 'button';
  remove.addEventListener('click', () => {
    if (confirm(`Remove “${a.title}” from Applications?`)) removeApplication(a.id);
  });
  actions.append(prep, remove);
  more.append(stageLabel, dueLabel, notesLabel, actions);
  node.append(more);
  return node;
}

export function renderBoard() {
  const board = $('board');
  const open = new Set([...board.querySelectorAll('details[open]')].map((d) => d.closest('.app-card')?.dataset.id));
  board.replaceChildren();
  const apps = getState().applications;
  for (const stage of STAGES) {
    const col = el('section', null, 'column');
    col.dataset.stage = stage;
    const items = apps.filter((a) => a.status === stage);
    const head = el('h3');
    head.append(el('span', stage), el('span', String(items.length), 'count'));
    col.append(head);
    const list = el('div', null, 'column-list');
    for (const a of items) {
      const c = card(a);
      if (open.has(a.id)) c.querySelector('details').open = true;
      list.append(c);
    }
    if (!items.length) list.append(el('p', stage === 'Saved' ? 'Track a result to start.' : 'Drop a card here.', 'column-empty'));
    col.append(list);
    col.addEventListener('dragover', (e) => {
      if (!dragId) return;
      e.preventDefault();
      col.classList.add('over');
    });
    col.addEventListener('dragleave', (e) => {
      if (!col.contains(e.relatedTarget)) col.classList.remove('over');
    });
    col.addEventListener('drop', (e) => {
      e.preventDefault();
      col.classList.remove('over');
      const id = dragId || e.dataTransfer.getData('text/plain');
      const app = getState().applications.find((x) => x.id === id);
      if (app && app.status !== stage) {
        updateApplication(id, { status: stage });
        toast(`Moved to ${stage}.`);
      }
    });
    board.append(col);
  }
}

function addApplicationDialog() {
  const body = openDialog('Add an application', ['For anything you found outside Fieldwork.']);
  const form = el('form', null, 'stack');
  const titleLabel = el('label', 'Title');
  const title = el('input');
  title.required = true;
  title.maxLength = 200;
  title.placeholder = 'e.g. Summer research, Smith Lab';
  titleLabel.append(title);
  const urlLabel = el('label', 'Link (optional)');
  const url = el('input');
  url.type = 'url';
  url.placeholder = 'https://';
  urlLabel.append(url);
  const submit = el('button', 'Add to Applications', 'button');
  form.append(titleLabel, urlLabel, submit);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (url.value && !safeLink(url.value)) {
      url.setCustomValidity('Use a link that starts with http:// or https://');
      url.reportValidity();
      return;
    }
    const result = track({ id: crypto.randomUUID(), title: title.value.trim(), url: url.value });
    closeDialog();
    toast(result === 'full' ? 'Applications is full. Remove an old one first.' : 'Added to Applications.');
  });
  url.addEventListener('input', () => url.setCustomValidity(''));
  body.append(form);
  title.focus();
}

export function initApplications() {
  $('add-application').addEventListener('click', addApplicationDialog);
  $('export-data').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(exportData(), null, 2)], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const a = el('a');
    a.href = href;
    a.download = 'fieldwork-export.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  });
}
