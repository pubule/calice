import { api } from '../api-client.js';
import { escapeHtml, photoClass } from '../util.js';
import { openDetail } from './detail.js';
import { me } from '../auth.js';

const ICON_COMPARE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v18"/><path d="M16 3v18"/><path d="M3 8h4"/><path d="M17 8h4"/><path d="M3 16h4"/><path d="M17 16h4"/></svg> Confronta due vini';
const ICON_CANCEL =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/></svg> Annulla selezione';

let currentCellarId = null;
let currentBottles = [];
let compareMode = false;
let compareSelected = [];

function rowHtml(b) {
  const photo = photoClass(b.type);
  const name = escapeHtml(b.name);
  const sub = `${escapeHtml(b.producer)} · ${escapeHtml(b.region ?? b.country)}`;
  const price = b.price_paid != null ? `€${escapeHtml(b.price_paid)}` : '—';
  const score = b.score != null ? b.score.toFixed(1) : '—';
  const shelf = b.shelf_location ? ' · ' + escapeHtml(b.shelf_location) : '';
  const quantity = escapeHtml(b.quantity);
  return `
    <div class="cellar-row" data-id="${b.id}" data-photo="${photo}" data-name="${name}" data-sub="${sub}" data-price="${price}" data-score="${score}">
      <div class="rowcheck"><svg class="check-ic" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 12 9 17 20 6"/></svg></div>
      <div class="cphoto photo ${photo}"></div>
      <div class="cinfo"><div class="name">${name}</div><div class="sub">${sub} · ×${quantity}${shelf}</div></div>
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

async function renderList() {
  const list = document.getElementById('cellar-list');
  list.innerHTML = currentBottles.map(rowHtml).join('');
  list.querySelectorAll('.delete-btn').forEach((btn) =>
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await api.del(`/api/bottles/${btn.dataset.id}`);
      // Re-fetch from the server rather than trusting the optimistic local
      // removal, so the list reflects what actually persisted.
      currentBottles = await api.get(`/api/cellars/${currentCellarId}/bottles`);
      renderList();
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
  wishEl.innerHTML = wishlist.map(wishRowHtml).join('');
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

// Wire the controls that live in the static page shell (compare button/bar,
// row-selection delegation, segmented toggle) exactly once — this module is
// only ever evaluated a single time, whereas mountCellar() re-runs on every
// visit to #/cellar, so listeners for anything not re-rendered by mountCellar
// belong here, not there (attaching them per-visit would stack duplicate
// handlers on every revisit of the screen).
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
}

wireStaticControls();

export async function mountCellar() {
  // Rows get replaced below, so any stale selection from a previous visit
  // would reference detached nodes — drop it and reset the compare UI.
  exitCompareMode();

  const cellars = await api.get('/api/cellars');
  currentCellarId = cellars[0].id;
  currentBottles = await api.get(`/api/cellars/${currentCellarId}/bottles`);
  await renderList();
  await renderWishlist();
}
