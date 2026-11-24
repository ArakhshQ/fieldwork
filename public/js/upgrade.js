// Checkout page: attaches the Paddle subscription to the signed-in student.
const $ = (id) => document.getElementById(id);
const say = (text) => ($('upgrade-status').textContent = text);

function loadPaddle() {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.paddle.com/paddle/v2/paddle.js';
    s.onload = () => resolve(window.Paddle);
    s.onerror = () => reject(new Error('Paddle failed to load'));
    document.head.append(s);
  });
}

async function start() {
  let config;
  try {
    config = await fetch('/api/config').then((r) => r.json());
  } catch {
    say('Couldn’t reach Fieldwork. Check your connection and refresh.');
    return;
  }
  const checkout = config.pro?.checkout;
  if (!checkout) {
    say('Gold checkout opens soon. Everything else in Fieldwork is free to use now.');
    return;
  }
  if (!config.accounts || !window.supabase?.createClient) {
    say('Sign-in isn’t available yet, so Gold can’t be attached to an account. Check back soon.');
    return;
  }
  const db = window.supabase.createClient(config.accounts.url, config.accounts.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  const { data } = await db.auth.getSession();
  const user = data.session?.user;
  if (!user) {
    $('upgrade-status').replaceChildren(
      document.createTextNode('Sign in first, so Gold is attached to your account. '),
      Object.assign(document.createElement('a'), { href: '/#profile', textContent: 'Go to sign in' }),
    );
    return;
  }

  let Paddle;
  try {
    Paddle = await loadPaddle();
  } catch {
    say('The checkout couldn’t load. Turn off any content blocker for this page and refresh.');
    return;
  }
  if (checkout.environment === 'sandbox') Paddle.Environment.set('sandbox');
  Paddle.Initialize({
    token: checkout.token,
    eventCallback(event) {
      if (event.name === 'checkout.completed') {
        Paddle.Checkout.close();
        $('upgrade-plans').hidden = true;
        $('upgrade-status').replaceChildren(
          document.createTextNode('Thank you! Gold is being switched on, which takes up to a minute. '),
          Object.assign(document.createElement('a'), { href: '/#discover', textContent: 'Back to Fieldwork' }),
        );
      }
    },
  });

  say(`Signed in as ${user.email}.`);
  $('upgrade-plans').hidden = false;
  $('season-plan').hidden = !checkout.prices.season;
  for (const b of document.querySelectorAll('[data-plan]'))
    b.addEventListener('click', () => {
      const priceId = checkout.prices[b.dataset.plan];
      if (!priceId) return;
      Paddle.Checkout.open({
        items: [{ priceId, quantity: 1 }],
        customer: { email: user.email },
        customData: { user_id: user.id },
      });
    });
}

start();
