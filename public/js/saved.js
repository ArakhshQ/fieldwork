// Saved: the shortlist, with a compare tray for two or three picks.
import { $, el, externalLink, openDialog, toast } from './ui.js';
import { getState } from './store.js';
import { opportunityCard, trackButton } from './cards.js';

const chosen = new Set();

function paintTray() {
  const n = chosen.size;
  $('compare-tray').hidden = n === 0;
  $('compare-count').textContent = `${n} of 3 selected`;
  $('compare-go').disabled = n < 2;
}

export function renderSaved() {
  const { saved } = getState();
  for (const id of [...chosen]) if (!saved.some((s) => s.id === id)) chosen.delete(id);
  $('saved-empty').hidden = saved.length > 0;
  $('saved-sub').hidden = saved.length === 0;
  const cards = $('saved-cards');
  cards.replaceChildren(
    ...saved.map((r) =>
      opportunityCard(r, {
        select: {
          checked: chosen.has(r.id),
          onChange: (on, box) => {
            if (on && chosen.size >= 3) {
              box.checked = false;
              toast('Compare up to three at a time.');
              return;
            }
            on ? chosen.add(r.id) : chosen.delete(r.id);
            paintTray();
          },
        },
      }),
    ),
  );
  paintTray();
}

function compare() {
  const picks = getState().saved.filter((r) => chosen.has(r.id));
  const body = openDialog('Side by side', [
    'Excerpts from each page. Anything missing wasn’t found on the page, so check the listing.',
  ]);
  body.closest('dialog').classList.add('wide');
  const grid = el('div', null, 'compare-grid');
  grid.style.setProperty('--cols', picks.length);
  const rows = [
    ['Availability', (r) => r.evidence],
    ['Deadline', (r) => r.deadlineEvidence],
    ['Funding', (r) => r.fundingEvidence],
    ['Eligibility', (r) => r.eligibilityEvidence],
  ];
  grid.append(el('div', '', 'compare-corner'));
  for (const r of picks) {
    const h = el('div', null, 'compare-title');
    h.append(externalLink(r.title, r.url), el('span', r.host || '', 'fine'));
    grid.append(h);
  }
  for (const [label, get] of rows) {
    grid.append(el('div', label, 'compare-label'));
    for (const r of picks) {
      const v = get(r);
      grid.append(el('div', v || 'Not found', v ? 'compare-cell' : 'compare-cell missing'));
    }
  }
  grid.append(el('div', '', 'compare-label'));
  for (const r of picks) {
    const c = el('div', null, 'compare-cell');
    c.append(trackButton(r));
    grid.append(c);
  }
  body.append(grid);
}

export function initSaved() {
  $('compare-go').addEventListener('click', compare);
  $('compare-clear').addEventListener('click', () => {
    chosen.clear();
    renderSaved();
  });
  $('dialog').addEventListener('close', () => $('dialog').classList.remove('wide'));
}
