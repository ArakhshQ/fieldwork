// Profile form and account sign-in.
import { $, el, toast, openDialog, closeDialog, fillStateSelect } from './ui.js';
import { getState, saveProfile, deleteWorkspace, sendSignInLink, signOut, getResume, setResume } from './store.js';

export function renderProfile() {
  const { profile, user, accounts } = getState();
  const form = $('profile-form');
  for (const field of form.elements) {
    if (!field.name || document.activeElement === field) continue;
    field.value = profile[field.name] || '';
  }
  if (document.activeElement !== $('resume')) $('resume').value = getResume();
  $('profile-where').textContent = user
    ? `Synced to ${user.email}.`
    : accounts
      ? 'Saved on this device. Sign in to keep it in sync everywhere.'
      : 'Saved on this device.';
  $('clear-data').textContent = user ? 'Delete my saved data' : 'Delete my workspace';
}

export function renderAccountButton() {
  const { user, accounts } = getState();
  const b = $('account-button');
  b.hidden = !accounts;
  b.classList.toggle('signed-in', !!user);
  if (user) {
    b.textContent = 'Account';
    b.setAttribute('aria-label', `Account: ${user.email}`);
    b.title = user.email;
  } else {
    b.textContent = 'Sign in';
    b.removeAttribute('aria-label');
    b.title = '';
  }
}

function signInDialog() {
  const body = openDialog('Sign in to Fieldwork', [
    'We’ll email you a link. Open it on this device and you’re in. No password needed.',
  ]);
  const form = el('form', null, 'stack');
  const label = el('label', 'Email address');
  const email = el('input');
  email.type = 'email';
  email.required = true;
  email.autocomplete = 'email';
  email.placeholder = 'you@school.edu';
  label.append(email);
  const send = el('button', 'Email me a sign-in link', 'button');
  form.append(label, send);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    send.disabled = true;
    send.textContent = 'Sending…';
    try {
      await sendSignInLink(email.value.trim());
      body.replaceChildren(
        Object.assign(el('h2', 'Check your email'), { id: 'dialog-title' }),
        el('p', `We sent a sign-in link to ${email.value.trim()}. It can take a minute to arrive; check spam if you don’t see it.`),
        el('p', 'Anything you saved on this device will move into your account when you sign in.', 'fine'),
      );
    } catch (err) {
      send.disabled = false;
      send.textContent = 'Email me a sign-in link';
      const msg = /rate limit|too many/i.test(err.message || '')
        ? 'Too many sign-in emails were sent. Wait a few minutes and try again.'
        : err.message || 'The email could not be sent. Try again.';
      form.querySelector('.form-error')?.remove();
      form.append(el('p', msg, 'form-error'));
    }
  });
  body.append(form);
  email.focus();
}

function accountDialog() {
  const { user } = getState();
  const body = openDialog('Your account', [`Signed in as ${user.email}.`, 'Your profile, saved items and applications sync to every device where you sign in.']);
  const out = el('button', 'Sign out', 'button ghost');
  out.addEventListener('click', async () => {
    out.disabled = true;
    await signOut();
    closeDialog();
    toast('Signed out. Your data is safe in your account.');
  });
  body.append(out);
}

export function initProfile() {
  fillStateSelect($('profile-form').querySelector('[data-states]'), 'Choose a state');
  $('profile-form').addEventListener('submit', (e) => {
    e.preventDefault();
    // Save the résumé first: saving the profile re-renders the form.
    setResume($('resume').value);
    saveProfile(Object.fromEntries(new FormData(e.target)));
    $('profile-status').textContent = 'Profile saved.';
    toast('Profile saved.');
  });
  $('clear-data').addEventListener('click', async () => {
    const { user } = getState();
    const msg = user
      ? 'Delete your profile, saved opportunities and applications from your account? This cannot be undone. Export first if you want a copy.'
      : 'Delete your profile, saved opportunities and applications from this browser? Export first if you want a copy.';
    if (!confirm(msg)) return;
    try {
      await deleteWorkspace();
      $('profile-status').textContent = 'Your workspace was deleted.';
      toast('Workspace deleted.');
    } catch {
      toast('Could not delete everything. Check your connection and try again.');
    }
  });
  $('account-button').addEventListener('click', () => (getState().user ? accountDialog() : signInDialog()));
}
