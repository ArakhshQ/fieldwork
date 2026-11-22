import { $, toast, closeOnBackdrop } from './ui.js';
import { subscribe, getState, initAccounts, onSyncError } from './store.js';
import { initDiscover, setSearchAvailability, presetType } from './discover.js';
import { initSaved, renderSaved } from './saved.js';
import { initApplications, renderBoard } from './applications.js';
import { initProfile, renderProfile, renderAccountButton } from './profile.js';
import { initPro, refreshStatus, planLabel } from './pro.js';
import { renderHome } from './home.js';
import { showStudio } from './studio.js';
import { hydrateIcons } from './icons.js';

const VIEWS = ['home', 'discover', 'saved', 'applications', 'ai', 'plans', 'profile'];
const TITLES = { home: 'Home', discover: 'Discover', saved: 'Saved', applications: 'Applications', ai: 'AI Studio', plans: 'Plans', profile: 'Profile' };
let proReady = false;

/** "#ai/resume" -> { view: 'ai', sub: 'resume' } */
function route() {
  const [view, sub = ''] = location.hash.replace('#', '').split('/');
  return VIEWS.includes(view) ? { view, sub } : { view: 'home', sub: '' };
}

function show() {
  const { view, sub } = route();
  for (const section of document.querySelectorAll('main > .view')) section.hidden = section.dataset.view !== view;
  for (const link of document.querySelectorAll('a[data-view]')) {
    if (link.dataset.view === view) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  document.title = view === 'home' ? 'Fieldwork · Research and internships for students' : `${TITLES[view]} · Fieldwork`;
  if (view === 'home') renderHome();
  if (view === 'ai') showStudio(sub);
  if ((view === 'plans' || view === 'ai') && proReady) refreshStatus();
}

function renderMe() {
  const { profile, user } = getState();
  const name = profile.name || (user?.email ? user.email.split('@')[0] : '');
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  $('me-avatar').textContent = initial;
  $('top-avatar').textContent = initial;
  $('me-name').textContent = name || 'Your profile';
  $('me-plan').textContent = planLabel();
}

function renderAll() {
  const { saved } = getState();
  $('saved-count').textContent = String(saved.length);
  renderSaved();
  renderBoard();
  renderProfile();
  renderAccountButton();
  renderMe();
  if (route().view === 'home') renderHome();
}

async function start() {
  hydrateIcons();
  closeOnBackdrop($('dialog'));
  $('dialog-close').addEventListener('click', () => $('dialog').close());
  onSyncError(toast);
  subscribe(renderAll);

  initDiscover();
  initSaved();
  initApplications();
  initProfile();

  // Shortcut tiles (Home, AI Studio) that open Discover set to research or internships.
  document.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    if (go) presetType(go.dataset.go);
  });

  // Supabase puts sign-in tokens in the URL hash; don't treat that as a view.
  if (/error_description=/.test(location.hash)) toast('That sign-in link has expired or was already used. Request a new one.');
  window.addEventListener('hashchange', () => {
    show();
    if (route().view !== 'discover') scrollTo({ top: 0 });
  });
  window.addEventListener('fieldwork:plan', renderMe);
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
  proReady = !!config.pro?.ai;
  await initPro(config.pro);
  await initAccounts(config.accounts, {
    onMoved: (n) => toast(`Moved ${n} item${n === 1 ? '' : 's'} from this browser into your account.`),
  });
  if (wasSignedIn || /access_token=|error_description=/.test(location.hash)) {
    history.replaceState(null, '', location.pathname + '#home');
    show();
    if (wasSignedIn && getState().user) toast(`Signed in as ${getState().user.email}.`);
  }
  if (proReady && getState().user) refreshStatus();
  renderMe();
}

start();
