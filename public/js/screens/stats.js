import { api } from '../api-client.js';
import { escapeHtml } from '../util.js';

const TYPE_LABEL = { rosso: 'Rosso', bianco: 'Bianco', bollicine: 'Bollicine', rosato: 'Rosato' };
const TYPE_COLOR = { rosso: '#5b2333', bianco: '#b9a750', bollicine: '#6b7a4f', rosato: '#a24a5a' };
const DEFAULT_COLOR = '#5b2333';

function groupBy(bottles, keyFn) {
  const map = {};
  for (const b of bottles) {
    const key = keyFn(b) || 'Sconosciuto';
    map[key] = (map[key] || 0) + b.quantity;
  }
  return map;
}

// Region/country names are attacker-controllable (backend has no
// validation), so they're escaped here — group-by keys are exactly the kind
// of thing that gets missed.
function barRows(map) {
  const total = Object.values(map).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .map(
      ([name, n]) => `
      <div class="region-row"><span class="rname">${escapeHtml(name)}</span>
        <div class="rbar"><i style="width:${(n / total) * 100}%"></i></div>
        <span class="rn">${n}</span></div>`,
    )
    .join('');
}

// Grouped by the raw type key (not the label) so an unrecognised/attacker
// -controlled b.type can't smuggle itself past TYPE_LABEL's fixed lookup;
// TYPE_COLOR/TYPE_LABEL fall back to safe defaults and the raw key is only
// ever rendered through escapeHtml.
function typeRows(bottles) {
  const map = groupBy(bottles, (b) => b.type);
  const total = Object.values(map).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .map(([key, n]) => {
      const label = TYPE_LABEL[key] || key;
      const color = TYPE_COLOR[key] || DEFAULT_COLOR;
      const pct = Math.round((n / total) * 100);
      return `
      <div class="type-row"><span class="type-dot" style="background:${color}"></span><span class="tname">${escapeHtml(label)}</span>
        <div class="tbar"><i style="width:${pct}%; background:${color}"></i></div><span class="tn">${pct}%</span></div>`;
    })
    .join('');
}

export async function mountStats() {
  const cellars = await api.get('/api/cellars');
  const raw = await api.get(`/api/cellars/${cellars[0].id}/bottles`);
  // quantity/price_paid/vintage come from the API as unvalidated JSON (no
  // backend schema check) — coerce to Number here so a malicious non-numeric
  // string can't survive into arithmetic (string concatenation) or leak into
  // the stat HTML below unescaped.
  const bottles = raw.map((b) => ({
    ...b,
    quantity: Number(b.quantity) || 0,
    price_paid: b.price_paid != null ? Number(b.price_paid) || 0 : null,
    vintage: b.vintage != null && Number.isFinite(Number(b.vintage)) ? Number(b.vintage) : null,
  }));

  const total = bottles.reduce((n, b) => n + b.quantity, 0);
  const value = bottles.reduce((n, b) => n + (b.price_paid || 0) * b.quantity, 0);
  const vintages = bottles.filter((b) => b.vintage).map((b) => b.vintage);
  const avgVintage = vintages.length ? Math.round(vintages.reduce((a, b) => a + b, 0) / vintages.length) : '—';

  document.getElementById('stats-summary').innerHTML = `
    <div class="stat"><div class="num">${total}</div><div class="lbl">bottiglie</div></div>
    <div class="stat"><div class="num">€${value.toFixed(0)}</div><div class="lbl">valore</div></div>
    <div class="stat"><div class="num">${avgVintage}</div><div class="lbl">annata media</div></div>
  `;

  document.getElementById('stats-type').innerHTML = typeRows(bottles);
  document.getElementById('stats-country').innerHTML = barRows(groupBy(bottles, (b) => b.country));
  document.getElementById('stats-region').innerHTML = barRows(groupBy(bottles, (b) => b.region || b.country));
}
