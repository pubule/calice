import { api } from '../api-client.js';
import { escapeHtml, photoClass, skeletonBar, priceText } from '../util.js';
import { openDetail } from './detail.js';
import { openEditWineSheet } from './add.js';
import { me } from '../auth.js';
import { confirmModal, promptModal } from '../modal.js';
import { showToast } from '../toast.js';

function skeletonRowHtml() {
  return `
    <div class="cellar-row">
      <div class="skeleton" style="width:34px; height:48px; border-radius:4px; flex-shrink:0;"></div>
      <div class="cinfo">${skeletonBar('70%', 12)}<div style="margin-top:6px;">${skeletonBar('45%', 10)}</div></div>
    </div>`;
}

const ICON_COMPARE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v18"/><path d="M16 3v18"/><path d="M3 8h4"/><path d="M17 8h4"/><path d="M3 16h4"/><path d="M17 16h4"/></svg> Confronta due vini';
const ICON_CANCEL =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/></svg> Annulla selezione';

const KIND_ICON = {
  Scaffale: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round"><rect x="4" y="4" width="16" height="16" rx="1"/><line x1="4" y1="10" x2="20" y2="10"/><line x1="4" y1="15" x2="20" y2="15"/></svg>',
  Rack: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round"><path d="M4 4v16M12 4v16M20 4v16"/><path d="M4 9h16M4 15h16"/></svg>',
  Cella: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round"><rect x="5" y="3" width="14" height="18" rx="2"/><line x1="5" y1="10" x2="19" y2="10"/><line x1="5" y1="16" x2="19" y2="16"/></svg>',
  Scatolone: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round"><path d="M3 8l9-5 9 5-9 5-9-5Z"/><path d="M3 8v9l9 5 9-5V8"/><path d="M12 13v9"/></svg>',
};
const KINDS = ['Scaffale', 'Rack', 'Cella', 'Scatolone'];

let cellars = [];
let currentCellarId = null;
let currentBottles = [];
let currentElements = [];
let compareMode = false;
let compareSelected = [];
let activeChips = { type: null, country: null, region: null };

// picker state: set while the elements overlay was opened from a bottle's
// "modifica posizione" link (detail.js), instead of the standalone
// "Elementi cantina" browse entry point.
let picker = null; // { bottle, onPicked }
let elementsMode = 'list'; // 'list' | 'detail' | 'create'
let currentElementId = null;
// Element grid: the bottle whose slot card is open, the bottle being moved
// (free slots become targets), and grid vs list view.
let slotSel = null; // id of the selected place
let movingPlace = null; // { place, bottle } being moved
let elemView = 'grid';

function colLetter(i) {
  return String.fromCharCode(65 + i);
}

// A real product photo (saved from a web-search candidate) beats the
// generic type-tinted placeholder whenever one is on file.
function photoHtml(b, className) {
  return b.image_url
    ? `<img class="${className} photo product" src="${escapeHtml(b.image_url)}" alt="">`
    : `<div class="${className} photo ${photoClass(b.type)}"></div>`;
}

// Where the bottles of a wine sit: one place per physical bottle
// (b.places, from bottle_places), so two bottles of the same wine can be in
// two slots. Bottles without a place are counted at the end.
export function locationLabel(b) {
  const places = b.places ?? [];
  if (!places.length) return '';
  if (places.length === 1 && !freeCount(b)) {
    const p = places[0];
    return p.slot_tier == null ? p.element_name : `${p.element_name} · Livello ${p.slot_tier} · ${colLetter(p.slot_col)}.${p.slot_depth}`;
  }
  const groups = new Map();
  for (const p of places) {
    if (!groups.has(p.element_name)) groups.set(p.element_name, []);
    groups.get(p.element_name).push(p.slot_tier == null ? null : `L${p.slot_tier} ${colLetter(p.slot_col)}.${p.slot_depth}`);
  }
  const text = [...groups].map(([name, spots]) => {
    const slots = spots.filter(Boolean);
    return slots.length ? `${name} · ${slots.join(', ')}` : `${name} (${spots.length})`;
  }).join(' · ');
  const free = freeCount(b);
  return free ? `${text} · ${free} senza posto` : text;
}

// Bottles of this wine that have no place yet.
function freeCount(b) {
  return Math.max(0, (Number(b.quantity) || 0) - (b.places?.length ?? 0));
}

// Every placed bottle of the cellar, as { place, bottle }.
function occupants() {
  return currentBottles.flatMap((bottle) => (bottle.places ?? []).map((place) => ({ place, bottle })));
}

const ICON_SWIPE_EDIT = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
const ICON_SWIPE_DELETE = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/><path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/></svg>';

function rowHtml(b) {
  const photo = photoClass(b.type);
  // The vintage with the name: two years of the same wine are two rows.
  const name = escapeHtml(b.vintage && !String(b.name).includes(String(b.vintage)) ? `${b.name} ${b.vintage}` : b.name);
  const sub = `${escapeHtml(b.producer)} · ${escapeHtml(b.region ?? b.country)}`;
  const price = priceText(b.price_paid) ? `${priceText(b.price_paid)} €` : '—';
  const score = b.score != null ? b.score.toFixed(1) : '—';
  // The user's own score, or Vivino's when they have not given one.
  const one = (n) => Number(n).toFixed(1).replace('.', ',');
  const rating = b.my_rating != null ? `★ ${one(b.my_rating)}` : b.vivino_rating != null ? `Vivino ★ ${one(b.vivino_rating)}` : '';
  const quantity = escapeHtml(b.quantity);
  // .cellar-item wraps the sliding row and the actions revealed behind it.
  // The actions come AFTER the row in the DOM so Tab order is: row -> Modifica
  // -> Elimina; they are layered under the row with CSS.
  return `
    <div class="cellar-item" data-id="${b.id}">
      <div class="cellar-row" role="group" data-id="${b.id}" data-photo="${photo}" data-name="${name}" data-sub="${sub}" data-price="${price}" data-score="${score}">
        <div class="rowcheck"><svg class="check-ic" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 12 9 17 20 6"/></svg></div>
        ${photoHtml(b, 'cphoto')}
        <div class="cinfo" role="button" tabindex="0"><div class="name">${name}</div><div class="sub">${sub} · ×${quantity}${rating ? ' · ' + rating : ''}</div></div>
        <div class="cprice">${price}<small>a bottiglia</small></div>
      </div>
      <div class="swipe-actions">
        <div class="swipe-action swipe-edit" data-id="${b.id}" role="button" tabindex="0" aria-label="Modifica ${name}">${ICON_SWIPE_EDIT}<span>Modifica</span></div>
        <div class="swipe-action swipe-delete" data-id="${b.id}" role="button" tabindex="0" aria-label="Elimina ${name}">${ICON_SWIPE_DELETE}<span>Elimina</span></div>
      </div>
    </div>`;
}

function wishRowHtml(w) {
  const photo = photoClass(w.type);
  const name = escapeHtml(w.name) + (w.vintage ? ' ' + escapeHtml(w.vintage) : '');
  const price = priceText(w.target_price) ? ` · Obiettivo ${priceText(w.target_price)} €` : '';
  const sub = `${escapeHtml(w.producer)} · ${escapeHtml(w.region ?? w.country)}${price}`;
  return `
    <div class="wish-row" data-id="${w.id}">
      <div class="wish-photo photo ${photo}"></div>
      <div class="result-body"><div class="name">${name}</div><div class="sub">${sub}</div></div>
      <div class="wish-add" data-id="${w.id}" role="button" tabindex="0" aria-label="Rimuovi ${name} dai desideri">Rimuovi dai desideri</div>
    </div>`;
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Chips are built from the values actually present in this cellar, not a
// fixed hardcoded list — an empty/small cellar only ever shows filters that
// mean something for it.
function renderChips() {
  const groups = [
    { id: 'cellar-chips-type', key: 'type', field: 'type', allLabel: 'Tutti' },
    { id: 'cellar-chips-country', key: 'country', field: 'country', allLabel: 'Tutti' },
    { id: 'cellar-chips-region', key: 'region', field: 'region', allLabel: 'Tutte' },
  ];
  for (const g of groups) {
    const values = [...new Set(currentBottles.map((b) => b[g.field]).filter(Boolean))].sort();
    const el = document.getElementById(g.id);
    el.innerHTML =
      `<div class="chip active" data-v="" role="button" tabindex="0" aria-pressed="true">${g.allLabel}</div>` +
      values.map((v) => `<div class="chip" data-v="${escapeHtml(v)}" role="button" tabindex="0" aria-pressed="false">${escapeHtml(capitalize(v))}</div>`).join('');
    el.querySelectorAll('.chip').forEach((chip) =>
      chip.addEventListener('click', () => {
        el.querySelectorAll('.chip').forEach((c) => { c.classList.remove('active'); c.setAttribute('aria-pressed', 'false'); });
        chip.classList.add('active');
        chip.setAttribute('aria-pressed', 'true');
        activeChips[g.key] = chip.dataset.v || null;
        updateFilterBadge();
        applyFilters();
      }),
    );
  }
}

function updateFilterBadge() {
  const count = Object.values(activeChips).filter(Boolean).length;
  const badge = document.getElementById('cellar-filter-badge');
  badge.textContent = count;
  badge.classList.toggle('show', count > 0);
}

function applyFilters() {
  const q = document.getElementById('cellar-search-input').value.trim().toLowerCase();
  const filtered = currentBottles.filter((b) => {
    const mQ = !q || `${b.name} ${b.producer} ${b.vintage ?? ''}`.toLowerCase().includes(q);
    const mType = !activeChips.type || b.type === activeChips.type;
    const mCountry = !activeChips.country || b.country === activeChips.country;
    const mRegion = !activeChips.region || b.region === activeChips.region;
    return mQ && mType && mCountry && mRegion;
  });
  const nBottles = filtered.reduce((sum, b) => sum + (Number(b.quantity) || 0), 0);
  document.getElementById('cellar-results-count').textContent =
    `${filtered.length} ${filtered.length === 1 ? 'vino' : 'vini'} · ${nBottles} ${nBottles === 1 ? 'bottiglia' : 'bottiglie'}`;
  renderList(filtered);
}

// Called by detail.js after it changes or removes a bottle (stappa): the
// bottle objects are shared, so a re-render is enough; `removed` drops the
// row from the list first.
export function refreshCellarList(removedId) {
  if (removedId != null) {
    currentBottles = currentBottles.filter((b) => b.id !== removedId);
    renderChips();
  }
  applyFilters();
}

// Edit / delete of a bottle are shared by the swipe actions on the Cantina
// rows and the buttons in the bottle detail sheet (detail.js).
// `onDone(updated)` receives the refreshed bottle object: the list is
// re-fetched after a save, so the one the caller holds is stale.
// The wine sheet can also be opened from Home, before Cantina was ever
// shown (or showing another cellar): load the bottle's own cellar first, so
// saving, positions and elements work on the right data.
async function ensureCellarOf(bottle) {
  if (currentCellarId != null && currentCellarId === (bottle.cellar_id ?? currentCellarId) && currentBottles.some((b) => b.id === bottle.id)) return;
  cellars = await api.get('/api/cellars');
  currentCellarId = bottle.cellar_id ?? currentCellarId ?? cellars[0]?.id;
  const cellar = cellars.find((c) => c.id === currentCellarId);
  if (cellar) document.getElementById('active-cellar-name').textContent = cellar.name;
  await loadCellarData();
}

export function editBottle(bottle, onDone) {
  openEditWineSheet(bottle, async () => {
    if (currentCellarId == null) currentCellarId = bottle.cellar_id;
    await loadCellarData();
    onDone?.(currentBottles.find((x) => x.id === bottle.id) ?? null);
  });
}

// Resolves true when the bottle was actually deleted.
export async function deleteBottle(bottle) {
  const ok = await confirmModal(`Eliminare "${bottle?.name ?? 'questa bottiglia'}" dalla cantina?`, {
    title: 'Elimina bottiglia',
    confirmLabel: 'Elimina',
    danger: true,
  });
  if (!ok) return false;
  await api.del(`/api/bottles/${bottle.id}`);
  currentBottles = await api.get(`/api/cellars/${currentCellarId}/bottles`);
  renderChips();
  applyFilters();
  return true;
}

function renderList(bottles) {
  const list = document.getElementById('cellar-list');
  // Rows are replaced below: the open one (if any) is about to be detached.
  openItem = null;
  list.innerHTML = bottles.map(rowHtml).join('') || '<div class="empty-note">Nessun vino trovato con questi filtri.</div>';
}

// ---- righe a scorrimento (swipe-left: Modifica / Elimina) ----
//
// Wired once, delegated on #cellar-list (rows are re-created on every
// render). Gesture model from Apple's "Designing Fluid Interfaces": the row
// tracks the finger 1:1, rubber-bands past its limits, and on release a
// velocity projection (not the raw position) decides open vs closed.

// Width of the revealed actions: two 76px actions at the default text size,
// wider when Dynamic Type enlarges their labels (the CSS sizes the box).
const swipeWidth = (item) => item.querySelector('.swipe-actions')?.offsetWidth || 152;
const SWIPE_SLOP = 10; // px before the direction is decided
let openItem = null; // the .cellar-item currently showing its actions
let openedAt = 0;
let tapWasOnOpen = false; // pointerdown happened while a row was open: that tap only closes it
let suppressClickUntil = 0;
let swipe = null; // active gesture state

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Rubber band: 1:1 at first, asymptotically approaching `dim`.
function rubber(d, dim) {
  return (1 - 1 / ((d * 0.55) / dim + 1)) * dim;
}

// Settle `item` open or closed. `animate` adds the short snap transition
// (under prefers-reduced-motion it just jumps, no motion).
function settle(item, open, animate) {
  const row = item.querySelector('.cellar-row');
  const tok = (item._tok = (item._tok ?? 0) + 1);
  item.classList.add('peek');
  item.classList.remove('dragging');
  item.classList.toggle('is-open', open);
  const anim = animate && !prefersReducedMotion();
  row.classList.toggle('snapping', anim);
  row.style.transform = `translate3d(${open ? -swipeWidth(item) : 0}px,0,0)`;
  if (open) {
    openItem = item;
    openedAt = Date.now();
  } else if (openItem === item) {
    openItem = null;
  }
  setTimeout(
    () => {
      if (item._tok !== tok) return;
      row.classList.remove('snapping');
      if (!open) {
        row.style.transform = '';
        item.classList.remove('peek');
      }
    },
    anim ? 320 : 0,
  );
}

function closeOpenItem(animate = true) {
  if (openItem) settle(openItem, false, animate);
}

function wireSwipe(list) {
  list.addEventListener('pointerdown', (e) => {
    tapWasOnOpen = !!openItem;
    swipe = null;
    if (compareMode) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const row = e.target.closest('.cellar-row');
    const item = row?.closest('.cellar-item');
    if (!item) return;
    // Opening a second row closes the first.
    if (openItem && openItem !== item) closeOpenItem();
    row.classList.remove('snapping');
    item._tok = (item._tok ?? 0) + 1; // cancel a pending settle cleanup
    const w = swipeWidth(item);
    const base = item === openItem ? -w : 0;
    swipe = {
      item,
      row,
      w,
      id: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      base,
      x: base,
      state: 'pending', // 'pending' | 'swiping' | 'scrolling'
      samples: [{ t: e.timeStamp, x: e.clientX }],
    };
  });

  list.addEventListener('pointermove', (e) => {
    if (!swipe || e.pointerId !== swipe.id || swipe.state === 'scrolling') return;
    const dx = e.clientX - swipe.x0;
    const dy = e.clientY - swipe.y0;
    if (swipe.state === 'pending') {
      if (Math.hypot(dx, dy) < SWIPE_SLOP) return;
      // Claim the gesture only when horizontal movement dominates;
      // otherwise leave it to the native vertical scroll.
      if (Math.abs(dx) <= Math.abs(dy)) {
        swipe.state = 'scrolling';
        return;
      }
      swipe.state = 'swiping';
      swipe.item.classList.add('peek', 'dragging');
      try {
        swipe.row.setPointerCapture(e.pointerId);
      } catch {}
    }
    swipe.samples.push({ t: e.timeStamp, x: e.clientX });
    if (swipe.samples.length > 8) swipe.samples.shift();
    let x = swipe.base + dx; // 1:1 with the finger, from where it was grabbed
    if (x > 0) x = rubber(x, swipe.w);
    else if (x < -swipe.w) x = -swipe.w - rubber(-swipe.w - x, swipe.w);
    swipe.x = x;
    swipe.row.style.transform = `translate3d(${x}px,0,0)`;
    e.preventDefault();
  });

  const end = (e, cancelled) => {
    if (!swipe || e.pointerId !== swipe.id) return;
    const s = swipe;
    swipe = null;
    if (s.state !== 'swiping') return; // a tap or a vertical scroll
    tapWasOnOpen = false;
    // The click that follows a swipe must not open the detail sheet.
    suppressClickUntil = Date.now() + 400;
    const first = s.samples.find((p) => e.timeStamp - p.t <= 100) ?? s.samples[s.samples.length - 1];
    const dt = e.timeStamp - first.t;
    const v = !cancelled && dt > 0 ? ((e.clientX - first.x) / dt) * 1000 : 0; // px/s
    const projected = s.x + (v / 1000) * (0.99 / (1 - 0.99));
    settle(s.item, projected < -s.w / 2, true);
  };
  list.addEventListener('pointerup', (e) => end(e, false));
  list.addEventListener('pointercancel', (e) => end(e, true));

  // Capture phase: swallow the click that ends a swipe before anything
  // (the detail sheet, compare selection) sees it.
  list.addEventListener(
    'click',
    (e) => {
      if (Date.now() < suppressClickUntil) {
        e.stopPropagation();
        e.preventDefault();
        suppressClickUntil = 0;
      }
    },
    true,
  );

  list.addEventListener('click', async (e) => {
    const wasOpenTap = tapWasOnOpen && e.detail > 0;
    tapWasOnOpen = false;
    if (compareMode) return;
    const action = e.target.closest('.swipe-action');
    if (action) {
      const item = action.closest('.cellar-item');
      const bottle = currentBottles.find((x) => x.id === Number(action.dataset.id));
      if (!bottle) return;
      if (action.classList.contains('swipe-edit')) {
        settle(item, false, true);
        editBottle(bottle);
      } else {
        await deleteBottle(bottle);
        // Cancelled: the row is still there, close it. Deleted: it was re-rendered.
        if (item.isConnected) settle(item, false, true);
      }
      return;
    }
    const row = e.target.closest('.cellar-row');
    if (!row) return;
    // A tap while a row is open only closes it, like iOS lists.
    if (wasOpenTap) {
      closeOpenItem();
      return;
    }
    const bottle = currentBottles.find((x) => x.id === Number(row.dataset.id));
    if (bottle) await openDetail(bottle, await me());
  });

  // Keyboard / VoiceOver: the actions are real (if hidden) controls in the
  // DOM, so focusing one must bring its row into view. Enter/Space on them
  // is handled by the delegated role="button" handler in main.js.
  list.addEventListener('focusin', (e) => {
    if (compareMode) return;
    const item = e.target.closest?.('.swipe-action')?.closest('.cellar-item');
    if (!item) return;
    if (openItem && openItem !== item) closeOpenItem(false);
    if (item !== openItem) settle(item, true, true);
  });
  list.addEventListener('focusout', (e) => {
    const item = e.target.closest?.('.cellar-item');
    if (item && item === openItem && !item.contains(e.relatedTarget)) settle(item, false, true);
  });

  // Tapping anywhere outside the open row, or scrolling the list, closes it.
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (openItem && !openItem.contains(e.target)) closeOpenItem();
    },
    true,
  );
  document.querySelector('#view-cellar .cellar-body')?.addEventListener(
    'scroll',
    () => {
      if (openItem && Date.now() - openedAt > 200) closeOpenItem();
    },
    { passive: true },
  );
}

async function renderWishlist() {
  const wishlist = await api.get(`/api/cellars/${currentCellarId}/wishlist`);
  const wishEl = document.getElementById('wishlist-list');
  wishEl.innerHTML = wishlist.length ? wishlist.map(wishRowHtml).join('') : '<div class="empty-note">Nessun vino nei desideri.</div>';
  wishEl.querySelectorAll('.wish-add').forEach((btn) =>
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const item = wishlist.find((w) => String(w.id) === btn.dataset.id);
      await api.del(`/api/wishlist/${btn.dataset.id}`);
      btn.closest('.wish-row').remove();
      // Undo re-creates the item from the data the list already holds (wine_id,
      // target_price). The new row gets a new id, moves to the top and is
      // attributed to the current user; the DELETE itself is not deferred, so
      // the removal persists even if the app is closed within the toast window.
      showToast('Rimosso dai desideri', {
        actionLabel: 'Annulla',
        onAction: async () => {
          await api.post(`/api/cellars/${currentCellarId}/wishlist`, { wineId: item.wine_id, targetPrice: item.target_price });
          await renderWishlist();
        },
      });
    }),
  );
}

function updateCompareBar() {
  document.getElementById('compare-count').textContent = `${compareSelected.length}/2 selezionati`;
  document.getElementById('compare-go').disabled = compareSelected.length !== 2;
  syncCompareAria();
}

// While selecting two wines to compare, each row's button announces whether
// it's picked; outside compare mode the state doesn't apply.
function syncCompareAria() {
  document.querySelectorAll('#cellar-list .cellar-row').forEach((row) => {
    const btn = row.querySelector('.cinfo');
    if (!btn) return;
    if (compareMode) btn.setAttribute('aria-pressed', String(row.classList.contains('selected')));
    else btn.removeAttribute('aria-pressed');
  });
}

function exitCompareMode() {
  compareMode = false;
  compareSelected = [];
  const cellarList = document.getElementById('cellar-list');
  cellarList.classList.remove('selecting');
  cellarList.querySelectorAll('.cellar-row.selected').forEach((r) => r.classList.remove('selected'));
  document.getElementById('compare-bar').classList.remove('show');
  syncCompareAria();
  const compareBtn = document.getElementById('compare-open');
  if (compareBtn) compareBtn.innerHTML = ICON_COMPARE;
}

// ---- selettore cantina ----

function renderCellarRows() {
  document.getElementById('cellar-rows').innerHTML = cellars
    .map(
      (c, i) => `
      <div class="list-row ${c.id === currentCellarId ? 'active' : ''}">
        <div class="radio" data-i="${i}" role="radio" tabindex="0" aria-checked="${c.id === currentCellarId}" aria-label="${escapeHtml(c.name)}"></div>
        <div class="lbody" data-i="${i}" role="presentation"><div class="lname">${escapeHtml(c.name)}</div></div>
        <div class="icon-btn rename-cellar-btn" data-i="${i}" title="Rinomina" role="button" tabindex="0" aria-label="Rinomina ${escapeHtml(c.name)}"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></div>
      </div>`,
    )
    .join('');
  document.querySelectorAll('#cellar-rows .radio, #cellar-rows .lbody').forEach((el) =>
    el.addEventListener('click', () => selectCellar(cellars[Number(el.dataset.i)].id)),
  );
  document.querySelectorAll('.rename-cellar-btn').forEach((btn) =>
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const cellar = cellars[Number(btn.dataset.i)];
      const name = await promptModal('Nuovo nome:', { title: 'Rinomina cantina', defaultValue: cellar.name, confirmLabel: 'Rinomina' });
      if (!name?.trim() || name === cellar.name) return;
      cellars[Number(btn.dataset.i)] = await api.patch(`/api/cellars/${cellar.id}`, { name });
      renderCellarRows();
      if (cellar.id === currentCellarId) document.getElementById('active-cellar-name').textContent = name;
    }),
  );
}

async function selectCellar(id) {
  currentCellarId = id;
  document.getElementById('active-cellar-name').textContent = cellars.find((c) => c.id === id).name;
  closeSheet('cellar-sheet');
  await loadCellarData();
}

async function loadCellarData() {
  document.getElementById('cellar-list').innerHTML = Array.from({ length: 4 }, skeletonRowHtml).join('');
  currentBottles = await api.get(`/api/cellars/${currentCellarId}/bottles`);
  currentElements = await api.get(`/api/cellars/${currentCellarId}/elements`);
  activeChips = { type: null, country: null, region: null };
  updateFilterBadge();
  document.getElementById('cellar-search-input').value = '';
  renderChips();
  applyFilters();
  await renderWishlist();
}

function openSheet(id) {
  document.getElementById(id).classList.add('open');
}
function closeSheet(id) {
  document.getElementById(id).classList.remove('open');
}

// ---- elementi cantina ----

function elemCapacity(el) {
  return el.kind === 'Scatolone' ? null : el.tiers * el.cols * el.depth;
}
function elemCount(el) {
  return occupants().filter((o) => o.place.element_id === el.id).length;
}
function elemSub(el) {
  if (el.kind === 'Scatolone') return 'Nessuno slot — solo elenco';
  return `${el.tiers} livelli × ${el.cols} col.${el.depth > 1 ? ' × prof.' + el.depth : ''}`;
}

function openElementsOverlay() {
  elementsMode = 'list';
  document.getElementById('elements-back-btn').style.visibility = 'hidden';
  renderElementsList();
  openSheet('elements-overlay');
}

function closeElementsOverlay() {
  closeSheet('elements-overlay');
  picker = null;
  slotSel = null;
  movingPlace = null;
}

function renderElementsList() {
  elementsMode = 'list';
  slotSel = null;
  movingPlace = null;
  document.getElementById('elements-back-btn').style.visibility = 'hidden';
  const cellarName = cellars.find((c) => c.id === currentCellarId)?.name ?? '';
  document.getElementById('elements-title').textContent = picker ? 'Scegli dove riporla' : `Elementi — ${cellarName}`;

  const kindChipsHtml =
    `<div class="chip active" data-v="" role="button" tabindex="0" aria-pressed="true">Tutti</div>` + KINDS.map((k) => `<div class="chip" data-v="${k}" role="button" tabindex="0" aria-pressed="false">${k}</div>`).join('');

  const body = document.getElementById('elements-body');
  body.innerHTML = `
    <div class="chips" id="elements-kind-chips" style="margin-bottom:16px;">${kindChipsHtml}</div>
    <div id="elements-list" style="display:flex; flex-direction:column; gap:9px;"></div>
    <div class="add-row-btn" id="new-element-btn" style="margin-top:14px;" role="button" tabindex="0">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      Nuovo elemento
    </div>`;

  let activeKind = '';
  function renderFiltered() {
    const list = currentElements.filter((el) => !activeKind || el.kind === activeKind);
    document.getElementById('elements-list').innerHTML = list.length
      ? list
          .map(
            (el) => `
        <div class="elem-row" data-id="${el.id}" role="button" tabindex="0">
          <div class="elem-icon">${KIND_ICON[el.kind]}</div>
          <div class="elem-body"><div class="elem-name">${escapeHtml(el.name)}</div><div class="elem-sub">${escapeHtml(el.kind)} · ${escapeHtml(elemSub(el))}</div></div>
          <div class="elem-count">${elemCount(el)} bott.</div>
        </div>`,
          )
          .join('')
      : '<div class="empty-note">Nessun elemento di questo tipo. Creane uno con "Nuovo elemento".</div>';
    document.querySelectorAll('#elements-list .elem-row').forEach((row) =>
      row.addEventListener('click', () => renderElementDetail(Number(row.dataset.id))),
    );
  }
  renderFiltered();

  document.querySelectorAll('#elements-kind-chips .chip').forEach((chip) =>
    chip.addEventListener('click', () => {
      document.querySelectorAll('#elements-kind-chips .chip').forEach((c) => { c.classList.remove('active'); c.setAttribute('aria-pressed', 'false'); });
      chip.classList.add('active');
      chip.setAttribute('aria-pressed', 'true');
      activeKind = chip.dataset.v;
      renderFiltered();
    }),
  );
  document.getElementById('new-element-btn').addEventListener('click', renderElementCreateForm);
}

function renderElementCreateForm() {
  elementsMode = 'create';
  document.getElementById('elements-back-btn').style.visibility = 'visible';
  document.getElementById('elements-title').textContent = 'Nuovo elemento';

  const body = document.getElementById('elements-body');
  body.innerHTML = `
    <div class="field-label" style="margin-bottom:9px;">Tipo</div>
    <div class="kind-grid" id="kind-grid">
      ${KINDS.map(
        (k, i) => `
        <div class="kind-opt${i === 0 ? ' active' : ''}" data-kind="${k}" role="button" tabindex="0" aria-pressed="${i === 0}">
          <div class="elem-icon">${KIND_ICON[k]}</div>
          <div class="kname">${k}</div>
          <div class="kdesc">${k === 'Scatolone' ? 'Solo elenco contenuto, niente slot' : 'Griglia a slot, livelli × colonne'}</div>
        </div>`,
      ).join('')}
    </div>
    <div class="field-label" style="margin:14px 0 9px;">Nome</div>
    <input class="text-input" id="new-elem-name" aria-label="Nome dell'elemento" placeholder="es. Scaffale cucina, Frigo vini">
    <div id="new-elem-dims" style="margin-top:14px;">
      <div class="field-label" style="margin-bottom:9px;">Definisci gli slot</div>
      <div class="dims-row" style="flex-wrap:wrap; row-gap:8px;">
        Livelli <input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" autocomplete="off" class="num-input" id="new-elem-tiers" aria-label="Livelli" value="3">
        × Colonne <input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" autocomplete="off" class="num-input" id="new-elem-cols" aria-label="Colonne" value="5">
        × Profondità <input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="1" autocomplete="off" class="num-input" id="new-elem-depth" aria-label="Profondità" value="1">
      </div>
    </div>
    <div class="primary-btn" id="create-element-btn" style="margin-top:16px;" role="button" tabindex="0">Crea elemento</div>`;

  document.querySelectorAll('#kind-grid .kind-opt').forEach((opt) =>
    opt.addEventListener('click', () => {
      document.querySelectorAll('#kind-grid .kind-opt').forEach((o) => { o.classList.remove('active'); o.setAttribute('aria-pressed', 'false'); });
      opt.classList.add('active');
      opt.setAttribute('aria-pressed', 'true');
      document.getElementById('new-elem-dims').style.display = opt.dataset.kind === 'Scatolone' ? 'none' : 'block';
    }),
  );

  document.getElementById('create-element-btn').addEventListener('click', async () => {
    const kind = document.querySelector('#kind-grid .kind-opt.active').dataset.kind;
    const name = document.getElementById('new-elem-name').value.trim() || defaultElementName(kind);
    const body = { kind, name };
    if (kind !== 'Scatolone') {
      body.tiers = parseInt(document.getElementById('new-elem-tiers').value) || 3;
      body.cols = parseInt(document.getElementById('new-elem-cols').value) || 5;
      body.depth = Math.min(2, parseInt(document.getElementById('new-elem-depth').value) || 1);
    }
    const created = await api.post(`/api/cellars/${currentCellarId}/elements`, body);
    currentElements.push(created);
    renderElementsList();
  });
}

// Rename and delete, top right of an element's page.
const ELEMENT_TOOLS = `<div class="elem-tools">
  <div class="icon-btn" id="rename-element-btn" title="Rinomina elemento" role="button" tabindex="0" aria-label="Rinomina elemento"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></div>
  <div class="icon-btn danger" id="delete-element-btn" title="Elimina elemento" role="button" tabindex="0" aria-label="Elimina elemento"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/><path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/></svg></div>
</div>`;

async function renameCurrentElement() {
  const el = currentElements.find((e) => e.id === currentElementId);
  if (!el) return;
  const name = await promptModal('', { title: 'Nome dell\'elemento', defaultValue: el.name, placeholder: 'es. Cella cucina', confirmLabel: 'Salva' });
  if (name == null || !name.trim() || name.trim() === el.name) return;
  const updated = await api.patch(`/api/elements/${el.id}`, { name: name.trim() });
  el.name = updated.name;
  // Positions shown in Cantina and in the wine sheets carry the name too.
  currentBottles.forEach((b) => (b.places ?? []).forEach((p) => { if (p.element_id === el.id) p.element_name = el.name; }));
  applyFilters();
  renderElementDetail(el.id);
}

// A new element left unnamed gets its kind, numbered if that name is taken
// ("Cella", "Cella 2"…), so two identical ones can be told apart.
function defaultElementName(kind) {
  const taken = new Set(currentElements.map((e) => e.name));
  if (!taken.has(kind)) return kind;
  let n = 2;
  while (taken.has(`${kind} ${n}`)) n++;
  return `${kind} ${n}`;
}

function renderElementDetail(id) {
  elementsMode = 'detail';
  currentElementId = id;
  document.getElementById('elements-back-btn').style.visibility = 'visible';
  const el = currentElements.find((e) => e.id === id);
  document.getElementById('elements-title').textContent = el.name;

  const body = document.getElementById('elements-body');

  if (el.kind === 'Scatolone') {
    // One line per wine, with how many of its bottles are in the box.
    const counts = new Map();
    for (const o of occupants()) if (o.place.element_id === id) counts.set(o.bottle, (counts.get(o.bottle) ?? 0) + 1);
    const items = [...counts];
    body.innerHTML = `
      ${ELEMENT_TOOLS}
      <p class="box-note">Gli scatoloni non hanno slot: è solo un elenco di cosa c'è dentro.</p>
      <div class="box-contents">${
        items.length
          ? items.map(([b, n]) => `<div class="box-item">${photoHtml(b, 'bphoto')}<div class="bname">${escapeHtml(b.name)}</div><div class="elem-count">×${n}</div></div>`).join('')
          : '<div class="empty-note">Scatolone vuoto.</div>'
      }</div>
      <div class="primary-btn" id="assign-box-btn" style="margin-top:14px;" role="button" tabindex="0">${picker ? `Metti "${escapeHtml(picker.bottle.name)}" qui` : 'Aggiungi bottiglia'}</div>`;
    document.getElementById('delete-element-btn').addEventListener('click', () => deleteCurrentElement());
  document.getElementById('rename-element-btn').addEventListener('click', () => renameCurrentElement());
    document.getElementById('assign-box-btn').addEventListener('click', () => placeBottle(id, null, null, null));
    return;
  }

  const occupied = elemCount(el);
  const capacity = elemCapacity(el);
  const here = occupants().filter((o) => o.place.element_id === id);
  const bottleAt = (t, c, d) => here.find((o) => o.place.slot_tier === t && o.place.slot_col === c && o.place.slot_depth === d);
  const selected = slotSel ? here.find((o) => o.place.id === slotSel) : null;
  // Moving only makes sense in the grid: the free slots are the targets.
  if (movingPlace) elemView = 'grid';

  let html = `
    ${ELEMENT_TOOLS}
    <div class="elements-view">
    <div class="elem-stats">
      <div class="stat"><b>${capacity}</b><span>Capacità</span></div>
      <div class="stat"><b>${occupied}</b><span>Occupati</span></div>
      <div class="stat"><b>${capacity - occupied}</b><span>Liberi</span></div>
    </div>
    <div class="segmented slot-view-toggle">
      <button type="button" data-view="grid" class="${elemView === 'grid' ? 'active' : ''}" aria-pressed="${elemView === 'grid'}">Griglia</button>
      <button type="button" data-view="list" class="${elemView === 'list' ? 'active' : ''}" aria-pressed="${elemView === 'list'}">Elenco</button>
    </div>
    ${movingPlace ? `<div class="slot-move-banner"><span>Tocca uno slot libero per spostare <b>${escapeHtml(movingPlace.bottle.name)}</b></span><button type="button" id="slot-move-cancel">Annulla</button></div>` : ''}`;

  if (elemView === 'list') {
    const rows = [...here].sort((a, b) => a.place.slot_tier - b.place.slot_tier || a.place.slot_depth - b.place.slot_depth || a.place.slot_col - b.place.slot_col);
    html += `<div class="slot-list">${rows.map((o) => `
      <div class="elem-row slot-list-row${selected === o ? ' sel' : ''}" data-place="${o.place.id}" role="button" tabindex="0" aria-expanded="${selected === o}">
        ${photoHtml(o.bottle, 'cphoto')}
        <div class="elem-body"><div class="elem-name">${escapeHtml(o.bottle.name)}</div><div class="elem-sub">${escapeHtml(o.bottle.producer)}${o.bottle.vintage ? ' · ' + o.bottle.vintage : ''}</div></div>
        <span class="slot-pos">${colLetter(o.place.slot_col)}.${o.place.slot_depth} · L${o.place.slot_tier}</span>
      </div>${selected === o ? slotCardHtml(o, { compact: true }) : ''}`).join('')}
      ${capacity - occupied > 0 ? `<div class="slot-list-free">${capacity - occupied} ${capacity - occupied === 1 ? 'slot libero' : 'slot liberi'}: passa alla griglia per riempirli</div>` : ''}
    </div>`;
  } else {
    for (let t = 1; t <= el.tiers; t++) {
      html += `<div class="tier-block"><div class="tier-label">Livello ${t}</div><div class="tier-rows">`;
      for (let d = 1; d <= el.depth; d++) {
        html += `<div class="slot-row">`;
        for (let c = 0; c < el.cols; c++) {
          const occ = bottleAt(t, c, d);
          const cls = occ ? ` filled ${slotTypeClass(occ.bottle)}${selected === occ ? ' sel' : ''}` : ` empty${movingPlace ? ' target' : ''}`;
          html += `<div class="slot-circle${cls}" data-t="${t}" data-c="${c}" data-d="${d}" role="button" tabindex="0" aria-label="Livello ${t}, ${colLetter(c)}.${d}, ${occ ? escapeHtml(occ.bottle.name) : 'libero'}"${occ ? ` aria-expanded="${selected === occ}"` : ''}><span class="slabel">${colLetter(c)}.${d}</span></div>`;
        }
        html += '</div>';
      }
      html += '</div></div>';
      // The selected bottle's card opens right under its own level, with an
      // arrow pointing at the slot (placed after render, see below).
      if (selected && selected.place.slot_tier === t && !movingPlace) html += slotCardHtml(selected);
    }
    html += `<div class="slot-legend"><span><i class="lg rosso"></i>Rosso</span><span><i class="lg bianco"></i>Bianco</span><span><i class="lg bollicine"></i>Bollicine</span><span><i class="lg rosato"></i>Rosato</span><span><i class="lg libero"></i>Libero</span></div>`;
    if (!movingPlace) html += `<p class="page-sub" style="margin:0; font-size:calc(11.5rem/17); color:#736a5d; text-align:center;">Tocca uno slot vuoto per posizionarci ${picker ? '"' + escapeHtml(picker.bottle.name) + '"' : 'una bottiglia'}. Tocca uno slot pieno per vederne il contenuto.</p>`;
  }
  html += '</div>';
  body.innerHTML = html;

  document.getElementById('delete-element-btn').addEventListener('click', () => deleteCurrentElement());
    document.getElementById('rename-element-btn').addEventListener('click', () => renameCurrentElement());
  body.querySelectorAll('.slot-view-toggle button').forEach((btn) => btn.addEventListener('click', () => {
    elemView = btn.dataset.view;
    renderElementDetail(id);
  }));
  document.getElementById('slot-move-cancel')?.addEventListener('click', () => { movingPlace = null; renderElementDetail(id); });
  body.querySelectorAll('.slot-circle').forEach((cell) => {
    const t = Number(cell.dataset.t), c = Number(cell.dataset.c), d = Number(cell.dataset.d);
    const occ = bottleAt(t, c, d);
    cell.addEventListener('click', () => {
      if (movingPlace) {
        if (!occ) moveBottleTo(movingPlace, id, t, c, d);
        return;
      }
      if (occ) { slotSel = slotSel === occ.place.id ? null : occ.place.id; renderElementDetail(id); }
      else placeBottle(id, t, c, d);
    });
  });
  body.querySelectorAll('.slot-list-row').forEach((row) => row.addEventListener('click', () => {
    const pid = Number(row.dataset.place);
    slotSel = slotSel === pid ? null : pid;
    renderElementDetail(id);
  }));
  if (selected) wireSlotCard(selected, id);
}

// Slot colour by wine type; empty slots are drawn dashed (.empty).
function slotTypeClass(b) {
  return { bianco: 'type-bianco', bollicine: 'type-bollicine', rosato: 'type-rosato' }[b.type] ?? '';
}

const SLOT_ICON = {
  open: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  uncork: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21h6M10 21V11l-1-4h6l-1 4v10"/><path d="M12 3v2M16 4l-1 1.5M8 4l1 1.5"/></svg>',
  move: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9l-3 3 3 3M19 9l3 3-3 3M2 12h20"/></svg>',
  free: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
};

const spotText = (p) => `Livello ${p.slot_tier} · ${colLetter(p.slot_col)}.${p.slot_depth}`;

// Card for an occupied slot, opened under its level (grid) or its row (list):
// the bottle and its position, then Apri / Stappa / Sposta / Libera. While
// picking a slot for another bottle it also offers to swap them.
// In the list the row above already shows the bottle and its position, so
// the compact card is just the actions.
function slotCardHtml(o, { compact = false } = {}) {
  const b = o.bottle;
  const canSwap = picker && picker.bottle.id !== b.id;
  const others = (Number(b.quantity) || 0) - 1;
  return `
    <div class="slot-card${compact ? ' compact' : ''}" id="slot-card">
      ${compact ? '' : `<div class="slot-card-main">
        ${photoHtml(b, 'cphoto')}
        <div class="elem-body"><div class="elem-name">${escapeHtml(b.name)}</div><div class="elem-sub">${escapeHtml(b.producer)}${b.vintage ? ' · ' + b.vintage : ''}${others > 0 ? ` · altre ${others} in cantina` : ''}</div></div>
      </div>
      <span class="slot-pos">${spotText(o.place)}</span>`}
      ${canSwap ? `<div class="primary-btn" id="slot-swap-btn" role="button" tabindex="0">Sostituisci con "${escapeHtml(picker.bottle.name)}"</div>` : ''}
      <div class="slot-actions">
        <button type="button" class="slot-act" id="slot-open-btn">${SLOT_ICON.open}Apri</button>
        <button type="button" class="slot-act" id="slot-uncork-btn">${SLOT_ICON.uncork}Stappa</button>
        <button type="button" class="slot-act" id="slot-move-btn">${SLOT_ICON.move}Sposta</button>
        <button type="button" class="slot-act danger" id="slot-free-btn">${SLOT_ICON.free}Libera</button>
      </div>
    </div>`;
}

function wireSlotCard(o, elId) {
  const card = document.getElementById('slot-card');
  if (!card) return;
  const b = o.bottle;
  // Point the card's arrow at the selected slot (grid only).
  const circle = document.querySelector('#elements-body .slot-circle.sel');
  if (circle) {
    const x = circle.getBoundingClientRect().left + circle.offsetWidth / 2 - card.getBoundingClientRect().left;
    card.style.setProperty('--arrow', `${Math.round(x)}px`);
    card.classList.add('with-arrow');
  }
  document.getElementById('slot-open-btn').addEventListener('click', async () => {
    closeElementsOverlay();
    await openDetail(b, await me());
  });
  document.getElementById('slot-swap-btn')?.addEventListener('click', async () => {
    const { bottle, onPicked } = picker;
    const { slot_tier: tier, slot_col: col, slot_depth: depth } = o.place;
    // Free the current occupant first, so the slot is empty for the new one.
    await freePlace(o);
    if (!(await putPickerBottle(bottle, elId, tier, col, depth))) return;
    closeElementsOverlay();
    onPicked?.(bottle);
  });
  document.getElementById('slot-move-btn').addEventListener('click', () => {
    movingPlace = o;
    slotSel = null;
    renderElementDetail(elId);
  });
  document.getElementById('slot-free-btn').addEventListener('click', async () => {
    const { element_id, slot_tier, slot_col, slot_depth } = o.place;
    await freePlace(o);
    slotSel = null;
    renderElementDetail(elId);
    showToast(`${spotText(o.place)} liberato`, {
      actionLabel: 'Annulla',
      onAction: async () => {
        await addPlace(b, element_id, slot_tier, slot_col, slot_depth);
        if (currentElementId === elId && elementsMode === 'detail') renderElementDetail(elId);
      },
    });
  });
  document.getElementById('slot-uncork-btn').addEventListener('click', () => uncorkFromSlot(o, elId));
}

// Same rules as "Stappa una bottiglia" in the wine's detail sheet: one fewer,
// with Annulla; the last one asks before removing the wine from the cellar.
// The bottle taken is the one in this slot, so this slot is the one freed.
async function uncorkFromSlot(o, elId) {
  const b = o.bottle;
  const before = Number(b.quantity) || 0;
  if (before <= 1) {
    const ok = await confirmModal("Era l'ultima bottiglia: rimuovere il vino dalla cantina?", {
      title: 'Ultima bottiglia',
      confirmLabel: 'Rimuovi',
      danger: true,
    });
    if (!ok) return;
    await api.del(`/api/bottles/${b.id}`);
    currentBottles = currentBottles.filter((x) => x.id !== b.id);
    slotSel = null;
    applyFilters();
    renderElementDetail(elId);
    showToast('Ultima bottiglia stappata: slot libero');
    return;
  }
  const { element_id, slot_tier, slot_col, slot_depth } = o.place;
  await freePlace(o);
  const updated = await api.patch(`/api/bottles/${b.id}`, { quantity: before - 1 });
  b.quantity = before - 1;
  b.places = updated.places;
  slotSel = null;
  applyFilters();
  renderElementDetail(elId);
  showToast(`Stappata · ${b.quantity === 1 ? 'ne resta 1' : `ne restano ${b.quantity}`}`, {
    actionLabel: 'Annulla',
    onAction: async () => {
      await api.patch(`/api/bottles/${b.id}`, { quantity: before });
      b.quantity = before;
      await addPlace(b, element_id, slot_tier, slot_col, slot_depth);
      if (currentElementId === elId && elementsMode === 'detail') renderElementDetail(elId);
    },
  });
}

async function moveBottleTo(o, elId, t, c, d) {
  const res = await api.patch(`/api/places/${o.place.id}`, { elementId: elId, tier: t, col: c, depth: d });
  o.bottle.places = res.places;
  movingPlace = null;
  slotSel = o.place.id;
  applyFilters();
  renderElementDetail(elId);
  showToast(`Spostata in Livello ${t} · ${colLetter(c)}.${d}`);
}

// One more bottle of this wine goes to this spot (refused by the server
// when every bottle already has a place).
async function addPlace(bottle, elId, tier, col, depth) {
  const res = await api.post(`/api/bottles/${bottle.id}/places`, { elementId: elId, tier, col, depth });
  bottle.places = res.places;
  applyFilters();
}

async function freePlace(o) {
  const res = await api.del(`/api/places/${o.place.id}`);
  o.bottle.places = res.places;
  applyFilters();
}

// The wine chosen from its detail sheet goes here: a bottle still without a
// place if there is one; if its only bottle is already somewhere, it moves.
// With several bottles all placed it is ambiguous which one to move.
async function putPickerBottle(bottle, elId, tier, col, depth) {
  if (freeCount(bottle) > 0) {
    await addPlace(bottle, elId, tier, col, depth);
    return true;
  }
  if (bottle.places?.length === 1) {
    const res = await api.patch(`/api/places/${bottle.places[0].id}`, { elementId: elId, tier, col, depth });
    bottle.places = res.places;
    applyFilters();
    return true;
  }
  showToast('Tutte le bottiglie hanno già un posto: per spostarne una toccala e scegli Sposta');
  return false;
}

async function placeBottle(elId, tier, col, depth) {
  if (picker) {
    const bottle = picker.bottle;
    if (!(await putPickerBottle(bottle, elId, tier, col, depth))) return;
    const onPicked = picker.onPicked;
    closeElementsOverlay();
    onPicked?.(bottle);
    return;
  }
  // Browsing an empty slot outside picker mode: let the user choose which
  // bottle goes here instead of requiring them to start from that bottle's
  // own detail screen every time.
  renderBottlePickerForSlot(elId, tier, col, depth);
}

function renderBottlePickerForSlot(elId, tier, col, depth) {
  elementsMode = 'pick-bottle';
  document.getElementById('elements-back-btn').style.visibility = 'visible';
  document.getElementById('elements-title').textContent = 'Scegli la bottiglia';

  // Only wines with a bottle still without a place: each bottle has one spot.
  const choices = currentBottles.filter((b) => freeCount(b) > 0);
  const slotLabel = tier == null ? 'questo elemento' : `Livello ${tier} · ${colLetter(col)}.${depth}`;
  const body = document.getElementById('elements-body');
  body.innerHTML = `
    <p class="page-sub" style="margin:0 0 4px; font-size:calc(11.5rem/17); color:#736a5d;">${slotLabel} — scegli quale bottiglia mettere qui:</p>
    <div id="pick-bottle-list" style="display:flex; flex-direction:column; gap:9px;">${
      choices.length
        ? choices
            .map((b) => {
              const free = freeCount(b);
              const sub = b.places?.length ? `${free} ${free === 1 ? 'bottiglia' : 'bottiglie'} senza posto · ${locationLabel({ ...b, quantity: b.places.length })}` : `${free} ${free === 1 ? 'bottiglia' : 'bottiglie'} senza posto`;
              return `
        <div class="elem-row" data-id="${b.id}" role="button" tabindex="0">
          ${photoHtml(b, 'cphoto')}
          <div class="elem-body"><div class="elem-name">${escapeHtml(b.name)}</div><div class="elem-sub">${escapeHtml(sub)}</div></div>
        </div>`;
            })
            .join('')
        : `<div class="empty-note">${currentBottles.length ? 'Tutte le bottiglie hanno già un posto.' : 'Nessuna bottiglia in questa cantina.'}</div>`
    }</div>`;
  document.querySelectorAll('#pick-bottle-list .elem-row').forEach((row) =>
    row.addEventListener('click', async () => {
      const bottle = currentBottles.find((b) => b.id === Number(row.dataset.id));
      if (!bottle) return;
      await addPlace(bottle, elId, tier, col, depth);
      renderElementDetail(elId);
    }),
  );
}

async function deleteCurrentElement() {
  const ok = await confirmModal('Le bottiglie al suo interno resteranno senza posizione.', {
    title: 'Eliminare questo elemento?',
    confirmLabel: 'Elimina',
    danger: true,
  });
  if (!ok) return;
  await api.del(`/api/elements/${currentElementId}`);
  currentElements = currentElements.filter((e) => e.id !== currentElementId);
  currentBottles.forEach((b) => {
    b.places = (b.places ?? []).filter((p) => p.element_id !== currentElementId);
  });
  applyFilters();
  renderElementsList();
}

// Opened from a bottle's "modifica posizione" link, on top of the already-open
// detail overlay. onPicked receives the mutated bottle once a slot is chosen.
export async function openLocationPicker(bottle, onPicked) {
  await ensureCellarOf(bottle);
  picker = { bottle: currentBottles.find((b) => b.id === bottle.id) ?? bottle, onPicked };
  openElementsOverlay();
}

function wireStaticControls() {
  const cellarList = document.getElementById('cellar-list');
  const compareBtn = document.getElementById('compare-open');
  const compareBar = document.getElementById('compare-bar');

  compareBtn?.addEventListener('click', () => {
    compareMode = !compareMode;
    closeOpenItem(false);
    if (compareMode) {
      compareSelected = [];
      cellarList.classList.add('selecting');
      compareBar.classList.add('show');
      compareBtn.innerHTML = ICON_CANCEL;
      updateCompareBar();
    } else {
      exitCompareMode();
    }
  });

  if (cellarList) wireSwipe(cellarList);

  cellarList?.addEventListener('click', (e) => {
    if (!compareMode) return;
    const row = e.target.closest('.cellar-row');
    if (!row) return;
    if (row.classList.contains('selected')) {
      row.classList.remove('selected');
      compareSelected = compareSelected.filter((r) => r !== row);
    } else if (compareSelected.length < 2) {
      row.classList.add('selected');
      compareSelected.push(row);
    }
    updateCompareBar();
  });

  document.getElementById('compare-cancel')?.addEventListener('click', exitCompareMode);

  document.getElementById('compare-go')?.addEventListener('click', () => {
    if (compareSelected.length !== 2) return;
    const cols = document.querySelectorAll('#compare-overlay .compare-col');
    compareSelected.forEach((row, i) => {
      cols[i].querySelector('.compare-photo').className = 'compare-photo photo ' + row.dataset.photo;
      cols[i].querySelector('.cname').textContent = row.dataset.name;
      cols[i].querySelector('.csub').textContent = row.dataset.sub;
      const stats = cols[i].querySelectorAll('.stat-line b');
      stats[0].textContent = row.dataset.score;
      stats[1].textContent = row.dataset.price;
    });
    document.getElementById('compare-overlay').classList.add('open');
    exitCompareMode();
  });

  document.getElementById('compare-close')?.addEventListener('click', () => document.getElementById('compare-overlay').classList.remove('open'));

  // Scoped to #view-cellar: `.segmented` is also used by Home's Da
  // bere/Regioni/Attività tabs (and by Esplora's Vini/Categorie tabs,
  // wired separately). A document-wide selector here would also catch
  // clicks on those, and since none of them carries `data-wall`, every
  // such click would fall into the `else` branch below and silently
  // flip #cellar-list/#wishlist-list to the wishlist view in the
  // background — invisible until the next visit to Cantina.
  document.querySelectorAll('#view-cellar .segmented button').forEach((btn) => {
    btn.addEventListener('click', () => {
      btn.parentElement.querySelectorAll('button').forEach((b) => { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      const owned = document.getElementById('cellar-list');
      const wish = document.getElementById('wishlist-list');
      if (btn.dataset.wall === 'owned') {
        owned.style.display = 'flex';
        wish.style.display = 'none';
      } else {
        owned.style.display = 'none';
        wish.style.display = 'flex';
      }
    });
  });

  document.getElementById('cellar-search-input')?.addEventListener('input', applyFilters);
  document.getElementById('cantina-switch')?.addEventListener('click', () => {
    renderCellarRows();
    openSheet('cellar-sheet');
  });
  document.getElementById('cellar-sheet-close')?.addEventListener('click', () => closeSheet('cellar-sheet'));
  document.getElementById('cellar-filter-btn')?.addEventListener('click', () => openSheet('filter-sheet'));
  document.getElementById('filter-sheet-close')?.addEventListener('click', () => closeSheet('filter-sheet'));
  document.getElementById('new-cellar-btn')?.addEventListener('click', async () => {
    const name = await promptModal('Nome della nuova cantina:', { title: 'Nuova cantina', defaultValue: 'Nuova cantina', confirmLabel: 'Crea' });
    if (!name?.trim()) return;
    const cellar = await api.post('/api/cellars', { name });
    cellars.push(cellar);
    renderCellarRows();
  });

  document.getElementById('elements-link')?.addEventListener('click', () => {
    picker = null;
    openElementsOverlay();
  });
  document.getElementById('elements-close')?.addEventListener('click', closeElementsOverlay);
  document.getElementById('elements-back-btn')?.addEventListener('click', () => {
    if (elementsMode === 'list') closeElementsOverlay();
    else if (elementsMode === 'pick-bottle') renderElementDetail(currentElementId);
    else renderElementsList();
  });
}

wireStaticControls();

export async function mountCellar() {
  // Rows get replaced below, so any stale selection from a previous visit
  // would reference detached nodes — drop it and reset the compare UI.
  exitCompareMode();

  cellars = await api.get('/api/cellars');
  if (!cellars.some((c) => c.id === currentCellarId)) currentCellarId = cellars[0].id;
  document.getElementById('active-cellar-name').textContent = cellars.find((c) => c.id === currentCellarId).name;
  await loadCellarData();
}
