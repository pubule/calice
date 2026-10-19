// Reusable "profilo di gusto" widget: flavour-note chips grouped by category,
// four taste sliders, and food-pairing chips. Mounted identically into both
// the bottle detail sheet's note composer (detail.js) and the add/edit-wine
// sheet (add.js) — same markup, same wiring, so the two contexts never drift
// into two different implementations of the same control.
// Aroma families follow the tasting lexicons sommeliers use (WSET's
// systematic approach, AIS): primary fruit/floral/vegetal/spice, secondary
// oak and lees/yeast (the whole Franciacorta/Champagne vocabulary), tertiary
// evolution, mineral, plus faults (so a corked bottle can be noted). Tags are stored as their plain label (flavor_tags is a
// JSON array of strings), so a label already used in saved notes must never
// be renamed — moving it to another family is harmless. No label may appear
// twice across families: readTastingProfile() would record it twice.
export const FLAVOR_CATEGORIES = [
  {
    id: 'frutta', label: 'Frutta', bg: '#f7e8e9', fg: '#8a3244',
    icon: '<svg viewBox="0 0 28 28" fill="currentColor"><circle cx="10" cy="16" r="5"/><circle cx="17" cy="12" r="5"/><circle cx="18" cy="20" r="4.5"/></svg>',
    tags: [
      'Fragola', 'Lampone', 'Ciliegia', 'Amarena', 'Ribes', 'Frutti di bosco', 'Mora', 'Mirtillo', 'Prugna',
      'Mela verde', 'Mela', 'Pera', 'Pesca', 'Albicocca', 'Agrumi', 'Limone', 'Pompelmo', 'Arancia',
      'Ananas', 'Mango', 'Frutto della passione', 'Banana', 'Melone', 'Fico', 'Uvetta', 'Frutta cotta', 'Confettura',
      'Litchi', 'Uva', 'Cassis', 'Ciliegia nera', 'Mirtillo rosso', 'Lime', "Scorza d'arancia", 'Nettarina',
      'Mela cotogna', 'Uva spina', 'Prugna secca', 'Albicocca secca', "Marmellata d'arancia", 'Kirsch', 'Dattero',
    ],
    // The note composer shows Frutta's 42 aromas in these sub-groups (every
    // tag in exactly one); `tags` above stays the flat list everyone else reads.
    groups: [
      { label: 'Frutti rossi e neri', tags: ['Fragola', 'Lampone', 'Ciliegia', 'Amarena', 'Ribes', 'Frutti di bosco', 'Mora', 'Mirtillo', 'Prugna', 'Cassis', 'Ciliegia nera', 'Mirtillo rosso'] },
      { label: 'Agrumi', tags: ['Agrumi', 'Limone', 'Pompelmo', 'Arancia', 'Lime', "Scorza d'arancia"] },
      { label: 'Frutta bianca e gialla', tags: ['Mela verde', 'Mela', 'Pera', 'Pesca', 'Albicocca', 'Nettarina', 'Mela cotogna', 'Uva spina', 'Uva', 'Melone'] },
      { label: 'Tropicale', tags: ['Ananas', 'Mango', 'Frutto della passione', 'Banana', 'Litchi'] },
      { label: 'Secca e cotta', tags: ['Fico', 'Uvetta', 'Frutta cotta', 'Confettura', 'Prugna secca', 'Albicocca secca', "Marmellata d'arancia", 'Kirsch', 'Dattero'] },
    ],
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
    tags: ['Rosa', 'Violetta', 'Fiori bianchi', 'Zagara', 'Acacia', 'Gelsomino', 'Sambuco', 'Camomilla', 'Lavanda', 'Fiori secchi', 'Caprifoglio', 'Geranio'],
  },
  {
    id: 'vegetale', label: 'Vegetale', bg: '#e8efe3', fg: '#3f6a3a',
    icon: '<svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 22C6 12 12 6 22 6c0 10-6 16-16 16z"/><path d="M6 22l9-9"/></svg>',
    tags: [
      'Erbaceo', 'Erba tagliata', 'Fieno', 'Peperone verde', 'Foglia di pomodoro', 'Bosso', 'Menta', 'Eucalipto',
      'Salvia', 'Timo', 'Rosmarino', 'Finocchio', 'Tè', 'Macchia mediterranea', 'Asparago', 'Foglia di ribes',
      'Aneto', 'Medicinale',
    ],
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
    tags: ['Pepe nero', 'Pepe bianco', 'Vaniglia', 'Liquirizia', 'Chiodi di garofano', 'Cannella', 'Noce moscata', 'Anice', 'Zenzero', 'Zafferano'],
  },
  {
    id: 'legno', label: 'Legno', bg: '#efe6dc', fg: '#6a4a2a',
    icon: '<svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="14" cy="14" r="9"/><circle cx="14" cy="14" r="5.5"/><circle cx="14" cy="14" r="2"/></svg>',
    tags: ['Legno', 'Rovere tostato', 'Cedro', 'Cocco', 'Affumicato', 'Tostato', 'Caffè', 'Cacao', 'Cioccolato fondente', 'Resina', 'Caramello mou', 'Legno bruciato'],
  },
  {
    id: 'lieviti', label: 'Lieviti', bg: '#f4ead8', fg: '#7a5a2a',
    icon: '<svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13a5 5 0 0 1 3-6h12a5 5 0 0 1 3 6v9H5z"/><path d="M11 11l-2 3M16 11l-2 3M21 11l-2 3"/></svg>',
    tags: ['Crosta di pane', 'Lievito', 'Brioche', 'Biscotto', 'Pasticceria', 'Burro', 'Panna', 'Yogurt', 'Pasta di pane', 'Formaggio'],
  },
  {
    id: 'evoluto', label: 'Evoluto', bg: '#ece6e0', fg: '#5a4636',
    icon: '<svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M4 14a10 8 0 0 1 20 0z"/><path d="M11 14v7a3 3 0 0 0 6 0v-7"/></svg>',
    tags: [
      'Cuoio', 'Tabacco', 'Sottobosco', 'Funghi', 'Tartufo', 'Terra', 'Selvatico', 'Foglie secche', 'Balsamico',
      'Miele', 'Caramello', 'Mandorla', 'Nocciola', 'Noce', 'Marzapane', 'Catrame', "Cera d'api", 'Foglie bagnate',
      'Carne', 'Stalla',
    ],
  },
  {
    id: 'minerale', label: 'Minerale', bg: '#e6eaec', fg: '#4a5a66',
    icon: '<svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4l7.5 6.5L14 24l-7.5-13.5z"/><path d="M7.5 10.5h13"/></svg>',
    tags: ['Minerale', 'Pietra focaia', 'Gesso', 'Grafite', 'Salino', 'Iodato', 'Idrocarburi', 'Ferroso', 'Pietra bagnata', 'Lana bagnata', 'Cherosene'],
  },
  {
    id: 'difetti', label: 'Difetti', bg: '#f3e4e0', fg: '#9a3b2e',
    icon: '<svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 5l10 17H4z"/><path d="M14 12v4.5"/><circle cx="14" cy="19.3" r=".9" fill="currentColor" stroke="none"/></svg>',
    tags: ['Tappo', 'Ossidato', 'Acetico', 'Ridotto', 'Smalto', 'Muffa'],
  },
];

// The palate structure of a tasting sheet. Column taste_<id> in
// tasting_notes for each (migrations 0006 and 0007).
export const TASTE_AXES = [
  { id: 'acidity', key: 'tasteAcidity', name: 'Acidità', left: 'Piatto', right: 'Acidulo' },
  { id: 'sweetness', key: 'tasteSweetness', name: 'Dolcezza', left: 'Secco', right: 'Dolce' },
  { id: 'tannin', key: 'tasteTannin', name: 'Tannicità', left: 'Morbido', right: 'Tannico' },
  { id: 'alcohol', key: 'tasteAlcohol', name: 'Alcol', left: 'Poco alcolico', right: 'Caldo' },
  { id: 'body', key: 'tasteBody', name: 'Corpo', left: 'Leggero', right: 'Strutturato' },
  { id: 'intensity', key: 'tasteIntensity', name: 'Intensità', left: 'Delicato', right: 'Intenso' },
  { id: 'finish', key: 'tasteFinish', name: 'Persistenza', left: 'Corto', right: 'Persistente' },
];

export const FOOD_PAIRINGS = [
  'Aperitivo', 'Antipasti', 'Crudi di mare', 'Frutti di mare', 'Crostacei', 'Sushi', 'Pesce', 'Pollame', 'Maiale',
  'Manzo', 'Agnello', 'Selvaggina', 'Salumi', 'Formaggi freschi', 'Formaggi stagionati', 'Formaggi erborinati',
  'Pasta', 'Risotto', 'Pizza', 'Funghi e tartufo', 'Verdure', 'Legumi e zuppe', 'Piatti speziati', 'Cucina asiatica',
  'Grigliate', 'Fritti', 'Dolci', 'Pasticceria secca', 'Cioccolato', 'Frutta',
];

const DEFAULT_VALUE = 50;

// The sliders move in ten steps, 1 to 10 — a free 0-100 slider asked for a
// precision nobody has on the palate. Storage stays 0-100 (step × 10), so
// notes saved before the change keep their meaning and are shown on the
// nearest step. 5 (= 50) is the untouched middle.
export const TASTE_STEPS = 10;
export const toStep = (value) => Math.min(TASTE_STEPS, Math.max(1, Math.round(Number(value) / 10)));
export const fromStep = (step) => Math.min(TASTE_STEPS, Math.max(1, Math.round(step))) * 10;
// Thumb position for a step, inset by the thumb's width so it stays on the track.
export const stepLeft = (step, thumbW) => `calc((100% - ${thumbW}px) * ${(step - 1) / (TASTE_STEPS - 1)})`;

export function tastingProfileHtml() {
  const flavorCards = FLAVOR_CATEGORIES.map(
    (cat, i) => `
    <div class="flavor-card${i === 0 ? ' active' : ''}" data-cat="${cat.id}" role="button" tabindex="0" aria-pressed="${i === 0}" style="background:${cat.bg};color:${cat.fg};">
      ${cat.icon}
      <span>${cat.label}</span>
    </div>`,
  ).join('');
  const flavorPanels = FLAVOR_CATEGORIES.map(
    (cat, i) => `
    <div class="flavor-chip-panel${i === 0 ? '' : ' hidden'}" data-cat="${cat.id}">
      ${cat.tags.map((t) => `<div class="chip" data-toggle role="button" tabindex="0" aria-pressed="false">${t}</div>`).join('')}
    </div>`,
  ).join('');
  const sliders = TASTE_AXES.map(
    (axis) => `
    <div class="taste-slider" data-axis="${axis.id}" data-value="${DEFAULT_VALUE}">
      <div class="taste-labels"><span class="tl-left">${axis.left}</span><span class="tl-right">${axis.right}</span></div>
      <div class="taste-track" role="slider" tabindex="0" aria-label="${axis.name}" aria-valuemin="1" aria-valuemax="10" aria-valuenow="${toStep(DEFAULT_VALUE)}"><div class="taste-thumb">${toStep(DEFAULT_VALUE)}</div></div>
    </div>`,
  ).join('');
  const pairingChips = FOOD_PAIRINGS.map((p) => `<div class="chip" data-toggle role="button" tabindex="0" aria-pressed="false">${p}</div>`).join('');

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

// 0 is a legitimate slider value, so `Number(x) || DEFAULT_VALUE` (which
// turns 0 into 50) can't be used to read it.
function sliderValue(slider) {
  const n = Number(slider.dataset.value);
  return Number.isNaN(n) ? DEFAULT_VALUE : n;
}

function positionThumb(slider) {
  const track = slider.querySelector('.taste-track');
  const thumb = slider.querySelector('.taste-thumb');
  const leftLabel = slider.querySelector('.tl-left');
  const rightLabel = slider.querySelector('.tl-right');
  const value = sliderValue(slider);
  const step = toStep(value);
  track.setAttribute('aria-valuenow', String(step));
  track.setAttribute('aria-valuetext', `${step} su 10, ${value < 40 ? leftLabel.textContent : value > 60 ? rightLabel.textContent : 'equilibrato'}`);
  thumb.style.left = stepLeft(step, 46);
  thumb.textContent = String(step);
  leftLabel.classList.toggle('dominant', value < 40);
  rightLabel.classList.toggle('dominant', value > 60);
}

// Wired once per sheet (the markup is inserted a single time, not re-rendered
// per open) — resetTastingProfile() below handles returning to a blank state
// on every subsequent open, instead of re-wiring listeners each time.
export function wireTastingProfile(root) {
  root.querySelectorAll('.chip[data-toggle]').forEach((chip) => {
    chip.addEventListener('click', () => chip.setAttribute('aria-pressed', String(chip.classList.toggle('active'))));
  });

  const cards = root.querySelectorAll('.flavor-card');
  const panels = root.querySelectorAll('.flavor-chip-panel');
  cards.forEach((card) => {
    card.addEventListener('click', () => {
      cards.forEach((c) => { c.classList.remove('active'); c.setAttribute('aria-pressed', 'false'); });
      card.classList.add('active');
      card.setAttribute('aria-pressed', 'true');
      panels.forEach((p) => p.classList.toggle('hidden', p.dataset.cat !== card.dataset.cat));
    });
  });

  root.querySelectorAll('.taste-slider').forEach((slider) => {
    const track = slider.querySelector('.taste-track');
    const setValue = (clientX) => {
      const rect = track.getBoundingClientRect();
      const ratio = (clientX - rect.left - 23) / (rect.width - 46);
      slider.dataset.value = fromStep(1 + ratio * (TASTE_STEPS - 1));
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
    // Keyboard / VoiceOver: arrows nudge the same dataset.value the pointer sets.
    track.addEventListener('keydown', (e) => {
      const delta = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 2, PageDown: -2 }[e.key];
      let next;
      if (delta != null) next = toStep(sliderValue(slider)) + delta;
      else if (e.key === 'Home') next = 1;
      else if (e.key === 'End') next = TASTE_STEPS;
      else return;
      e.preventDefault();
      slider.dataset.value = fromStep(next);
      positionThumb(slider);
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
  root.querySelectorAll('.chip.active[data-toggle]').forEach((chip) => { chip.classList.remove('active'); chip.setAttribute('aria-pressed', 'false'); });
  const cards = root.querySelectorAll('.flavor-card');
  const panels = root.querySelectorAll('.flavor-chip-panel');
  cards.forEach((c, i) => { c.classList.toggle('active', i === 0); c.setAttribute('aria-pressed', String(i === 0)); });
  panels.forEach((p, i) => p.classList.toggle('hidden', i !== 0));
  root.querySelectorAll('.taste-slider').forEach((slider) => {
    slider.dataset.value = String(DEFAULT_VALUE);
    positionThumb(slider);
  });
}

// Loads a saved note into the widget (the inverse of readTastingProfile): the
// bottle sheet opens with the user's own note already filled in, ready to be
// updated. Axes the note never set stay at the untouched middle.
export function setTastingProfile(root, note) {
  resetTastingProfile(root);
  const flavor = new Set(Array.isArray(note.flavor_tags) ? note.flavor_tags : []);
  const pairings = new Set(Array.isArray(note.food_pairings) ? note.food_pairings : []);
  root.querySelectorAll('.flavor-chip-panel .chip[data-toggle]').forEach((chip) => {
    if (flavor.has(chip.textContent)) { chip.classList.add('active'); chip.setAttribute('aria-pressed', 'true'); }
  });
  root.querySelectorAll('.chip-row .chip[data-toggle]').forEach((chip) => {
    if (pairings.has(chip.textContent)) { chip.classList.add('active'); chip.setAttribute('aria-pressed', 'true'); }
  });
  // Open the family of the first chosen aroma, so what was picked is visible.
  const first = FLAVOR_CATEGORIES.find((c) => c.tags.some((t) => flavor.has(t)));
  if (first) {
    root.querySelectorAll('.flavor-card').forEach((c) => { const on = c.dataset.cat === first.id; c.classList.toggle('active', on); c.setAttribute('aria-pressed', String(on)); });
    root.querySelectorAll('.flavor-chip-panel').forEach((p) => p.classList.toggle('hidden', p.dataset.cat !== first.id));
  }
  root.querySelectorAll('.taste-slider').forEach((slider) => {
    const v = note[`taste_${slider.dataset.axis}`];
    slider.dataset.value = String(v == null ? DEFAULT_VALUE : fromStep(toStep(v)));
    positionThumb(slider);
  });
}

export function readTastingProfile(root) {
  const flavorTags = Array.from(root.querySelectorAll('.flavor-chip-panel .chip.active[data-toggle]')).map((c) => c.textContent);
  const foodPairings = Array.from(root.querySelectorAll('.chip-row .chip.active[data-toggle]')).map((c) => c.textContent);
  const profile = { flavorTags, foodPairings };
  root.querySelectorAll('.taste-slider').forEach((slider) => {
    const axis = TASTE_AXES.find((x) => x.id === slider.dataset.axis);
    if (axis) profile[axis.key] = sliderValue(slider);
  });
  return profile;
}

export function isTastingProfileEmpty(profile) {
  return (
    profile.flavorTags.length === 0 &&
    profile.foodPairings.length === 0 &&
    TASTE_AXES.every((axis) => profile[axis.key] === DEFAULT_VALUE)
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
