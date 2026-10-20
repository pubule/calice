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
  'Manzo', 'Bollito', 'Agnello', 'Selvaggina', 'Salumi', 'Formaggi freschi', 'Formaggi stagionati', 'Formaggi erborinati',
  'Pasta', 'Risotto', 'Pizza', 'Funghi e tartufo', 'Verdure', 'Legumi e zuppe', 'Piatti speziati', 'Cucina asiatica',
  'Grigliate', 'Fritti', 'Dolci', 'Pasticceria secca', 'Cioccolato', 'Frutta',
];

// A keyboard press on a never-set axis starts it at the middle.
const MIDDLE_VALUE = 50;

// The sliders move in ten steps, 1 to 10 — a free 0-100 slider asked for a
// precision nobody has on the palate. Storage stays 0-100 (step × 10), so
// notes saved before the change keep their meaning and are shown on the
// nearest step. An axis nobody touched is null ("non segnato"), never 50.
export const TASTE_STEPS = 10;
export const toStep = (value) => Math.min(TASTE_STEPS, Math.max(1, Math.round(Number(value) / 10)));
export const fromStep = (step) => Math.min(TASTE_STEPS, Math.max(1, Math.round(step))) * 10;
// Thumb position for a step, inset by the thumb's width so it stays on the track.
export const stepLeft = (step, thumbW) => `calc((100% - ${thumbW}px) * ${(step - 1) / (TASTE_STEPS - 1)})`;

const SUB_TABS = [['aromi', 'Aromi'], ['gusto', 'Gusto'], ['cibo', 'Cibo'], ['testo', 'Testo']];
const fold = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const familyOf = (tag) => FLAVOR_CATEGORIES.find((c) => c.tags.includes(tag));
const toggleChip = (tag) => `<div class="chip" data-toggle role="button" tabindex="0" aria-pressed="false">${tag}</div>`;

// The note module: four sub-tabs (Aromi · Gusto · Cibo · Testo), one panel
// at a time, so aromas, taste, pairings and text are never all on screen.
// It owns the note's text field; the hosts keep only their stars.
export function tastingProfileHtml() {
  const tabs = SUB_TABS.map(([id, label], i) => `
    <button type="button" role="tab" data-tp-tab="${id}" aria-selected="${i === 0}"${i === 0 ? ' class="active"' : ''}>${label}<span class="tp-count"></span></button>`).join('');
  const flavorCards = FLAVOR_CATEGORIES.map(
    (cat, i) => `
    <div class="flavor-card${i === 0 ? ' active' : ''}" data-cat="${cat.id}" role="button" tabindex="0" aria-pressed="${i === 0}" style="background:${cat.bg};color:${cat.fg};">
      ${cat.icon}
      <span>${cat.label}</span>
      <b class="tp-badge" style="background:${cat.fg};"></b>
    </div>`,
  ).join('');
  const flavorPanels = FLAVOR_CATEGORIES.map((cat, i) => {
    const body = cat.groups
      ? cat.groups.map((g) => `<div class="tp-group-label">${g.label}</div><div class="tp-group">${g.tags.map(toggleChip).join('')}</div>`).join('')
      : `<div class="tp-group">${cat.tags.map(toggleChip).join('')}</div>`;
    return `<div class="flavor-chip-panel${i === 0 ? '' : ' hidden'}" data-cat="${cat.id}">${body}</div>`;
  }).join('');
  const sliders = TASTE_AXES.map(
    (axis) => `
    <div class="taste-slider" data-axis="${axis.id}" data-unset>
      <div class="taste-name">${axis.name}</div>
      <div class="taste-track" role="slider" tabindex="0" aria-label="${axis.name}" aria-valuemin="1" aria-valuemax="10"><div class="taste-thumb"></div><span class="taste-unset">non segnato · tocca</span></div>
      <div class="taste-labels"><span class="tl-left">${axis.left}</span><span class="tl-right">${axis.right}</span></div>
    </div>`,
  ).join('');

  return `
    <div class="segmented tp-tabs" role="tablist" aria-label="Parti della nota">${tabs}</div>
    <div class="tp-panel" data-tp-panel="aromi" role="tabpanel">
      <div class="tp-chosen hidden"><span class="tp-chosen-label">Scelti:</span></div>
      <div class="flavor-row">${flavorCards}</div>
      <input type="search" class="tp-search" aria-label="Cerca un aroma" placeholder="Cerca un aroma…" autocomplete="off">
      <div class="tp-results flavor-chip-panel hidden"></div>
      <div class="tp-family-panels">${flavorPanels}</div>
    </div>
    <div class="tp-panel hidden" data-tp-panel="gusto" role="tabpanel">
      ${sliders}
      <button type="button" class="tp-reset-taste">Azzera il gusto</button>
    </div>
    <div class="tp-panel hidden" data-tp-panel="cibo" role="tabpanel">
      <div class="chip-row">${FOOD_PAIRINGS.map(toggleChip).join('')}</div>
    </div>
    <div class="tp-panel hidden" data-tp-panel="testo" role="tabpanel">
      <textarea class="tp-text" aria-label="Nota di degustazione" placeholder="Scrivi una nota di degustazione…"></textarea>
    </div>`;
}

// null = never touched. 0 is a legitimate stored value, so no `|| default`.
function sliderValue(slider) {
  if (slider.hasAttribute('data-unset')) return null;
  const n = Number(slider.dataset.value);
  return Number.isNaN(n) ? null : n;
}

function setSlider(slider, value) {
  if (value == null) {
    slider.setAttribute('data-unset', '');
    delete slider.dataset.value;
  } else {
    slider.removeAttribute('data-unset');
    slider.dataset.value = String(value);
  }
  positionThumb(slider);
}

function positionThumb(slider) {
  const track = slider.querySelector('.taste-track');
  const thumb = slider.querySelector('.taste-thumb');
  const leftLabel = slider.querySelector('.tl-left');
  const rightLabel = slider.querySelector('.tl-right');
  const value = sliderValue(slider);
  if (value == null) {
    track.removeAttribute('aria-valuenow');
    track.setAttribute('aria-valuetext', 'non segnato');
    leftLabel.classList.remove('dominant');
    rightLabel.classList.remove('dominant');
    return;
  }
  const step = toStep(value);
  track.setAttribute('aria-valuenow', String(step));
  track.setAttribute('aria-valuetext', `${step} su 10, ${value < 40 ? leftLabel.textContent : value > 60 ? rightLabel.textContent : 'equilibrato'}`);
  thumb.style.left = stepLeft(step, 46);
  thumb.textContent = String(step);
  leftLabel.classList.toggle('dominant', value < 40);
  rightLabel.classList.toggle('dominant', value > 60);
}

const pressed = (el, on) => { el.classList.toggle('active', on); el.setAttribute('aria-pressed', String(on)); };
const flavorChips = (root) => root.querySelectorAll('.tp-family-panels .chip[data-toggle]');

export function selectSubTab(root, tab) {
  root.querySelectorAll('.tp-tabs [data-tp-tab]').forEach((b) => {
    b.classList.toggle('active', b.dataset.tpTab === tab);
    b.setAttribute('aria-selected', String(b.dataset.tpTab === tab));
  });
  root.querySelectorAll('.tp-panel').forEach((p) => p.classList.toggle('hidden', p.dataset.tpPanel !== tab));
}

function selectFamily(root, catId) {
  root.querySelectorAll('.flavor-card').forEach((c) => pressed(c, c.dataset.cat === catId));
  root.querySelectorAll('.tp-family-panels .flavor-chip-panel').forEach((p) => p.classList.toggle('hidden', p.dataset.cat !== catId));
}

// Everything derived from the current picks: the "Scelti" row, the family
// badges, the sub-tab counters and the search results' pressed state.
function refresh(root) {
  const chosen = Array.from(flavorChips(root)).filter((c) => c.classList.contains('active')).map((c) => c.textContent);
  const row = root.querySelector('.tp-chosen');
  row.querySelectorAll('button').forEach((b) => b.remove());
  for (const tag of chosen) {
    const fam = familyOf(tag);
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'tp-chosen-chip', textContent: tag });
    b.dataset.tag = tag;
    b.style.background = fam?.bg ?? '';
    b.style.color = fam?.fg ?? '';
    b.setAttribute('aria-label', `Togli ${tag}`);
    const x = Object.assign(document.createElement('span'), { textContent: '×' });
    x.setAttribute('aria-hidden', 'true');
    b.append(x);
    row.append(b);
  }
  row.classList.toggle('hidden', chosen.length === 0);
  for (const cat of FLAVOR_CATEGORIES) {
    const n = chosen.filter((t) => cat.tags.includes(t)).length;
    root.querySelector(`.flavor-card[data-cat="${cat.id}"] .tp-badge`).textContent = n ? String(n) : '';
  }
  const counts = {
    aromi: chosen.length,
    gusto: Array.from(root.querySelectorAll('.taste-slider')).filter((s) => sliderValue(s) != null).length,
    cibo: root.querySelectorAll('[data-tp-panel="cibo"] .chip.active').length,
  };
  root.querySelectorAll('.tp-tabs [data-tp-tab]').forEach((b) => {
    const n = counts[b.dataset.tpTab];
    b.querySelector('.tp-count').textContent = n ? String(n) : '';
  });
  root.querySelectorAll('.tp-results .chip').forEach((c) => pressed(c, chosen.includes(c.dataset.tag)));
}

function runSearch(root) {
  const q = fold(root.querySelector('.tp-search').value.trim());
  const results = root.querySelector('.tp-results');
  root.querySelector('.tp-family-panels').classList.toggle('hidden', !!q);
  results.classList.toggle('hidden', !q);
  results.replaceChildren();
  if (!q) return;
  for (const tag of FLAVOR_CATEGORIES.flatMap((c) => c.tags).filter((t) => fold(t).includes(q))) {
    // A copy without data-toggle: readTastingProfile only counts the originals.
    const chip = Object.assign(document.createElement('div'), { className: 'chip', textContent: tag, tabIndex: 0 });
    chip.dataset.tag = tag;
    chip.setAttribute('role', 'button');
    results.append(chip);
  }
  refresh(root);
}

function originalChip(root, tag) {
  return Array.from(flavorChips(root)).find((c) => c.textContent === tag);
}

// Wired once per sheet (the markup is inserted a single time, not re-rendered
// per open) — resetTastingProfile() below handles returning to a blank state
// on every subsequent open, instead of re-wiring listeners each time. Every
// lookup is scoped to `root`: the module is mounted twice in the page.
export function wireTastingProfile(root) {
  root.addEventListener('click', (e) => {
    const t = e.target;
    const tab = t.closest('[data-tp-tab]');
    if (tab) { selectSubTab(root, tab.dataset.tpTab); return; }
    const card = t.closest('.flavor-card');
    if (card) { selectFamily(root, card.dataset.cat); return; }
    const chosen = t.closest('.tp-chosen-chip');
    if (chosen) { pressed(originalChip(root, chosen.dataset.tag), false); refresh(root); return; }
    const result = t.closest('.tp-results .chip');
    if (result) { const c = originalChip(root, result.dataset.tag); pressed(c, !c.classList.contains('active')); refresh(root); return; }
    const chip = t.closest('.chip[data-toggle]');
    if (chip) { pressed(chip, !chip.classList.contains('active')); refresh(root); return; }
    if (t.closest('.tp-reset-taste')) { root.querySelectorAll('.taste-slider').forEach((s) => setSlider(s, null)); refresh(root); }
  });
  root.querySelector('.tp-search').addEventListener('input', () => runSearch(root));

  root.querySelectorAll('.taste-slider').forEach((slider) => {
    const track = slider.querySelector('.taste-track');
    const setFromX = (clientX) => {
      const rect = track.getBoundingClientRect();
      const ratio = (clientX - rect.left - 23) / (rect.width - 46);
      setSlider(slider, fromStep(1 + ratio * (TASTE_STEPS - 1)));
      refresh(root);
    };
    track.addEventListener('pointerdown', (e) => {
      track.setPointerCapture(e.pointerId);
      setFromX(e.clientX);
      const onMove = (ev) => setFromX(ev.clientX);
      const onEnd = () => track.removeEventListener('pointermove', onMove);
      track.addEventListener('pointermove', onMove);
      track.addEventListener('pointerup', onEnd, { once: true });
      track.addEventListener('pointercancel', onEnd, { once: true });
    });
    // Keyboard / VoiceOver: arrows nudge the value; the first press on a
    // never-set axis starts it at the middle.
    track.addEventListener('keydown', (e) => {
      const delta = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 2, PageDown: -2 }[e.key];
      const current = sliderValue(slider);
      let next;
      if (delta != null) next = current == null ? toStep(MIDDLE_VALUE) : toStep(current) + delta;
      else if (e.key === 'Home') next = 1;
      else if (e.key === 'End') next = TASTE_STEPS;
      else return;
      e.preventDefault();
      setSlider(slider, fromStep(next));
      refresh(root);
    });
    positionThumb(slider);
  });
}

// Always returns the widget to a blank slate: called every time a sheet is
// opened so a previous session's picks never leak into the next one.
export function resetTastingProfile(root) {
  root.querySelectorAll('.chip.active[data-toggle]').forEach((chip) => pressed(chip, false));
  root.querySelectorAll('.taste-slider').forEach((slider) => setSlider(slider, null));
  root.querySelector('.tp-text').value = '';
  root.querySelector('.tp-search').value = '';
  runSearch(root);
  selectSubTab(root, 'aromi');
  selectFamily(root, FLAVOR_CATEGORIES[0].id);
  refresh(root);
}

// Loads a saved note into the widget (the inverse of readTastingProfile).
// A null axis stays "non segnato"; any number is a value someone chose.
export function setTastingProfile(root, note) {
  resetTastingProfile(root);
  const flavor = new Set(Array.isArray(note.flavor_tags) ? note.flavor_tags : []);
  const pairings = new Set(Array.isArray(note.food_pairings) ? note.food_pairings : []);
  flavorChips(root).forEach((chip) => { if (flavor.has(chip.textContent)) pressed(chip, true); });
  root.querySelectorAll('.chip-row .chip[data-toggle]').forEach((chip) => { if (pairings.has(chip.textContent)) pressed(chip, true); });
  // Open the family of the first chosen aroma.
  const first = FLAVOR_CATEGORIES.find((c) => c.tags.some((t) => flavor.has(t)));
  if (first) selectFamily(root, first.id);
  root.querySelectorAll('.taste-slider').forEach((slider) => {
    const v = note[`taste_${slider.dataset.axis}`];
    setSlider(slider, v == null ? null : fromStep(toStep(v)));
  });
  root.querySelector('.tp-text').value = note.text ?? '';
  refresh(root);
}

export function readTastingProfile(root) {
  const flavorTags = Array.from(root.querySelectorAll('.tp-family-panels .chip.active[data-toggle]')).map((c) => c.textContent);
  const foodPairings = Array.from(root.querySelectorAll('.chip-row .chip.active[data-toggle]')).map((c) => c.textContent);
  const profile = { flavorTags, foodPairings, text: root.querySelector('.tp-text').value.trim() };
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
    !profile.text &&
    TASTE_AXES.every((axis) => profile[axis.key] == null)
  );
}

// A taste axis in words: its leaning side, or "<axis> medio/media".
export function tasteWord(axis, value) {
  if (value < 40) return axis.left;
  if (value > 60) return axis.right;
  return `${axis.name} ${axis.id === 'body' || axis.id === 'alcohol' ? 'medio' : 'media'}`;
}

// The note as one sentence, from what was marked (note shape: flavor_tags,
// taste_<axis>, food_pairings). It stands in for the note's text until the
// user writes their own, and again if they empty it.
// How each taste axis reads inside the sentence ("in bocca è …"): low,
// high, middle. In the order a taster says them.
const TASTE_PHRASE = {
  sweetness: ['secco', 'dolce', 'abboccato'],
  acidity: ['poco acido', 'fresco', 'di acidità media'],
  tannin: ['morbido', 'tannico', 'di tannino medio'],
  body: ['di corpo leggero', 'strutturato', 'di corpo medio'],
  alcohol: ['di poco alcol', 'caldo', 'di gradazione media'],
  intensity: ['delicato', 'intenso', 'di media intensità'],
  finish: ['corto', 'persistente', 'di media persistenza'],
};

export function composeNoteText(note) {
  const list = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}` : xs[0]);
  const lower = (xs) => (Array.isArray(xs) ? xs : []).map((x) => x.toLowerCase());
  const aromas = lower(note.flavor_tags);
  const taste = Object.entries(TASTE_PHRASE)
    .filter(([id]) => note[`taste_${id}`] != null)
    .map(([id, [low, high, mid]]) => { const v = Number(note[`taste_${id}`]); return v < 40 ? low : v > 60 ? high : mid; });
  const foods = lower(note.food_pairings);
  const aperitivo = foods.includes('aperitivo');
  const dishes = foods.filter((f) => f !== 'aperitivo');
  let food = dishes.length ? `si abbina bene con ${list(dishes)}` : '';
  if (aperitivo) food = food ? `${food} ed è ottimo come aperitivo` : 'è ottimo come aperitivo';

  // "Profuma di …. In bocca è …, e si abbina bene con …."
  const and = food.startsWith('è') ? 'ed' : 'e';
  const sentences = [];
  if (aromas.length) sentences.push(`profuma di ${list(aromas)}`);
  if (taste.length) sentences.push(`in bocca è ${list(taste)}${food ? `, ${and} ${food}` : ''}`);
  else if (food && sentences.length) sentences[0] += ` ${and} ${food}`;
  else if (food) sentences.push(food);
  return sentences.map((x) => `${x[0].toUpperCase()}${x.slice(1)}.`).join(' ');
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
