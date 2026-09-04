import { api } from '../api-client.js';
import { me } from '../auth.js';
import { escapeHtml, photoClass } from '../util.js';

function scoreBadge(score) {
  return score == null ? '' : `<span class="badge-score">${score.toFixed(1)}</span>`;
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
  if (count <= PREVIEW_COUNT) {
    link.textContent = '';
    link.onclick = null;
    return;
  }
  link.textContent = expanded[key] ? 'mostra meno' : expandLabel;
  link.onclick = () => {
    expanded[key] = !expanded[key];
    renderAll();
  };
}

function renderSoon() {
  const list = expanded.soon ? soonBottles : soonBottles.slice(0, PREVIEW_COUNT);
  document.getElementById('home-soon').innerHTML = list
    .map(
      (b) => `
      <div class="wine-card">
        <div class="card-photo photo ${photoClass(b.type)}">${scoreBadge(b.score)}</div>
        <div class="card-body">
          <div class="name">${escapeHtml(b.name)}</div>
          <div class="sub">${escapeHtml(b.producer)} · ${escapeHtml(b.vintage ?? '')} · ${escapeHtml(b.region ?? b.country)}</div>
          <span class="status-tag ready">pronto</span>
        </div>
      </div>`,
    )
    .join('');
  toggleLink('home-soon-toggle', 'soon', soonBottles.length, 'vedi tutte');
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

export async function mountHome() {
  const user = await me();
  document.getElementById('home-greet-name').textContent = user.name;

  const cellars = await api.get('/api/cellars');
  const cellar = cellars[0];
  // quantity/price_paid come from the API as unvalidated JSON (no backend
  // schema check) — coerce to Number here so a malicious non-numeric string
  // can't survive into arithmetic (string concatenation) and then into the
  // unescaped stat/banner HTML below.
  const bottles = (await api.get(`/api/cellars/${cellar.id}/bottles`)).map((b) => ({
    ...b,
    quantity: Number(b.quantity) || 0,
    price_paid: b.price_paid != null ? Number(b.price_paid) || 0 : null,
  }));
  const activity = await api.get('/api/me/activity');

  const totalBottles = bottles.reduce((n, b) => n + b.quantity, 0);
  const totalValue = bottles.reduce((n, b) => n + (b.price_paid || 0) * b.quantity, 0);
  const today = new Date().toISOString().slice(0, 10);
  const soon = bottles.filter((b) => b.drink_until && b.drink_from <= today && today <= b.drink_until);

  document.getElementById('home-stats').innerHTML = `
    <div class="stat"><div class="num">${totalBottles}</div><div class="lbl">bottiglie</div></div>
    <div class="stat"><div class="num">€${totalValue.toFixed(0)}</div><div class="lbl">valore</div></div>
    <div class="stat"><div class="num">${soon.length}</div><div class="lbl">da bere</div></div>
  `;

  const byRegion = {};
  for (const b of bottles) {
    const key = b.region || b.country;
    byRegion[key] = (byRegion[key] || 0) + b.quantity;
  }

  soonBottles = soon;
  regionEntries = Object.entries(byRegion).sort((a, b) => b[1] - a[1]);
  activityRows = activity;
  expanded.soon = false;
  expanded.regions = false;
  expanded.feed = false;
  renderAll();

  document.getElementById('home-alerts').innerHTML = ''; // populated below, one banner per condition
  const lowStock = bottles.find((b) => b.quantity <= 2);
  const banners = [];
  if (soon.length) banners.push(`<div class="alert-banner"><div class="txt"><b>Hai vini pronti da bere</b>${soon.length} bottiglie nella finestra di consumo</div><div class="alert-dismiss">&times;</div></div>`);
  if (lowStock) banners.push(`<div class="alert-banner"><div class="txt"><b>Scorte in esaurimento</b>${escapeHtml(lowStock.name)}: restano ${lowStock.quantity} bottiglie</div><div class="alert-dismiss">&times;</div></div>`);
  document.getElementById('home-alerts').innerHTML = banners.join('');
  document.querySelectorAll('#home-alerts .alert-dismiss').forEach((btn) => {
    btn.addEventListener('click', () => btn.closest('.alert-banner').remove());
  });
}
