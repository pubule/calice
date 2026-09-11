import { ITALY_REGIONS } from '../data/italy-regions.js';

const TYPE_COLOR = { rosso: '#5b2333', bianco: '#b9a750', bollicine: '#6b7a4f', rosato: '#a24a5a' };
const TYPE_LABEL = { rosso: 'Rosso', bianco: 'Bianco', bollicine: 'Bollicine', rosato: 'Rosato' };

const MENU_REGIONS = ITALY_REGIONS.filter((r) => r.hasData);

let selectedId = MENU_REGIONS[0].id;

function openDropdown() {
  document.getElementById('explore-dd').classList.add('open');
}
function closeDropdown() {
  document.getElementById('explore-dd').classList.remove('open');
}

function renderMap() {
  const svg = ITALY_REGIONS.map((r) => {
    const active = r.id === selectedId;
    const fill = active ? '#5b2333' : r.hasData ? '#d9a9b3' : '#e5e1d4';
    return `<path data-id="${r.id}" d="${r.d}" fill="${fill}" stroke="#ffffff" stroke-width="1.3" stroke-linejoin="round"/>`;
  }).join('');
  document.getElementById('explore-map').innerHTML = `<svg viewBox="0 0 610 793">${svg}</svg>`;
}

function renderDropdown() {
  const current = ITALY_REGIONS.find((r) => r.id === selectedId);
  document.getElementById('explore-dd-label').textContent = current.name;
  document.getElementById('explore-dd-list').innerHTML = MENU_REGIONS.map(
    (r) => `<div class="opt ${r.id === selectedId ? 'active' : ''}" data-id="${r.id}">${r.name}</div>`,
  ).join('');
}

function renderDetail() {
  const current = ITALY_REGIONS.find((r) => r.id === selectedId);
  const el = document.getElementById('explore-detail');
  if (!current.hasData) {
    el.innerHTML = `
      <h3 style="font-family:'Newsreader',serif; font-weight:500; font-size:18px; letter-spacing:-0.01em; margin:0 0 4px;">${current.name}</h3>
      <div class="explore-no-data">Dati in arrivo per questa regione.<br>Presto disponibili denominazioni, uve e stili.</div>`;
    return;
  }
  const wines = current.wines
    .map(
      (w) => `
      <div class="list-row">
        <span class="type-dot" style="background:${TYPE_COLOR[w.type]}"></span>
        <div class="lbody">
          <div class="lname">${w.name}</div>
          <div class="lsub">${w.appellation} &middot; ${TYPE_LABEL[w.type]}</div>
        </div>
      </div>`,
    )
    .join('');
  const grapes = current.grapes.map((g) => `<div class="chip">${g}</div>`).join('');
  const categories = current.categories
    .map(
      (c) => `
      <div class="type-row">
        <span class="type-dot" style="background:${TYPE_COLOR[c.type]}"></span>
        <span class="tname">${TYPE_LABEL[c.type]}</span>
        <div class="tbar"><i style="width:${c.pct}%; background:${TYPE_COLOR[c.type]}"></i></div>
        <span class="tn">${c.pct}%</span>
      </div>`,
    )
    .join('');
  el.innerHTML = `
    <h3 style="font-family:'Newsreader',serif; font-weight:500; font-size:18px; letter-spacing:-0.01em; margin:0 0 16px;">${current.name}</h3>
    <div class="chip-label">Vini pi&ugrave; famosi</div>
    <div style="margin-bottom:16px;">${wines}</div>
    <div class="chip-label">Uve principali</div>
    <div class="chips" style="margin:0 0 16px; overflow-x:visible; flex-wrap:wrap;">${grapes}</div>
    <div class="chip-label">Categorie</div>
    ${categories}`;
}

function selectRegion(id) {
  selectedId = id;
  closeDropdown();
  renderMap();
  renderDropdown();
  renderDetail();
}

function wireStaticControls() {
  document.getElementById('explore-back-btn')?.addEventListener('click', () => {
    window.location.hash = '#/home';
  });

  document.getElementById('explore-dd-head')?.addEventListener('click', () => {
    document.getElementById('explore-dd').classList.contains('open') ? closeDropdown() : openDropdown();
  });
  document.getElementById('explore-dd-list')?.addEventListener('click', (e) => {
    const opt = e.target.closest('[data-id]');
    if (opt) selectRegion(opt.dataset.id);
  });

  document.getElementById('explore-map')?.addEventListener('click', (e) => {
    const path = e.target.closest('path[data-id]');
    if (path) selectRegion(path.dataset.id);
  });

  // Only Italy has data today, so the sheet's other rows (.explore-country-soon)
  // are informational placeholders, not wired to anything.
  document.getElementById('explore-country-switch')?.addEventListener('click', () => {
    document.getElementById('explore-country-sheet').classList.add('open');
  });
  document.getElementById('explore-country-sheet-close')?.addEventListener('click', () => {
    document.getElementById('explore-country-sheet').classList.remove('open');
  });
  document.getElementById('explore-country-it')?.addEventListener('click', () => {
    document.getElementById('explore-country-sheet').classList.remove('open');
  });
}

wireStaticControls();

export async function mountExplore() {
  selectedId = MENU_REGIONS[0].id;
  closeDropdown();
  renderMap();
  renderDropdown();
  renderDetail();
}
