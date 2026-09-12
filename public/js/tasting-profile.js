// Reusable "profilo di gusto" widget: flavour-note chips grouped by category,
// four taste sliders, and food-pairing chips. Mounted identically into both
// the bottle detail sheet's note composer (detail.js) and the add/edit-wine
// sheet (add.js) — same markup, same wiring, so the two contexts never drift
// into two different implementations of the same control.
const FLAVOR_CATEGORIES = [
  {
    id: 'frutta', label: 'Frutta', bg: '#f7e8e9', fg: '#8a3244',
    icon: '<svg viewBox="0 0 28 28" fill="currentColor"><circle cx="10" cy="16" r="5"/><circle cx="17" cy="12" r="5"/><circle cx="18" cy="20" r="4.5"/></svg>',
    tags: ['Frutti di bosco', 'Ciliegia', 'Prugna', 'Agrumi', 'Mela verde'],
  },
  {
    id: 'floreale', label: 'Floreale', bg: '#f5e9ef', fg: '#8a4a6a',
    icon: `<svg viewBox="0 0 28 28" fill="currentColor">
      <g transform="translate(14,14)">
        <ellipse cx="0" cy="-8" rx="3.4" ry="5.5"/>
        <g transform="rotate(72)"><ellipse cx="0" cy="-8" rx="3.4" ry="5.5"/></g>
        <g transform="rotate(144)"><ellipse cx="0" cy="-8" rx="3.4" ry="5.5"/></g>
        <g transform="rotate(216)"><ellipse cx="0" cy="-8" rx="3.4" ry="5.5"/></g>
        <g transform="rotate(288)"><ellipse cx="0" cy="-8" rx="3.4" ry="5.5"/></g>
        <circle cx="0" cy="0" r="3" fill="#f5e9ef"/>
      </g>
    </svg>`,
    tags: ['Rosa', 'Violetta', 'Fiori bianchi'],
  },
  {
    id: 'spezie', label: 'Spezie', bg: '#f7f0e2', fg: '#8a6a24',
    icon: `<svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
      <rect x="9" y="10" width="10" height="13" rx="2.5"/>
      <rect x="11" y="6" width="6" height="4" rx="1.2"/>
      <circle cx="12.5" cy="16" r="0.9" fill="currentColor" stroke="none"/>
      <circle cx="15.5" cy="18.5" r="0.9" fill="currentColor" stroke="none"/>
      <circle cx="13.5" cy="20" r="0.9" fill="currentColor" stroke="none"/>
    </svg>`,
    tags: ['Pepe nero', 'Vaniglia', 'Liquirizia', 'Chiodi di garofano'],
  },
  {
    id: 'legno', label: 'Legno', bg: '#efe6dc', fg: '#6a4a2a',
    icon: '<svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="14" cy="14" r="9"/><circle cx="14" cy="14" r="5.5"/><circle cx="14" cy="14" r="2"/></svg>',
    tags: ['Legno', 'Tabacco', 'Affumicato', 'Cuoio'],
  },
  {
    id: 'altro', label: 'Altro', bg: '#e9ece2', fg: '#4a5a3a',
    icon: '<svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4l7.5 6.5L14 24l-7.5-13.5z"/><path d="M7.5 10.5h13"/></svg>',
    tags: ['Minerale', 'Miele', 'Erbaceo', 'Burro'],
  },
];

const TASTE_AXES = [
  { id: 'acidity', left: 'Piatto', right: 'Acidulo' },
  { id: 'sweetness', left: 'Secco', right: 'Dolce' },
  { id: 'tannin', left: 'Morbido', right: 'Tannico' },
  { id: 'body', left: 'Leggero', right: 'Strutturato' },
];

const FOOD_PAIRINGS = ['Manzo', 'Agnello', 'Selvaggina', 'Salumi', 'Formaggi stagionati', 'Pasta', 'Pesce', 'Pizza', 'Dolci', 'Cioccolato'];

const THUMB_W = 46;
const DEFAULT_VALUE = 50;

export function tastingProfileHtml() {
  const flavorCards = FLAVOR_CATEGORIES.map(
    (cat, i) => `
    <div class="flavor-card${i === 0 ? ' active' : ''}" data-cat="${cat.id}" style="background:${cat.bg};color:${cat.fg};">
      ${cat.icon}
      <span>${cat.label}</span>
    </div>`,
  ).join('');
  const flavorPanels = FLAVOR_CATEGORIES.map(
    (cat, i) => `
    <div class="flavor-chip-panel${i === 0 ? '' : ' hidden'}" data-cat="${cat.id}">
      ${cat.tags.map((t) => `<div class="chip" data-toggle>${t}</div>`).join('')}
    </div>`,
  ).join('');
  const sliders = TASTE_AXES.map(
    (axis) => `
    <div class="taste-slider" data-axis="${axis.id}" data-value="${DEFAULT_VALUE}">
      <div class="taste-labels"><span class="tl-left">${axis.left}</span><span class="tl-right">${axis.right}</span></div>
      <div class="taste-track"><div class="taste-thumb"></div></div>
    </div>`,
  ).join('');
  const pairingChips = FOOD_PAIRINGS.map((p) => `<div class="chip" data-toggle>${p}</div>`).join('');

  return `
    <div>
      <div class="field-label" style="margin-bottom:8px;">Profilo aromatico</div>
      <div class="flavor-row">${flavorCards}</div>
      <div style="margin-top:12px;">${flavorPanels}</div>
    </div>
    <div style="display:flex;flex-direction:column;gap:14px;">
      <div class="field-label">Caratteristiche di gusto</div>
      ${sliders}
    </div>
    <div>
      <div class="field-label" style="margin-bottom:8px;">Si abbina bene con</div>
      <div class="chip-row">${pairingChips}</div>
    </div>`;
}

function positionThumb(slider) {
  const track = slider.querySelector('.taste-track');
  const thumb = slider.querySelector('.taste-thumb');
  const leftLabel = slider.querySelector('.tl-left');
  const rightLabel = slider.querySelector('.tl-right');
  const value = Number(slider.dataset.value) || DEFAULT_VALUE;
  const maxLeft = track.getBoundingClientRect().width - THUMB_W;
  thumb.style.left = (value / 100) * maxLeft + 'px';
  leftLabel.classList.toggle('dominant', value < 40);
  rightLabel.classList.toggle('dominant', value > 60);
}

// Wired once per sheet (the markup is inserted a single time, not re-rendered
// per open) — resetTastingProfile() below handles returning to a blank state
// on every subsequent open, instead of re-wiring listeners each time.
export function wireTastingProfile(root) {
  root.querySelectorAll('.chip[data-toggle]').forEach((chip) => {
    chip.addEventListener('click', () => chip.classList.toggle('active'));
  });

  const cards = root.querySelectorAll('.flavor-card');
  const panels = root.querySelectorAll('.flavor-chip-panel');
  cards.forEach((card) => {
    card.addEventListener('click', () => {
      cards.forEach((c) => c.classList.remove('active'));
      card.classList.add('active');
      panels.forEach((p) => p.classList.toggle('hidden', p.dataset.cat !== card.dataset.cat));
    });
  });

  root.querySelectorAll('.taste-slider').forEach((slider) => {
    const track = slider.querySelector('.taste-track');
    const setValue = (clientX) => {
      const rect = track.getBoundingClientRect();
      const raw = ((clientX - rect.left) / rect.width) * 100;
      slider.dataset.value = Math.round(Math.max(0, Math.min(100, raw)));
      positionThumb(slider);
    };
    track.addEventListener('pointerdown', (e) => {
      track.setPointerCapture(e.pointerId);
      setValue(e.clientX);
      const onMove = (ev) => setValue(ev.clientX);
      const onEnd = () => track.removeEventListener('pointermove', onMove);
      track.addEventListener('pointermove', onMove);
      track.addEventListener('pointerup', onEnd, { once: true });
      track.addEventListener('pointercancel', onEnd, { once: true });
    });
    positionThumb(slider);
  });
}

// Always returns the widget to a blank slate: called every time a sheet is
// opened (add, edit, or a fresh note) so a previous session's picks never
// leak into the next one — notes are append-only journal entries, not a
// single mutable record, so there is never saved profile data to restore
// here even when editing an existing wine's other fields.
export function resetTastingProfile(root) {
  root.querySelectorAll('.chip.active[data-toggle]').forEach((chip) => chip.classList.remove('active'));
  const cards = root.querySelectorAll('.flavor-card');
  const panels = root.querySelectorAll('.flavor-chip-panel');
  cards.forEach((c, i) => c.classList.toggle('active', i === 0));
  panels.forEach((p, i) => p.classList.toggle('hidden', i !== 0));
  root.querySelectorAll('.taste-slider').forEach((slider) => {
    slider.dataset.value = String(DEFAULT_VALUE);
    positionThumb(slider);
  });
}

export function readTastingProfile(root) {
  const flavorTags = Array.from(root.querySelectorAll('.flavor-chip-panel .chip.active[data-toggle]')).map((c) => c.textContent);
  const foodPairings = Array.from(root.querySelectorAll('.chip-row .chip.active[data-toggle]')).map((c) => c.textContent);
  const values = {};
  root.querySelectorAll('.taste-slider').forEach((slider) => {
    values[slider.dataset.axis] = Number(slider.dataset.value) || DEFAULT_VALUE;
  });
  return {
    flavorTags,
    foodPairings,
    tasteAcidity: values.acidity,
    tasteSweetness: values.sweetness,
    tasteTannin: values.tannin,
    tasteBody: values.body,
  };
}

export function isTastingProfileEmpty(profile) {
  return (
    profile.flavorTags.length === 0 &&
    profile.foodPairings.length === 0 &&
    profile.tasteAcidity === DEFAULT_VALUE &&
    profile.tasteSweetness === DEFAULT_VALUE &&
    profile.tasteTannin === DEFAULT_VALUE &&
    profile.tasteBody === DEFAULT_VALUE
  );
}

// For rendering a saved note's taste axes back as compact text (only the
// leaning sides, same dominant/neutral threshold as the sliders themselves)
// instead of redrawing four progress bars per historical note.
export function tasteSummary(note) {
  const parts = [];
  for (const axis of TASTE_AXES) {
    const value = note[`taste_${axis.id}`];
    if (value == null) continue;
    if (value < 40) parts.push(axis.left);
    else if (value > 60) parts.push(axis.right);
  }
  return parts.join(' · ');
}
