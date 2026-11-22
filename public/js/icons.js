// A small hand-drawn icon set (24×24, 2px round strokes). Static markup only.
const P = {
  home: '<path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z"/>',
  compass: '<circle cx="12" cy="12" r="8.5"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  bookmark: '<path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z"/>',
  board: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.5 4.5v15M15 4.5v9"/>',
  sparkle: '<path d="M12 3.5 13.8 9a2 2 0 0 0 1.2 1.2l5.5 1.8-5.5 1.8a2 2 0 0 0-1.2 1.2L12 20.5 10.2 15a2 2 0 0 0-1.2-1.2L3.5 12 9 10.2A2 2 0 0 0 10.2 9z"/>',
  crown: '<path d="m4 8 4 3.5L12 5l4 6.5L20 8l-1.5 10h-13z"/>',
  user: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
  chat: '<path d="M5 5h14a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 17h-8l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 5 5z"/><path d="M8 10h8M8 13h5"/>',
  file: '<path d="M6.5 3.5h7l4 4v12a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z"/><path d="M13.5 3.5v4h4M9 12h6M9 15.5h6"/>',
  pen: '<path d="m14.5 5.5 4 4L9 19l-4.5.5L5 15z"/><path d="m12.5 7.5 4 4"/>',
  checklist: '<path d="m4.5 7 1.5 1.5L9 5.5M4.5 13l1.5 1.5L9 11.5M4.5 19l1.5 1.5L9 17.5M12 7h7.5M12 13h7.5M12 19h7.5"/>',
  mic: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5"/>',
  mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m4 7 8 6 8-6"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  upload: '<path d="M12 15.5V4.5m-4.5 4.5L12 4.5 16.5 9M5 15.5V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  flask: '<path d="M9.5 3.5h5M10.5 3.5v6L5 18.5A1.3 1.3 0 0 0 6.1 20.5h11.8a1.3 1.3 0 0 0 1.1-2L13.5 9.5v-6"/><path d="M7.5 15h9"/>',
  briefcase: '<rect x="3.5" y="7" width="17" height="12.5" rx="2"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3.5 12.5h17"/>',
  send: '<path d="m4 12 16-8-6 16-2.5-6.5z"/><path d="M20 4 11.5 13.5"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  bolt: '<path d="M13 3.5 5.5 13.5H12l-1 7 7.5-10H12z"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4"/>',
};

export function icon(name, className = 'icon') {
  const span = document.createElement('span');
  span.className = className;
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${P[name] || ''}</svg>`;
  return span;
}

/** Fill every element with data-icon="name" in the page. */
export function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) {
    if (el.querySelector(':scope > .icon')) continue;
    el.prepend(icon(el.dataset.icon));
  }
}
