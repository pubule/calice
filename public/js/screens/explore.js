import { COUNTRIES } from '../data/wine-atlas.js';

const TYPE_COLOR = { rosso: '#5b2333', bianco: '#b9a750', bollicine: '#6b7a4f', rosato: '#a24a5a' };
const TYPE_LABEL = { rosso: 'Rosso', bianco: 'Bianco', bollicine: 'Bollicine', rosato: 'Rosato' };

// Berry/vinification color for every grape used across wine-atlas.js — not
// legally contentious like DOC/DOCG status (which changes over time), just
// ampelography, so classified directly rather than web-verified. Pink-skinned
// grapes conventionally vinified white (Gewürztraminer, Pinot Gris/Grigio,
// Malvasia) are "bianco" here, matching how wines made from them are already
// typed elsewhere in this dataset.
const GRAPE_COLOR = {
  Aglianico: 'rosso', Airén: 'bianco', Albana: 'bianco', Albariño: 'bianco', Albarola: 'bianco',
  Albillo: 'bianco', Alfrocheiro: 'rosso', 'Alicante Bouschet': 'rosso', Aligoté: 'bianco',
  Altesse: 'bianco', Ansonica: 'bianco', Arinto: 'bianco', Bacchus: 'bianco', Baga: 'rosso',
  Barbera: 'rosso', Bianchello: 'bianco', 'Bianchetta Genovese': 'bianco',
  "Bianco d'Alessano": 'bianco', Biancolella: 'bianco', 'Blanc du Bois': 'bianco', Bobal: 'rosso',
  'Bombino Bianco': 'bianco', Bosco: 'bianco', Bovale: 'rosso', Braquet: 'rosso', Braucol: 'rosso',
  'Cabernet Franc': 'rosso', 'Cabernet Sauvignon': 'rosso', Canaiolo: 'rosso', Cannonau: 'rosso',
  Carignan: 'rosso', Carignano: 'rosso', Cariñena: 'rosso', Carménère: 'rosso',
  Carricante: 'bianco', Castelão: 'rosso', Cesanese: 'rosso', Chambourcin: 'rosso',
  Chardonnay: 'bianco', Chasselas: 'bianco', 'Chenin Blanc': 'bianco', Ciliegiolo: 'rosso',
  Cinsault: 'rosso', Clairette: 'bianco', 'Coda di Volpe': 'bianco', Cortese: 'bianco',
  Corvina: 'rosso', Corvinone: 'rosso', Croatina: 'rosso', Dolcetto: 'rosso',
  'Doña Blanca': 'bianco', Duras: 'rosso', Erbaluce: 'bianco', Fiano: 'bianco',
  'Folle Noire': 'rosso', Fortana: 'rosso', Francavilla: 'bianco', Frappato: 'rosso',
  Freisa: 'rosso', Friulano: 'bianco', Fumin: 'rosso', Gaglioppo: 'rosso', Gamay: 'rosso',
  Garganega: 'bianco', Garnacha: 'rosso', 'Garnacha Blanca': 'bianco',
  'Garnacha Tintorera': 'rosso', Gewürztraminer: 'bianco', Glera: 'bianco', Godello: 'bianco',
  Goldriesling: 'bianco', Graciano: 'rosso', Grauburgunder: 'bianco', Grechetto: 'bianco',
  Greco: 'bianco', 'Greco Bianco': 'bianco', 'Greco Nero': 'rosso', Grenache: 'rosso',
  Grillo: 'bianco', Groppello: 'rosso', Gutedel: 'bianco', 'Hondarrabi Beltza': 'rosso',
  'Hondarrabi Zuri': 'bianco', Impigno: 'bianco', Jacquère: 'bianco', Jaen: 'rosso',
  'Juan García': 'rosso', Lacrima: 'rosso', Lagrein: 'rosso', Lambrusco: 'rosso',
  Lemberger: 'rosso', Loureiro: 'bianco', Macabeo: 'bianco', Maceratino: 'bianco',
  Magliocco: 'rosso', Malbec: 'rosso', Malvar: 'bianco', Malvasia: 'bianco',
  'Malvasia Nera': 'rosso', Marsanne: 'bianco', Marzemino: 'rosso', Mauzac: 'bianco',
  Mazuelo: 'rosso', 'Melon de Bourgogne': 'bianco', Mencía: 'rosso', Merlot: 'rosso',
  Merseguera: 'bianco', Molinara: 'rosso', Monastrell: 'rosso', Monica: 'rosso',
  Montepulciano: 'rosso', Moscatel: 'bianco', Moscato: 'bianco', 'Moscato Giallo': 'bianco',
  Mourvèdre: 'rosso', 'Müller-Thurgau': 'bianco', Muscadelle: 'bianco', Nebbiolo: 'rosso',
  Négrette: 'rosso', Negroamaro: 'rosso', 'Nerello Cappuccio': 'rosso',
  'Nerello Mascalese': 'rosso', 'Nero Buono': 'rosso', "Nero d'Avola": 'rosso',
  'Nero di Troia': 'rosso', Nielluccio: 'rosso', Nocera: 'rosso', Norton: 'rosso',
  Nosiola: 'bianco', Nuragus: 'bianco', Palomino: 'bianco', Parellada: 'bianco',
  Passerina: 'bianco', Pecorino: 'bianco', 'Pedro Ximénez': 'bianco', Pepella: 'bianco',
  Perricone: 'rosso', 'Petit Rouge': 'rosso', 'Petit Verdot': 'rosso', Picolit: 'bianco',
  Picpoul: 'bianco', Piedirosso: 'rosso', Pigato: 'bianco', Pignoletto: 'bianco',
  'Pinot Blanc': 'bianco', 'Pinot Gris': 'bianco', 'Pinot Meunier': 'rosso', 'Pinot Nero': 'rosso',
  'Pinot Noir': 'rosso', Pinotage: 'rosso', Prëmetta: 'rosso', 'Prié Blanc': 'bianco',
  'Prieto Picudo': 'rosso', Primitivo: 'rosso', Ramisco: 'rosso', Refosco: 'rosso',
  'Ribolla Gialla': 'bianco', Riesling: 'bianco', Rondinella: 'rosso', Rossese: 'rosso',
  Rufete: 'rosso', Sagrantino: 'rosso', Sangiovese: 'rosso', 'Sauvignon Blanc': 'bianco',
  Savagnin: 'bianco', Schiava: 'rosso', Schioppettino: 'rosso', Sciaccarellu: 'rosso',
  Semillon: 'bianco', Sémillon: 'bianco', 'Seyval Blanc': 'bianco', Shiraz: 'rosso',
  Silvaner: 'bianco', Spätburgunder: 'rosso', Sumoll: 'rosso', Syrah: 'rosso', Tannat: 'rosso',
  Tempranillo: 'rosso', Teroldego: 'rosso', 'Tinta Negra': 'rosso', 'Tinta Roriz': 'rosso',
  Tintilia: 'rosso', Torrontés: 'bianco', 'Touriga Franca': 'rosso', 'Touriga Nacional': 'rosso',
  Trajadura: 'bianco', Trebbiano: 'bianco', Treixadura: 'bianco', Trepat: 'rosso',
  Trincadeira: 'rosso', Trollinger: 'rosso', Turbiana: 'bianco', 'Ugni Blanc': 'bianco',
  Verdeca: 'bianco', Verdejo: 'bianco', Verdelho: 'bianco', Verdicchio: 'bianco',
  Verduzzo: 'bianco', Vermentino: 'bianco', Vernaccia: 'bianco', 'Vernaccia Nera': 'rosso',
  'Vidal Blanc': 'bianco', 'Vien de Nus': 'rosso', Viognier: 'bianco', Viura: 'bianco',
  Weißburgunder: 'bianco', 'Xarel·lo': 'bianco', Zalema: 'bianco', Zinfandel: 'rosso',
};
const DEFAULT_GRAPE_COLOR = 'rosso';

let countryId = 'it';
let regionId = null; // per-country selected region, reset on country switch

function currentCountry() {
  return COUNTRIES.find((c) => c.id === countryId) || COUNTRIES[0];
}
function menuRegions(country) {
  return country.hasMap ? country.regions.filter((r) => r.hasData) : [];
}

function openDropdown() {
  document.getElementById('explore-dd').classList.add('open');
}
function closeDropdown() {
  document.getElementById('explore-dd').classList.remove('open');
}
function openCountrySheet() {
  renderCountryRows();
  document.getElementById('explore-country-sheet').classList.add('open');
}
function closeCountrySheet() {
  document.getElementById('explore-country-sheet').classList.remove('open');
}

function renderMap(country) {
  const el = document.getElementById('explore-map');
  if (!country.hasMap) {
    el.style.display = 'none';
    document.querySelector('.explore-map-credit').style.display = 'none';
    return;
  }
  el.style.display = '';
  document.querySelector('.explore-map-credit').style.display = '';
  const svg = country.regions
    .map((r) => {
      const active = r.id === regionId;
      const fill = active ? '#5b2333' : r.hasData ? '#d9a9b3' : '#e5e1d4';
      return `<path data-id="${r.id}" d="${r.d}" fill="${fill}" stroke="#ffffff" stroke-width="1.3" stroke-linejoin="round"/>`;
    })
    .join('');
  el.innerHTML = `<svg viewBox="${country.viewBox}">${svg}</svg>`;
}

function renderDropdownAndHint(country) {
  const dd = document.getElementById('explore-dd');
  const hint = document.getElementById('explore-hint');
  if (!country.hasMap) {
    dd.style.display = 'none';
    hint.style.display = 'none';
    return;
  }
  dd.style.display = '';
  hint.style.display = '';
  const menu = menuRegions(country);
  const current = country.regions.find((r) => r.id === regionId);
  document.getElementById('explore-dd-label').textContent = current ? current.name : '…';
  document.getElementById('explore-dd-list').innerHTML = menu
    .map((r) => `<div class="opt ${r.id === regionId ? 'active' : ''}" data-id="${r.id}">${r.name}</div>`)
    .join('');
}

// Wines and grapes used to be separate tabs (a wine list, and a flat list of
// the region's 3 principal grapes with no link back to which wine used
// which). Merged on request: each wine row now expands in place to show its
// own grape composition, so "Uve" as a standalone tab is gone — the
// region/country-level `grapes` field this used to read is unused now.
function detailTemplate(name, wines, categories) {
  const winesHtml = wines
    .map((w, i) => {
      const grapesHtml = (w.grapes || [])
        .map(
          (g) => `
        <span class="grape-chip"><i class="dot" style="background:${TYPE_COLOR[GRAPE_COLOR[g] || DEFAULT_GRAPE_COLOR]}"></i>${g}</span>`,
        )
        .join('');
      return `
      <div class="wine-item">
        <div class="list-row wine-row" data-idx="${i}">
          <span class="type-dot" style="background:${TYPE_COLOR[w.type]}"></span>
          <div class="lbody">
            <div class="lname">${w.name}</div>
            <div class="lsub">${w.appellation} &middot; ${TYPE_LABEL[w.type]}</div>
          </div>
          <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
        </div>
        <div class="wine-grapes" data-idx="${i}">${grapesHtml || '<span class="grape-chip muted">Composizione non disponibile</span>'}</div>
      </div>`;
    })
    .join('');
  const categoriesHtml = categories
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
  return `
    <h3 style="font-family:'Newsreader',serif; font-weight:500; font-size:18px; letter-spacing:-0.01em; margin:0 0 16px;">${name}</h3>
    <div class="segmented">
      <button class="active" data-tab="wines">Vini</button>
      <button data-tab="categories">Categorie</button>
    </div>
    <div class="explore-tab-panel" data-tab-panel="wines">${winesHtml}</div>
    <div class="explore-tab-panel hidden" data-tab-panel="categories">${categoriesHtml}</div>`;
}

// The detail card's innerHTML (tabs included) is replaced wholesale on every
// region/country switch, so the tabs and the wine-row expanders are wired
// once via delegation on the never-replaced #explore-detail container, not
// per-render.
function selectDetailTab(tab) {
  const detail = document.getElementById('explore-detail');
  detail.querySelectorAll('.segmented button[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  detail.querySelectorAll('.explore-tab-panel').forEach((p) => p.classList.toggle('hidden', p.dataset.tabPanel !== tab));
}

function toggleWineGrapes(idx) {
  const detail = document.getElementById('explore-detail');
  const row = detail.querySelector(`.wine-row[data-idx="${idx}"]`);
  const panel = detail.querySelector(`.wine-grapes[data-idx="${idx}"]`);
  if (!row || !panel) return;
  const open = panel.classList.toggle('open');
  row.classList.toggle('open', open);
}

function renderDetail(country) {
  const el = document.getElementById('explore-detail');
  if (!country.hasMap) {
    el.innerHTML = detailTemplate(country.name, country.national.wines, country.national.categories);
    return;
  }
  const current = country.regions.find((r) => r.id === regionId);
  if (!current) {
    el.innerHTML = '';
    return;
  }
  if (!current.hasData) {
    el.innerHTML = `
      <h3 style="font-family:'Newsreader',serif; font-weight:500; font-size:18px; letter-spacing:-0.01em; margin:0 0 4px;">${current.name}</h3>
      <div class="explore-no-data">Dati in arrivo per questa regione.<br>Presto disponibili denominazioni, uve e stili.</div>`;
    return;
  }
  el.innerHTML = detailTemplate(current.name, current.wines, current.categories);
}

function renderCountryRows() {
  document.getElementById('explore-country-rows').innerHTML = COUNTRIES.map(
    (c) => `
    <div class="list-row ${c.id === countryId ? 'active' : ''}" data-country="${c.id}">
      <div class="radio"></div>
      <div class="lbody"><div class="lname">${c.name}</div></div>
    </div>`,
  ).join('');
}

function renderAll() {
  const country = currentCountry();
  document.getElementById('explore-country-name').textContent = country.name;
  renderMap(country);
  renderDropdownAndHint(country);
  renderDetail(country);
}

function selectRegion(id) {
  regionId = id;
  closeDropdown();
  renderAll();
}

function selectCountry(id) {
  if (id === countryId) {
    closeCountrySheet();
    return;
  }
  countryId = id;
  const country = currentCountry();
  regionId = country.hasMap ? menuRegions(country)[0]?.id ?? null : null;
  closeCountrySheet();
  renderAll();
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

  document.getElementById('explore-detail')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.segmented button[data-tab]');
    if (btn) { selectDetailTab(btn.dataset.tab); return; }
    const row = e.target.closest('.wine-row[data-idx]');
    if (row) toggleWineGrapes(row.dataset.idx);
  });

  document.getElementById('explore-country-switch')?.addEventListener('click', openCountrySheet);
  document.getElementById('explore-country-sheet-close')?.addEventListener('click', closeCountrySheet);
  document.getElementById('explore-country-rows')?.addEventListener('click', (e) => {
    const row = e.target.closest('[data-country]');
    if (row) selectCountry(row.dataset.country);
  });
}

wireStaticControls();

export async function mountExplore() {
  countryId = 'it';
  const country = currentCountry();
  regionId = menuRegions(country)[0]?.id ?? null;
  closeDropdown();
  closeCountrySheet();
  renderAll();
}
