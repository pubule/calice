import { api } from '../api-client.js';
import { escapeHtml } from '../util.js';

const WINE_TYPES = ['rosso', 'bianco', 'bollicine', 'rosato'];

function scoreBadge(score) {
  return score == null ? '' : `<span class="badge-score">${score.toFixed(1)}</span>`;
}

function photoClass(type) {
  return WINE_TYPES.includes(type) ? `photo-${type}` : 'photo-rosso';
}

export async function mountHome() {
  const cellars = await api.get('/api/cellars');
  const cellar = cellars[0];
  const bottles = await api.get(`/api/cellars/${cellar.id}/bottles`);
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

  document.getElementById('home-soon').innerHTML = soon
    .slice(0, 5)
    .map(
      (b) => `
      <div class="wine-card">
        <div class="card-photo photo ${photoClass(b.type)}">${scoreBadge(b.score)}</div>
        <div class="card-body">
          <div class="name">${escapeHtml(b.name)}</div>
          <div class="sub">${escapeHtml(b.producer)} · ${b.vintage ?? ''} · ${escapeHtml(b.region ?? b.country)}</div>
          <span class="status-tag ready">pronto</span>
        </div>
      </div>`,
    )
    .join('');

  const byRegion = {};
  for (const b of bottles) {
    const key = b.region || b.country;
    byRegion[key] = (byRegion[key] || 0) + b.quantity;
  }
  const maxRegion = Math.max(1, ...Object.values(byRegion));
  document.getElementById('home-regions').innerHTML = Object.entries(byRegion)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(
      ([name, n]) => `
      <div class="region-row"><span class="rname">${escapeHtml(name)}</span>
        <div class="rbar"><i style="width:${(n / maxRegion) * 100}%"></i></div>
        <span class="rn">${n}</span></div>`,
    )
    .join('');

  document.getElementById('home-feed').innerHTML = activity
    .slice(0, 5)
    .map(
      (a) => `
      <div class="feed-row"><div class="rev-avatar">${escapeHtml(a.actor_name.slice(0, 2).toUpperCase())}</div>
        <div class="txt"><b>${escapeHtml(a.actor_name)}</b> ha aggiunto ${escapeHtml(a.wine_name)}</div>
        <span class="time">${new Date(a.created_at).toLocaleDateString('it-IT')}</span></div>`,
    )
    .join('');

  document.getElementById('home-alerts').innerHTML = ''; // populated below, one banner per condition
  const lowStock = bottles.find((b) => b.quantity <= 2);
  const banners = [];
  if (soon.length) banners.push(`<div class="alert-banner"><div class="txt"><b>Hai vini pronti da bere</b>${soon.length} bottiglie nella finestra di consumo</div></div>`);
  if (lowStock) banners.push(`<div class="alert-banner"><div class="txt"><b>Scorte in esaurimento</b>${escapeHtml(lowStock.name)}: restano ${lowStock.quantity} bottiglie</div></div>`);
  document.getElementById('home-alerts').innerHTML = banners.join('');
}
