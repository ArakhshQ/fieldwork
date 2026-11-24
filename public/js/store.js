// The student's workspace: profile, saved opportunities and applications.
//
// Signed out: everything lives in this browser's localStorage (same keys as the
// original beta, so nobody loses data in the upgrade).
// Signed in: Supabase is the source of truth and localStorage is a cache. On the
// first sign-in, anything saved in this browser is moved into the account.

const KEYS = {
  profile: 'fieldwork-profile',
  saved: 'fieldwork-live-saved',
  applications: 'fieldwork-applications',
  owner: 'fieldwork-owner',
};
export const STAGES = ['Saved', 'Preparing', 'Applied', 'Interview', 'Offer', 'Closed'];
export const LIMIT = 200;
const PROFILE_FIELDS = ['name', 'school', 'major', 'level', 'city', 'state', 'radius', 'interests', 'available', 'work'];

const read = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};
const isUrl = (v) => typeof v === 'string' && /^https?:\/\//.test(v);

function cleanProfile(p) {
  const out = {};
  if (!p || typeof p !== 'object' || Array.isArray(p)) return out;
  for (const k of PROFILE_FIELDS) if (typeof p[k] === 'string' && p[k]) out[k] = p[k];
  if (typeof p.radius === 'number') out.radius = String(p.radius);
  // The first beta stored one free-text location; keep it as the city.
  if (!out.city && typeof p.location === 'string' && p.location) out.city = p.location.slice(0, 80);
  return out;
}

const state = {
  profile: cleanProfile(read(KEYS.profile, {})),
  saved: (Array.isArray(read(KEYS.saved, [])) ? read(KEYS.saved, []) : [])
    .filter((r) => r && typeof r.id === 'string' && isUrl(r.url))
    .slice(0, LIMIT),
  applications: (Array.isArray(read(KEYS.applications, [])) ? read(KEYS.applications, []) : [])
    .filter((a) => a && typeof a.id === 'string' && typeof a.title === 'string')
    .map((a) => ({ ...a, status: STAGES.includes(a.status) ? a.status : 'Saved' }))
    .slice(0, LIMIT),
  user: null,
  accounts: false,
};

const listeners = new Set();
export const subscribe = (fn) => listeners.add(fn);
let onError = () => {};
export const onSyncError = (fn) => (onError = fn);

function emit() {
  write(KEYS.profile, state.profile);
  write(KEYS.saved, state.saved);
  write(KEYS.applications, state.applications);
  for (const fn of listeners) fn(state);
}

export const getState = () => state;

// The résumé never leaves this device except inside a Gold request the student starts.
const RESUME_KEY = 'fieldwork-resume';
const OUTREACH_KEY = 'fieldwork-outreach';
export const getResume = () => read(RESUME_KEY, '') || '';
export const setResume = (text) => write(RESUME_KEY, String(text || '').slice(0, 6000));
/** Emails a student said they sent, by lab id, so follow-ups can build on them. */
export const getOutreach = (id) => read(OUTREACH_KEY, {})[id] || null;
export function setOutreach(id, entry) {
  const all = read(OUTREACH_KEY, {});
  all[id] = { ...entry, at: new Date().toISOString() };
  const ids = Object.keys(all).sort((a, b) => (all[b].at || '').localeCompare(all[a].at || ''));
  for (const old of ids.slice(LIMIT)) delete all[old];
  write(OUTREACH_KEY, all);
}
/** The signed-in student's session token, for Gold requests. */
export async function accessToken() {
  if (!db || !state.user) return '';
  const { data } = await db.auth.getSession();
  return data.session?.access_token || '';
}
export const isSaved = (id) => state.saved.some((s) => s.id === id);

// ---- Cloud ---------------------------------------------------------------
let db = null;

async function cloud(label, run) {
  if (!db || !state.user) return;
  try {
    const { error } = await run();
    if (error) throw error;
  } catch (e) {
    console.warn('Sync failed:', label, e);
    onError(
      /Limit of/.test(e?.message || '')
        ? `You've reached the limit of ${LIMIT} items. Remove a few to add more.`
        : 'Not synced. Your change is kept on this device; check your connection.',
    );
  }
}

const savedRow = (r) => {
  const { id, url, title, savedAt, ...data } = r;
  return { id, url, title: (title || url).slice(0, 300), data, saved_at: savedAt || new Date().toISOString() };
};
const fromSavedRow = (row) => ({ ...row.data, id: row.id, url: row.url, title: row.title, savedAt: row.saved_at });
const appRow = (a) => ({
  id: a.id,
  title: a.title.slice(0, 300),
  url: isUrl(a.url) ? a.url : null,
  status: a.status,
  deadline: a.deadline || null,
  notes: a.notes || null,
});
const fromAppRow = (row) => ({
  id: row.id,
  title: row.title,
  url: row.url || '',
  status: row.status,
  deadline: row.deadline || '',
  notes: row.notes || '',
});
const profileRow = (p, id) => ({
  id,
  name: p.name || null,
  school: p.school || null,
  major: p.major || null,
  level: p.level || null,
  city: p.city || null,
  state: p.state || null,
  radius_miles: p.radius ? Number(p.radius) : null,
  interests: p.interests || null,
  available: p.available || null,
  work: p.work || null,
});
const fromProfileRow = (row) =>
  cleanProfile({ ...row, radius: row.radius_miles ? String(row.radius_miles) : '' });

/** Pull the account's data and fold in anything saved anonymously in this browser. */
async function loadAccount(user) {
  const owner = read(KEYS.owner, null);
  // Local data from a different account must never be uploaded into this one.
  const localIsMine = owner === null || owner === user.id;
  const local = localIsMine
    ? { profile: state.profile, saved: state.saved, applications: state.applications }
    : { profile: {}, saved: [], applications: [] };

  const [p, s, a] = await Promise.all([
    db.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    db.from('saved_opportunities').select('*').order('saved_at', { ascending: false }).limit(LIMIT),
    db.from('applications').select('*').order('created_at', { ascending: false }).limit(LIMIT),
  ]);
  if (p.error || s.error || a.error) throw p.error || s.error || a.error;

  const remoteSaved = s.data.map(fromSavedRow);
  const remoteApps = a.data.map(fromAppRow);
  const newSaved = local.saved.filter((r) => !remoteSaved.some((x) => x.id === r.id));
  const newApps = local.applications.filter((r) => !remoteApps.some((x) => x.id === r.id));
  const remoteProfile = p.data ? fromProfileRow(p.data) : {};
  const profile = Object.keys(remoteProfile).length ? remoteProfile : local.profile;

  if (newSaved.length)
    await db.from('saved_opportunities').upsert(newSaved.slice(0, LIMIT - remoteSaved.length).map(savedRow));
  if (newApps.length)
    await db.from('applications').upsert(newApps.slice(0, LIMIT - remoteApps.length).map(appRow));
  if (!p.data && Object.keys(profile).length) await db.from('profiles').upsert(profileRow(profile, user.id));

  state.saved = [...newSaved, ...remoteSaved].slice(0, LIMIT);
  state.applications = [...newApps, ...remoteApps].slice(0, LIMIT);
  state.profile = profile;
  write(KEYS.owner, user.id);
  return newSaved.length + newApps.length;
}

/** Wire up accounts. Returns the Supabase client, or null when accounts are off. */
export async function initAccounts(config, { onMoved } = {}) {
  if (!config?.url || !config?.key || !window.supabase?.createClient) {
    emit();
    return null;
  }
  db = window.supabase.createClient(config.url, config.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
  });
  state.accounts = true;

  let first = true;
  const handle = async (session) => {
    const user = session?.user || null;
    if (!first && user?.id === state.user?.id) return;
    first = false;
    state.user = user;
    if (!user && read(KEYS.owner, null)) {
      // A cached copy of an account whose session has ended: don't show it to
      // whoever is using this browser now.
      state.profile = {};
      state.saved = [];
      state.applications = [];
      localStorage.removeItem(KEYS.owner);
    }
    if (user) {
      try {
        const moved = await loadAccount(user);
        if (moved && onMoved) onMoved(moved);
      } catch (e) {
        console.warn('Could not load account', e);
        onError('Signed in, but your saved data could not load. Refresh to try again.');
      }
    }
    emit();
  };
  const { data } = await db.auth.getSession();
  await handle(data.session);
  db.auth.onAuthStateChange((_event, session) => {
    // Supabase recommends not awaiting inside this callback.
    setTimeout(() => handle(session), 0);
  });
  return db;
}

export async function sendSignInLink(email) {
  if (!db) throw new Error('Accounts are not available yet.');
  const { error } = await db.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: location.origin + '/' },
  });
  if (error) throw error;
}

export async function signOut() {
  if (db) await db.auth.signOut();
  // The data lives in the account now; don't leave a copy on a shared computer.
  state.user = null;
  state.profile = {};
  state.saved = [];
  state.applications = [];
  emit();
  for (const key of [...Object.values(KEYS), RESUME_KEY, OUTREACH_KEY]) localStorage.removeItem(key);
}

// ---- Mutations -----------------------------------------------------------
export function toggleSave(r) {
  if (isSaved(r.id)) {
    state.saved = state.saved.filter((s) => s.id !== r.id);
    emit();
    cloud('unsave', () => db.from('saved_opportunities').delete().eq('id', r.id));
    return false;
  }
  if (state.saved.length >= LIMIT) {
    onError(`You can save up to ${LIMIT} opportunities. Remove a few to add more.`);
    return false;
  }
  const item = { ...r, savedAt: new Date().toISOString() };
  state.saved = [item, ...state.saved];
  emit();
  cloud('save', () => db.from('saved_opportunities').upsert(savedRow(item)));
  return true;
}

/** Add an opportunity to the tracker. Returns 'added', 'exists' or 'full'. */
export function track(r) {
  if (state.applications.some((a) => a.id === r.id)) return 'exists';
  if (state.applications.length >= LIMIT) return 'full';
  const app = { id: r.id, title: r.title, url: r.url || '', status: 'Saved', deadline: '', notes: '' };
  state.applications = [app, ...state.applications];
  emit();
  cloud('track', () => db.from('applications').upsert(appRow(app)));
  return 'added';
}

export function updateApplication(id, patch) {
  const app = state.applications.find((a) => a.id === id);
  if (!app) return;
  Object.assign(app, patch);
  emit();
  cloud('update', () => db.from('applications').update(appRow(app)).eq('id', id));
}

export function removeApplication(id) {
  state.applications = state.applications.filter((a) => a.id !== id);
  emit();
  cloud('remove', () => db.from('applications').delete().eq('id', id));
}

export function saveProfile(p) {
  state.profile = cleanProfile(p);
  emit();
  if (state.user) cloud('profile', () => db.from('profiles').upsert(profileRow(state.profile, state.user.id)));
}

/** Delete everything: this browser's copy and, when signed in, the account's rows. */
export async function deleteWorkspace() {
  if (db && state.user) {
    const results = await Promise.all([
      db.from('saved_opportunities').delete().eq('user_id', state.user.id),
      db.from('applications').delete().eq('user_id', state.user.id),
      db.from('profiles').delete().eq('id', state.user.id),
    ]);
    const failed = results.find((r) => r.error);
    if (failed) throw failed.error;
  }
  state.profile = {};
  state.saved = [];
  state.applications = [];
  localStorage.removeItem(RESUME_KEY);
  localStorage.removeItem(OUTREACH_KEY);
  emit();
}

export function exportData() {
  return {
    exportedAt: new Date().toISOString(),
    account: state.user ? state.user.email : null,
    profile: state.profile,
    saved: state.saved,
    applications: state.applications,
  };
}
