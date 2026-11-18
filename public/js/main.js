import { $, toast, closeOnBackdrop } from './ui.js';
import { subscribe, getState, initAccounts, onSyncError } from './store.js';
import { initDiscover, setSearchAvailability } from './discover.js';
import { initSaved, renderSaved } from './saved.js';
import { initApplications, renderBoard } from './applications.js';
import { initProfile, renderProfile, renderAccountButton } from './profile.js';
import { initPro, refreshStatus } from './pro.js';

const VIEWS = ['discover', 'saved', 'applications', 'plans', 'profile'];
let proReady = false;

function currentView() {
  const v = location.hash.replace('#', '');
  return VIEWS.includes(v) ? v : 'discover';
}

function show() {
  const view = currentView();
  for (const section of document.querySelectorAll('main > .view')) section.hidden = section.dataset.view !== view;
  for (const link of document.querySelectorAll('[data-view]')) {
    if (link.tagName !== 'A') continue;
    if (link.dataset.view === view) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  document.title =
    view === 'discover' ? 'Fieldwork · Research and internships for students' : `${view[0].toUpperCase() + view.slice(1)} · Fieldwork`;
}

function renderAll() {
  const { saved } = getState();
  $('saved-count').textContent = String(saved.length);
  renderSaved();
  renderBoard();
  renderProfile();
  renderAccountButton();
}

async function start() {
  closeOnBackdrop($('dialog'));
  $('dialog-close').addEventListener('click', () => $('dialog').close());
  onSyncError(toast);
  subscribe(renderAll);

  initDiscover();
  initSaved();
  initApplications();
  initProfile();

  // Supabase puts sign-in tokens in the URL hash; don't treat that as a view.
  if (/access_token=|error_description=/.test(location.hash)) {
    if (/error_description=/.test(location.hash)) toast('That sign-in link has expired or was already used. Request a new one.');
  }
  window.addEventListener('hashchange', () => {
    show();
    if (currentView() === 'plans' && proReady) refreshStatus();
    if (currentView() !== 'discover') scrollTo({ top: 0 });
  });
  show();
  renderAll();

  let config = {};
  try {
    config = await fetch('/api/config').then((r) => r.json());
    setSearchAvailability(config);
  } catch {
    $('status').textContent = 'Couldn’t reach the server. Check your connection and refresh.';
  }
  const wasSignedIn = /access_token=/.test(location.hash);
  initPro(config.pro);
  proReady = !!config.pro?.ai;
  await initAccounts(config.accounts, {
    onMoved: (n) => toast(`Moved ${n} item${n === 1 ? '' : 's'} from this browser into your account.`),
  });
  if (wasSignedIn || /access_token=|error_description=/.test(location.hash)) {
    history.replaceState(null, '', location.pathname + '#discover');
    show();
    if (wasSignedIn && getState().user) toast(`Signed in as ${getState().user.email}.`);
  }
  if (config.pro?.ai && getState().user) refreshStatus();
}

start();
