// One opportunity card, used by search results and the Saved page.
import { el, externalLink, shortDate, toast } from './ui.js';
import { isSaved, toggleSave, track } from './store.js';

const SIGNALS = {
  live_posting: ['open', 'Live job posting'],
  active_award: ['open', 'Currently funded'],
  new_funding: ['open', 'New grant'],
  open_signal: ['open', 'Open wording found'],
  closed_signal: ['closed', 'Says applications are closed'],
};

const RIBBON =
  '<svg viewBox="0 0 20 28" aria-hidden="true"><path d="M2 1h16v25l-8-6-8 6z"/></svg>';

function ribbonButton(r) {
  const b = el('button', null, 'ribbon');
  b.type = 'button';
  b.innerHTML = RIBBON; // static markup only
  const sync = () => {
    const on = isSaved(r.id);
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', (on ? 'Remove from saved: ' : 'Save: ') + r.title);
    b.title = on ? 'Saved' : 'Save';
  };
  sync();
  b.addEventListener('click', () => {
    const on = toggleSave(r);
    sync();
    if (on) {
      b.classList.remove('drop');
      void b.offsetWidth;
      b.classList.add('drop');
    }
    toast(on ? 'Saved.' : 'Removed from saved.');
  });
  return b;
}

export function trackButton(r) {
  const b = el('button', 'Track application', 'button small ghost');
  b.type = 'button';
  b.addEventListener('click', () => {
    const result = track(r);
    toast(
      result === 'added'
        ? 'Added to Applications.'
        : result === 'exists'
          ? 'Already in Applications.'
          : 'Applications is full. Remove an old one first.',
    );
  });
  return b;
}

/**
 * @param r opportunity from /api/search (or a saved snapshot)
 * @param opts.select optional { checked, onChange } to show a compare checkbox
 */
export function opportunityCard(r, opts = {}) {
  const kind = r.group === 'labs' ? 'lab' : /intern/i.test(r.kind || '') ? 'internship' : /research/i.test(r.kind || '') ? 'research' : 'other';
  const card = el('article', null, `card kind-${kind}`);

  const head = el('div', null, 'card-head');
  head.append(el('span', r.kind || 'Opportunity', 'kind'));
  if (r.season) head.append(el('span', r.season, 'season'));
  head.append(el('span', r.host || '', 'host'));
  if (opts.select) {
    const label = el('label', null, 'pick');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = opts.select.checked;
    box.addEventListener('change', () => opts.select.onChange(box.checked, box));
    label.append(box, el('span', 'Compare'));
    head.append(label);
  }
  head.append(ribbonButton(r));

  const title = el('h3');
  title.append(externalLink(r.title || r.url, r.url));

  card.append(head, title, el('p', r.snippet || 'Open the listing for details.', 'snippet'));

  const [signalClass, signalText] = SIGNALS[r.status] || ['unknown', 'Availability not stated'];
  const signal = el('p', null, `signal ${signalClass}`);
  signal.append(el('mark', signalText));
  card.append(signal);

  // Each source gets labels that say what the details really are.
  const layouts = {
    labs: {
      summary: 'Show details',
      rows: [['Grant', r.evidence], ['Funding', r.fundingEvidence], ['How to get in', r.eligibilityEvidence]],
      note: 'From NIH and NSF grant records. This is not a job posting.',
    },
    programs: {
      summary: 'Show details',
      rows: [['Funding period', r.evidence], ['Deadline', r.deadlineEvidence], ['Stipend', r.fundingEvidence], ['Who can apply', r.eligibilityEvidence]],
      note: 'From NSF and NIH award records. Check the program’s site for this year’s dates.',
    },
    listings: {
      summary: 'Show details',
      rows: [['Status', r.evidence]],
      note: 'From the employer’s own job board. Open the posting for pay, dates and requirements.',
    },
  };
  const layout =
    layouts[r.group] ||
    (r.status === 'live_posting'
      ? layouts.listings
      : {
          summary: 'Show what the page says',
          rows: [['Availability', r.evidence], ['Deadline', r.deadlineEvidence], ['Funding', r.fundingEvidence], ['Eligibility', r.eligibilityEvidence]],
          note: 'Short excerpts from the page, not verified facts. Pages can describe past cycles.',
        });
  const rows = layout.rows.filter(([, v], i) => v || !r.group || i === 0);
  const found = rows.filter(([, v]) => v).length;
  const details = el('details', null, 'evidence');
  details.append(el('summary', found ? `${layout.summary} (${found})` : layout.summary));
  const dl = el('dl');
  for (const [label, value] of rows) {
    dl.append(el('dt', label), el('dd', value || 'Not found on the page. Check the listing.', value ? '' : 'missing'));
  }
  details.append(dl, el('p', layout.note, 'fine'));
  card.append(details);

  // Award records link to the grant page; help students find the program or lab itself.
  if (r.group === 'programs' && /(^|\.)(nsf|nih)\.gov$/.test(new URL(r.url, location.href).hostname)) {
    const q = `${r.host} ${r.title} summer research program`;
    card.append(externalLink('Find the program’s website', 'https://www.google.com/search?q=' + encodeURIComponent(q), 'card-link'));
  }
  if (r.group === 'labs' && r.pi) {
    const q = `${r.pi} lab ${r.title.split(', ').slice(1).join(', ')}`;
    card.append(externalLink('Find the lab’s website', 'https://www.google.com/search?q=' + encodeURIComponent(q), 'card-link'));
  }

  const foot = el('div', null, 'card-foot');
  foot.append(
    el(
      'span',
      r.savedAt
        ? `Saved ${shortDate(r.savedAt)}`
        : r.awardDate
          ? `Awarded ${shortDate(r.awardDate)}`
          : r.fundedThrough
            ? `Funded through ${shortDate(r.fundedThrough)}`
            : r.postedAt
              ? `Posted ${shortDate(r.postedAt)}`
              : `Found ${shortDate(r.foundAt)}`,
      'fine',
    ),
    trackButton(r),
  );
  card.append(foot);
  return card;
}
