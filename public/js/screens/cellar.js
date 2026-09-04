import { api } from '../api-client.js';
import { escapeHtml, photoClass } from '../util.js';
import { openDetail } from './detail.js';
import { me } from '../auth.js';
import { confirmModal, promptModal } from '../modal.js';

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

function colLetter(i) {
  return String.fromCharCode(65 + i);
}

// A real product photo (saved from a web-search candidate) beats the
// generic type-tinted placeholder whenever one is on file.
function photoHtml(b, className) {
  return b.image_url
    ? `<img class="${className} photo" src="${escapeHtml(b.image_url)}" alt="">`
    : `<div class="${className} photo ${photoClass(b.type)}"></div>`;
}

export function locationLabel(b) {
  if (!b.element_name) return '';
  if (b.slot_tier == null) return b.element_name;
  return `${b.element_name} · Livello ${b.slot_tier} · ${colLetter(b.slot_col)}.${b.slot_depth}`;
}

function rowHtml(b) {
  const photo = photoClass(b.type);
  const name = escapeHtml(b.name);
  const sub = `${escapeHtml(b.producer)} · ${escapeHtml(b.region ?? b.country)}`;
  const price = b.price_paid != null ? `€${escapeHtml(b.price_paid)}` : '—';
  const score = b.score != null ? b.score.toFixed(1) : '—';
  const loc = locationLabel(b);
  const quantity = escapeHtml(b.quantity);
  return `
    <div class="cellar-row" data-id="${b.id}" data-photo="${photo}" data-name="${name}" data-sub="${sub}" data-price="${price}" data-score="${score}">
      <div class="rowcheck"><svg class="check-ic" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 12 9 17 20 6"/></svg></div>
      ${photoHtml(b, 'cphoto')}
      <div class="cinfo"><div class="name">${name}</div><div class="sub">${sub} · ×${quantity}${loc ? ' · ' + escapeHtml(loc) : ''}</div></div>
      <div class="cprice">${price}<small>a bottiglia</small></div>
      <div class="row-actions">
        <div class="icon-btn edit-btn" data-id="${b.id}" title="Modifica"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></div>
        <div class="icon-btn danger delete-btn" data-id="${b.id}" title="Elimina"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/><path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/></svg></div>
      </div>
    </div>`;
}

function wishRowHtml(w) {
  const photo = photoClass(w.type);
  const name = escapeHtml(w.name);
  const price = w.target_price ? ' · €' + escapeHtml(w.target_price) : '';
  const sub = `${escapeHtml(w.producer)} · ${escapeHtml(w.region ?? w.country)}${price}`;
  return `
    <div class="wish-row" data-id="${w.id}">
      <div class="wish-photo photo ${photo}"></div>
      <div class="result-body"><div class="name">${name}</div><div class="sub">${sub}</div></div>
      <div class="wish-add" data-id="${w.id}">Rimuovi dai desideri</div>
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
      `<div class="chip active" data-v="">${g.allLabel}</div>` +
      values.map((v) => `<div class="chip" data-v="${escapeHtml(v)}">${escapeHtml(capitalize(v))}</div>`).join('');
    el.querySelectorAll('.chip').forEach((chip) =>
      chip.addEventListener('click', () => {
        el.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
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
  document.getElementById('cellar-results-count').textContent = filtered.length + (filtered.length === 1 ? ' bottiglia' : ' bottiglie');
  renderList(filtered);
}

function renderList(bottles) {
  const list = document.getElementById('cellar-list');
  list.innerHTML = bottles.map(rowHtml).join('') || '<div class="empty-note">Nessun vino trovato con questi filtri.</div>';
  list.querySelectorAll('.delete-btn').forEach((btn) =>
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const bottle = currentBottles.find((b) => b.id === Number(btn.dataset.id));
      const ok = await confirmModal(`Eliminare "${bottle?.name ?? 'questa bottiglia'}" dalla cantina?`, {
        title: 'Elimina bottiglia',
        confirmLabel: 'Elimina',
        danger: true,
      });
      if (!ok) return;
      await api.del(`/api/bottles/${btn.dataset.id}`);
      currentBottles = await api.get(`/api/cellars/${currentCellarId}/bottles`);
      renderChips();
      applyFilters();
    }),
  );
  list.querySelectorAll('.cellar-row').forEach((row) =>
    row.addEventListener('click', async () => {
      if (compareMode) return;
      const bottle = currentBottles.find((b) => b.id === Number(row.dataset.id));
      if (bottle) await openDetail(bottle, await me());
    }),
  );
}

async function renderWishlist() {
  const wishlist = await api.get(`/api/cellars/${currentCellarId}/wishlist`);
  const wishEl = document.getElementById('wishlist-list');
  wishEl.innerHTML = wishlist.length ? wishlist.map(wishRowHtml).join('') : '<div class="empty-note">Nessun vino nei desideri.</div>';
  wishEl.querySelectorAll('.wish-add').forEach((btn) =>
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await api.del(`/api/wishlist/${btn.dataset.id}`);
      btn.closest('.wish-row').remove();
    }),
  );
}

function updateCompareBar() {
  document.getElementById('compare-count').textContent = `${compareSelected.length}/2 selezionati`;
  document.getElementById('compare-go').disabled = compareSelected.length !== 2;
}

function exitCompareMode() {
  compareMode = false;
  compareSelected = [];
  const cellarList = document.getElementById('cellar-list');
  cellarList.classList.remove('selecting');
  cellarList.querySelectorAll('.cellar-row.selected').forEach((r) => r.classList.remove('selected'));
  document.getElementById('compare-bar').classList.remove('show');
  const compareBtn = document.getElementById('compare-open');
  if (compareBtn) compareBtn.innerHTML = ICON_COMPARE;
}

// ---- selettore cantina ----

function renderCellarRows() {
  document.getElementById('cellar-rows').innerHTML = cellars
    .map(
      (c, i) => `
      <div class="list-row ${c.id === currentCellarId ? 'active' : ''}">
        <div class="radio" data-i="${i}"></div>
        <div class="lbody" data-i="${i}"><div class="lname">${escapeHtml(c.name)}</div></div>
        <div class="icon-btn rename-cellar-btn" data-i="${i}" title="Rinomina"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></div>
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
  return currentBottles.filter((b) => b.element_id === el.id).length;
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
}

function renderElementsList() {
  elementsMode = 'list';
  document.getElementById('elements-back-btn').style.visibility = 'hidden';
  const cellarName = cellars.find((c) => c.id === currentCellarId)?.name ?? '';
  document.getElementById('elements-title').textContent = picker ? 'Scegli dove riporla' : `Elementi — ${cellarName}`;

  const kindChipsHtml =
    `<div class="chip active" data-v="">Tutti</div>` + KINDS.map((k) => `<div class="chip" data-v="${k}">${k}</div>`).join('');

  const body = document.getElementById('elements-body');
  body.innerHTML = `
    <div class="chips" id="elements-kind-chips" style="margin-bottom:16px;">${kindChipsHtml}</div>
    <div id="elements-list" style="display:flex; flex-direction:column; gap:9px;"></div>
    <div class="add-row-btn" id="new-element-btn" style="margin-top:14px;">
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
        <div class="elem-row" data-id="${el.id}">
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
      document.querySelectorAll('#elements-kind-chips .chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
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
        <div class="kind-opt${i === 0 ? ' active' : ''}" data-kind="${k}">
          <div class="elem-icon">${KIND_ICON[k]}</div>
          <div class="kname">${k}</div>
          <div class="kdesc">${k === 'Scatolone' ? 'Solo elenco contenuto, niente slot' : 'Griglia a slot, livelli × colonne'}</div>
        </div>`,
      ).join('')}
    </div>
    <div class="field-label" style="margin:14px 0 9px;">Nome</div>
    <input class="text-input" id="new-elem-name" placeholder="es. Scaffale cucina, Frigo vini">
    <div id="new-elem-dims" style="margin-top:14px;">
      <div class="field-label" style="margin-bottom:9px;">Definisci gli slot</div>
      <div class="dims-row" style="flex-wrap:wrap; row-gap:8px;">
        Livelli <input type="number" class="num-input" id="new-elem-tiers" value="3" min="1">
        × Colonne <input type="number" class="num-input" id="new-elem-cols" value="5" min="1">
        × Profondità <input type="number" class="num-input" id="new-elem-depth" value="1" min="1" max="2">
      </div>
    </div>
    <div class="primary-btn" id="create-element-btn" style="margin-top:16px;">Crea elemento</div>`;

  document.querySelectorAll('#kind-grid .kind-opt').forEach((opt) =>
    opt.addEventListener('click', () => {
      document.querySelectorAll('#kind-grid .kind-opt').forEach((o) => o.classList.remove('active'));
      opt.classList.add('active');
      document.getElementById('new-elem-dims').style.display = opt.dataset.kind === 'Scatolone' ? 'none' : 'block';
    }),
  );

  document.getElementById('create-element-btn').addEventListener('click', async () => {
    const kind = document.querySelector('#kind-grid .kind-opt.active').dataset.kind;
    const name = document.getElementById('new-elem-name').value.trim() || kind;
    const body = { kind, name };
    if (kind !== 'Scatolone') {
      body.tiers = parseInt(document.getElementById('new-elem-tiers').value) || 3;
      body.cols = parseInt(document.getElementById('new-elem-cols').value) || 5;
      body.depth = parseInt(document.getElementById('new-elem-depth').value) || 1;
    }
    const created = await api.post(`/api/cellars/${currentCellarId}/elements`, body);
    currentElements.push(created);
    renderElementsList();
  });
}

function renderElementDetail(id) {
  elementsMode = 'detail';
  currentElementId = id;
  document.getElementById('elements-back-btn').style.visibility = 'visible';
  const el = currentElements.find((e) => e.id === id);
  document.getElementById('elements-title').textContent = el.name;

  const body = document.getElementById('elements-body');

  if (el.kind === 'Scatolone') {
    const items = currentBottles.filter((b) => b.element_id === id);
    body.innerHTML = `
      <div class="icon-btn danger" id="delete-element-btn" title="Elimina elemento" style="align-self:flex-end; margin-bottom:10px;"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/><path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/></svg></div>
      <p class="box-note">Gli scatoloni non hanno slot: è solo un elenco di cosa c'è dentro.</p>
      <div class="box-contents">${
        items.length
          ? items.map((b) => `<div class="box-item">${photoHtml(b, 'bphoto')}<div class="bname">${escapeHtml(b.name)}</div><div class="elem-count">×${b.quantity}</div></div>`).join('')
          : '<div class="empty-note">Scatolone vuoto.</div>'
      }</div>
      <div class="primary-btn" id="assign-box-btn" style="margin-top:14px;">${picker ? `Metti "${escapeHtml(picker.bottle.name)}" qui` : 'Aggiungi bottiglia'}</div>`;
    document.getElementById('delete-element-btn').addEventListener('click', () => deleteCurrentElement());
    document.getElementById('assign-box-btn').addEventListener('click', () => placeBottle(id, null, null, null));
    return;
  }

  const occupied = elemCount(el);
  const capacity = elemCapacity(el);
  let html = `
    <div class="icon-btn danger" id="delete-element-btn" title="Elimina elemento" style="align-self:flex-end; margin-bottom:10px;"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/><path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/></svg></div>
    <div class="elements-view">
    <div class="elem-stats">
      <div class="stat"><b>${capacity}</b><span>Capacità</span></div>
      <div class="stat"><b>${occupied}</b><span>Occupati</span></div>
      <div class="stat"><b>${capacity - occupied}</b><span>Liberi</span></div>
    </div>
    <div class="bottle-popup" id="bottle-popup"></div>`;
  for (let t = 1; t <= el.tiers; t++) {
    html += `<div class="tier-block"><div class="tier-label">Livello ${t}</div><div class="tier-rows">`;
    for (let d = 1; d <= el.depth; d++) {
      html += `<div class="slot-row">`;
      for (let c = 0; c < el.cols; c++) {
        const occ = currentBottles.find((b) => b.element_id === id && b.slot_tier === t && b.slot_col === c && b.slot_depth === d);
        const typeClass = occ ? (occ.type === 'bianco' ? 'type-bianco' : occ.type === 'bollicine' ? 'type-bollicine' : '') : '';
        html += `<div class="slot-circle${occ ? ' filled ' + typeClass : ''}" data-t="${t}" data-c="${c}" data-d="${d}"><span class="slabel">${colLetter(c)}.${d}</span></div>`;
      }
      html += '</div>';
    }
    html += '</div></div>';
  }
  html += `<p class="page-sub" style="margin:0; font-size:11.5px; color:#8f8474; text-align:center;">Tocca uno slot vuoto per posizionarci ${picker ? '"' + escapeHtml(picker.bottle.name) + '"' : 'una bottiglia'}. Tocca uno slot pieno per vederne il contenuto.</p></div>`;
  body.innerHTML = html;

  document.getElementById('delete-element-btn').addEventListener('click', () => deleteCurrentElement());
  body.querySelectorAll('.slot-circle').forEach((cell) => {
    const t = Number(cell.dataset.t), c = Number(cell.dataset.c), d = Number(cell.dataset.d);
    const occ = currentBottles.find((b) => b.element_id === id && b.slot_tier === t && b.slot_col === c && b.slot_depth === d);
    cell.addEventListener('click', () => (occ ? showBottlePopup(occ) : placeBottle(id, t, c, d)));
  });
}

function showBottlePopup(b) {
  const popup = document.getElementById('bottle-popup');
  popup.innerHTML = `
    ${photoHtml(b, 'bphoto')}
    <div class="binfo"><div class="bname">${escapeHtml(b.name)}</div><div class="bsub">${escapeHtml(b.producer)}${b.vintage ? ' · ' + b.vintage : ''}</div></div>
    <div class="bgo" id="popup-open-btn">Apri ›</div>`;
  popup.classList.add('show');
  document.getElementById('popup-open-btn').addEventListener('click', async () => {
    closeElementsOverlay();
    await openDetail(b, await me());
  });
}

async function assignBottleToSlot(bottle, elId, tier, col, depth) {
  const updated = await api.patch(`/api/bottles/${bottle.id}/location`, { elementId: elId, tier, col, depth });
  const el = currentElements.find((e) => e.id === elId);
  bottle.element_id = updated.element_id;
  bottle.slot_tier = updated.slot_tier;
  bottle.slot_col = updated.slot_col;
  bottle.slot_depth = updated.slot_depth;
  bottle.element_name = el?.name;
  bottle.element_kind = el?.kind;
  applyFilters();
}

async function placeBottle(elId, tier, col, depth) {
  if (picker) {
    const bottle = picker.bottle;
    await assignBottleToSlot(bottle, elId, tier, col, depth);
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

  const slotLabel = tier == null ? 'questo elemento' : `Livello ${tier} · ${colLetter(col)}.${depth}`;
  const body = document.getElementById('elements-body');
  body.innerHTML = `
    <p class="page-sub" style="margin:0 0 4px; font-size:11.5px; color:#8f8474;">${slotLabel} — scegli quale bottiglia mettere qui:</p>
    <div id="pick-bottle-list" style="display:flex; flex-direction:column; gap:9px;">${
      currentBottles.length
        ? currentBottles
            .map(
              (b) => `
        <div class="elem-row" data-id="${b.id}">
          ${photoHtml(b, 'cphoto')}
          <div class="elem-body"><div class="elem-name">${escapeHtml(b.name)}</div>${locationLabel(b) ? `<div class="elem-sub">${escapeHtml(locationLabel(b))}</div>` : ''}</div>
        </div>`,
            )
            .join('')
        : '<div class="empty-note">Nessuna bottiglia in questa cantina.</div>'
    }</div>`;
  document.querySelectorAll('#pick-bottle-list .elem-row').forEach((row) =>
    row.addEventListener('click', async () => {
      const bottle = currentBottles.find((b) => b.id === Number(row.dataset.id));
      if (!bottle) return;
      await assignBottleToSlot(bottle, elId, tier, col, depth);
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
    if (b.element_id === currentElementId) {
      b.element_id = null;
      b.slot_tier = null;
      b.slot_col = null;
      b.slot_depth = null;
      b.element_name = null;
      b.element_kind = null;
    }
  });
  applyFilters();
  renderElementsList();
}

// Opened from a bottle's "modifica posizione" link, on top of the already-open
// detail overlay. onPicked receives the mutated bottle once a slot is chosen.
export function openLocationPicker(bottle, onPicked) {
  picker = { bottle, onPicked };
  openElementsOverlay();
}

function wireStaticControls() {
  const cellarList = document.getElementById('cellar-list');
  const compareBtn = document.getElementById('compare-open');
  const compareBar = document.getElementById('compare-bar');

  compareBtn?.addEventListener('click', () => {
    compareMode = !compareMode;
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

  document.querySelectorAll('.segmented button').forEach((btn) => {
    btn.addEventListener('click', () => {
      btn.parentElement.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
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
