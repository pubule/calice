import { api } from '../api-client.js';
import { me } from '../auth.js';
import { escapeHtml, skeletonBar } from '../util.js';
import { navigate } from '../router.js';
import { eurosText } from '../fields.js';
import { drinkWindow, drinkStatus, drinkOrder, STATUS_LABEL } from '../drink-window.js';
import { openDetail } from './detail.js';

// Duplicated per-screen rather than shared, matching stats.js/explore.js —
// b.type is unvalidated API data, so an unrecognised key falls back to
// DEFAULT_COLOR instead of rendering as undefined.
const TYPE_COLOR = { rosso: '#5b2333', bianco: '#b9a750', bollicine: '#6b7a4f', rosato: '#a24a5a' };
const DEFAULT_COLOR = '#5b2333';

document.getElementById('home-explore-entry')?.addEventListener('click', () => navigate('#/esplora'));
document.getElementById('home-aromas-entry')?.addEventListener('click', () => navigate('#/aromi'));
document.getElementById('home-tasting-entry')?.addEventListener('click', () => navigate('#/assaggio'));

function selectHomeTab(tab) {
  document.querySelectorAll('#home-tabs button').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === tab);
    b.setAttribute('aria-pressed', String(b.dataset.tab === tab));
  });
  document.querySelectorAll('.home-tab-panel').forEach((p) => { p.classList.toggle('hidden', p.dataset.tabPanel !== tab); });
}

document.getElementById('home-tabs')?.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-tab]');
  if (btn) selectHomeTab(btn.dataset.tab);
});

function showLoadingSkeletons() {
  document.getElementById('home-stats').innerHTML = `
    <div class="stat">${skeletonBar('60%', 20)}</div>
    <div class="stat">${skeletonBar('60%', 20)}</div>
    <div class="stat">${skeletonBar('60%', 20)}</div>
  `;
  document.getElementById('home-soon').innerHTML = Array.from({ length: 3 }, () => `
    <div class="list-row">${skeletonBar('8px', 8)}<div class="lbody">${skeletonBar('70%', 12)}<div style="margin-top:4px;">${skeletonBar('45%', 9)}</div></div></div>`).join('');
  document.getElementById('home-regions').innerHTML = Array.from({ length: 3 }, () => `
    <div class="region-row">${skeletonBar('74px', 10)}${skeletonBar('100%', 8)}${skeletonBar('22px', 10)}</div>`).join('');
  document.getElementById('home-feed').innerHTML = Array.from({ length: 3 }, () => `
    <div class="feed-row"><div class="rev-avatar skeleton"></div>${skeletonBar('70%', 11)}</div>`).join('');
}

const PREVIEW_COUNT = 5;

// Holds the full lists so the "vedi tutte/tutto" links can expand in place
// without a re-fetch — reset on every mount, read only by the render*
// functions below.
let soonBottles = [];
let regionEntries = [];
let activityRows = [];
const expanded = { soon: false, regions: false, feed: false };

function toggleLink(id, key, count, expandLabel) {
  const link = document.getElementById(id);
  if (!link) return;
  // Empty link: keep it out of the tab order and the accessibility tree.
  link.setAttribute('tabindex', count <= PREVIEW_COUNT ? '-1' : '0');
  link.toggleAttribute('aria-hidden', count <= PREVIEW_COUNT);
  if (count <= PREVIEW_COUNT) {
    link.textContent = '';
    link.onclick = null;
    return;
  }
  link.setAttribute('aria-expanded', String(expanded[key]));
  link.textContent = expanded[key] ? 'mostra meno' : expandLabel;
  link.onclick = () => {
    expanded[key] = !expanded[key];
    renderAll();
  };
}

// "Da bere": every wine with its drinking window drawn as a bar (scelta B
// sui mockup): light = can drink, dark = best years, the tick = today. The
// most urgent first (see drinkOrder). A tap opens the wine's sheet.
function windowBar(w) {
  const now = new Date();
  const t = now.getFullYear() + now.getMonth() / 12;
  const start = Math.min(w.from, Math.floor(t));
  const end = Math.max(w.until + 1, Math.ceil(t) + 1);
  const pct = (y) => `${(((y - start) / (end - start)) * 100).toFixed(1)}%`;
  const width = (a, b) => `${(((b - a) / (end - start)) * 100).toFixed(1)}%`;
  const s = drinkStatus(w);
  const middle = s === 'young' ? `dal ${w.from} · al meglio ${w.peakFrom}–${w.peakUntil}` : STATUS_LABEL[s];
  return `
    <div class="win" aria-hidden="true"><i style="left:${pct(w.from)};width:${width(w.from, w.until + 1)}"></i><i class="peak" style="left:${pct(w.peakFrom)};width:${width(w.peakFrom, w.peakUntil + 1)}"></i><em style="left:${pct(t)}"></em></div>
    <div class="win-lbl"><span>${start}</span><span class="win-state ${s}">${middle}</span><span>${end - 1}</span></div>`;
}

function renderSoon() {
  const list = expanded.soon ? soonBottles : soonBottles.slice(0, PREVIEW_COUNT);
  document.getElementById('home-soon').innerHTML = list
    .map((b) => {
      const s = drinkStatus(b.window);
      const label = `${b.name}${b.vintage ? ' ' + b.vintage : ''}`;
      return `
      <div class="list-row drink-row" data-id="${b.id}">
        <span class="type-dot" style="background:${TYPE_COLOR[b.type] || DEFAULT_COLOR}"></span>
        <div class="lbody" role="button" tabindex="0" aria-label="${escapeHtml(`${label}, ${STATUS_LABEL[s]}, da bere dal ${b.window.from} al ${b.window.until}`)}">
          <div class="lname">${escapeHtml(label)}</div>
          ${windowBar(b.window)}
        </div>
      </div>`;
    })
    .join('') || '<div class="empty-note">Nessun vino in cantina.</div>';
  document.querySelectorAll('#home-soon .drink-row .lbody').forEach((el) => el.addEventListener('click', async () => {
    const b = soonBottles.find((x) => x.id === Number(el.closest('.drink-row').dataset.id));
    if (b) openDetail(b, await me());
  }));
  toggleLink('home-soon-toggle', 'soon', soonBottles.length, `vedi tutti (${soonBottles.length})`);
}

function renderRegions() {
  const maxRegion = Math.max(1, ...regionEntries.map(([, n]) => n));
  const list = expanded.regions ? regionEntries : regionEntries.slice(0, PREVIEW_COUNT);
  document.getElementById('home-regions').innerHTML = list
    .map(
      ([name, n]) => `
      <div class="region-row"><span class="rname">${escapeHtml(name)}</span>
        <div class="rbar"><i style="width:${(n / maxRegion) * 100}%"></i></div>
        <span class="rn">${n}</span></div>`,
    )
    .join('');
  toggleLink('home-regions-toggle', 'regions', regionEntries.length, 'vedi tutte');
}

function renderFeed() {
  const list = expanded.feed ? activityRows : activityRows.slice(0, PREVIEW_COUNT);
  document.getElementById('home-feed').innerHTML = list
    .map(
      (a) => `
      <div class="feed-row"><div class="rev-avatar">${escapeHtml(a.actor_name.slice(0, 2).toUpperCase())}</div>
        <div class="txt"><b>${escapeHtml(a.actor_name)}</b> ha aggiunto ${escapeHtml(a.wine_name)}</div>
        <span class="time">${new Date(a.created_at).toLocaleDateString('it-IT')}</span></div>`,
    )
    .join('');
  toggleLink('home-feed-toggle', 'feed', activityRows.length, 'vedi tutto');
}

function renderAll() {
  renderSoon();
  renderRegions();
  renderFeed();
}

const REVEAL_IDS = ['home-greet-name', 'home-stats', 'home-alerts', 'home-explore-links', 'home-tabs-block'];

// Called once, after every section's real content is already in the DOM
// (mountHome awaits everything via Promise.all first) — all sections fade in
// together, in the same animation frame, so the page reads as one thing
// becoming ready rather than pieces arriving one after another.
function revealSections() {
  const els = REVEAL_IDS.map((id) => document.getElementById(id)).filter(Boolean);
  els.forEach((el) => el.classList.remove('reveal-target', 'revealed'));
  // Force a style flush so the removal above lands in its own frame instead
  // of being coalesced with the class added right below — otherwise the
  // browser can skip straight to the end state and the transition never runs.
  void document.body.offsetHeight;
  els.forEach((el) => el.classList.add('reveal-target'));
  requestAnimationFrame(() => els.forEach((el) => el.classList.add('revealed')));
}

export async function mountHome() {
  selectHomeTab('soon');
  showLoadingSkeletons();

  // All four sources fetched in parallel (was four sequential awaits) so
  // every section becomes ready at the same instant — the only staggering
  // left is the deliberate one in revealSections() below.
  const [user, bottles, activity] = await Promise.all([
    me(),
    api.get('/api/cellars').then((cellars) =>
      // quantity/price_paid come from the API as unvalidated JSON (no
      // backend schema check) — coerce to Number here so a malicious
      // non-numeric string can't survive into arithmetic (string
      // concatenation) and then into the unescaped stat/banner HTML below.
      api.get(`/api/cellars/${cellars[0].id}/bottles`).then((rows) => rows.map((b) => ({
        ...b,
        quantity: Number(b.quantity) || 0,
        price_paid: b.price_paid != null ? Number(b.price_paid) || 0 : null,
      }))),
    ),
    api.get('/api/me/activity'),
  ]);

  document.getElementById('home-greet-name').textContent = user.name;

  const totalBottles = bottles.reduce((n, b) => n + b.quantity, 0);
  const totalValue = bottles.reduce((n, b) => n + (b.price_paid || 0) * b.quantity, 0);
  // Every wine still in the cellar, with its drinking window; "da bere"
  // counts those that are not too young.
  const inCellar = bottles.filter((b) => b.quantity > 0).map((b) => ({ ...b, window: drinkWindow(b) })).sort(drinkOrder);
  const ready = inCellar.filter((b) => drinkStatus(b.window) !== 'young');
  const urgent = inCellar.filter((b) => ['soon', 'past'].includes(drinkStatus(b.window)));

  document.getElementById('home-stats').innerHTML = `
    <div class="stat"><div class="num">${totalBottles}</div><div class="lbl">bottiglie</div></div>
    <div class="stat"><div class="num">${eurosText(totalValue)}</div><div class="lbl">valore</div></div>
    <div class="stat"><div class="num">${ready.length}</div><div class="lbl">da bere</div></div>
  `;

  const byRegion = {};
  for (const b of bottles) {
    const key = b.region || b.country;
    byRegion[key] = (byRegion[key] || 0) + b.quantity;
  }

  soonBottles = inCellar;
  regionEntries = Object.entries(byRegion).sort((a, b) => b[1] - a[1]);
  activityRows = activity;
  expanded.soon = false;
  expanded.regions = false;
  expanded.feed = false;
  renderAll();

  document.getElementById('home-alerts').innerHTML = ''; // populated below, one banner per condition
  const lowStock = bottles.find((b) => b.quantity <= 2);
  const banners = [];
  if (urgent.length) banners.push(`<div class="alert-banner"><div class="txt"><b>Da bere presto</b>${urgent.length === 1 ? `${escapeHtml(urgent[0].name)} è alla fine della sua finestra` : `${urgent.length} vini sono alla fine della loro finestra`}</div><div class="alert-dismiss" role="button" tabindex="0" aria-label="Chiudi avviso">&times;</div></div>`);
  if (lowStock) banners.push(`<div class="alert-banner"><div class="txt"><b>Scorte in esaurimento</b>${escapeHtml(lowStock.name)}: ${lowStock.quantity === 1 ? 'resta 1 bottiglia' : `restano ${lowStock.quantity} bottiglie`}</div><div class="alert-dismiss" role="button" tabindex="0" aria-label="Chiudi avviso">&times;</div></div>`);
  document.getElementById('home-alerts').innerHTML = banners.join('');
  document.querySelectorAll('#home-alerts .alert-dismiss').forEach((btn) => {
    btn.addEventListener('click', () => btn.closest('.alert-banner').remove());
  });

  revealSections();
}
