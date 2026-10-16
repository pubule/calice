import { escapeHtml } from './util.js';
import { FLAVOR_CATEGORIES, TASTE_AXES } from './tasting-profile.js';
import { TAG_WINES, WINE_TYPES, WINE_STYLES } from './data/aroma-guide.js';

// What to expect from a wine of the aroma wheel (WINE_STYLES): its typical
// aromas and its palate. Shared by the wheel's wine filter (aromas.js) and the
// guided tasting (tasting.js), so both say the same thing about a wine.

const WINE_NAMES = Object.keys(WINE_STYLES).sort((a, b) => a.localeCompare(b, 'it'));

export function expectedTags(wine) {
  return Object.keys(TAG_WINES).filter((t) => TAG_WINES[t].includes(wine));
}

// Expected value per axis in TASTE_AXES order; null where the axis does not
// apply (tannin 0 = whites and sparkling).
export function expectedTaste(wine) {
  const taste = WINE_STYLES[wine]?.taste ?? [];
  return TASTE_AXES.map((axis, i) => (axis.id === 'tannin' && taste[i] === 0 ? null : taste[i] ?? null));
}

export function typeOptionsHtml(placeholder) {
  return `<option value="">${escapeHtml(placeholder)}</option>` +
    WINE_TYPES.map(([id, label]) => {
      const n = WINE_NAMES.filter((w) => WINE_STYLES[w].type === id).length;
      return `<option value="${id}">${escapeHtml(label)} (${n})</option>`;
    }).join('');
}

export function wineOptionsHtml(type, placeholder) {
  const names = WINE_NAMES.filter((w) => !type || WINE_STYLES[w].type === type);
  return `<option value="">${escapeHtml(placeholder)} (${names.length})</option>` +
    names.map((w) => `<option value="${escapeHtml(w)}">${escapeHtml(w)}</option>`).join('');
}

// Expected palate as compact read-only bars plus the typical aromas grouped
// by family, as plain labels. `mine` (aroma → times, from /api/me/palate)
// marks those already in the user's notes or tastings.
export function expectationHtml(wine, { mine = {} } = {}) {
  const taste = expectedTaste(wine);
  const bars = TASTE_AXES.map((axis, i) => {
    const v = taste[i];
    const side = v == null ? 'non pertinente' : v < 40 ? axis.left : v > 60 ? axis.right : 'equilibrato';
    return `<div class="expect-row"><span class="expect-name">${escapeHtml(axis.name)}</span>
      <span class="expect-track">${v == null ? '' : `<i style="left:${v}%"></i>`}</span>
      <span class="expect-side">${escapeHtml(side)}</span></div>`;
  }).join('');
  const tags = expectedTags(wine);
  const known = tags.filter((t) => mine[t]).length;
  const groups = FLAVOR_CATEGORIES.map((f) => [f, tags.filter((t) => f.tags.includes(t))]).filter(([, ts]) => ts.length);
  return `
    <span class="aroma-pill" style="background:#f4e8eb;color:#5b2333">Cosa aspettarti</span>
    <div class="aroma-card-title">${escapeHtml(wine)}</div>
    <div class="field-label">Gusto</div>
    <div class="expect-bars">${bars}</div>
    <div class="expect-head"><span class="field-label">Aromi tipici</span><span class="expect-known">${known ? `<i class="mine-dot" aria-hidden="true"></i>${known} su ${tags.length} già nelle tue note` : 'Nessuno ancora nelle tue note'}</span></div>
    ${groups.map(([f, ts]) => `
      <div class="expect-group">
        <span class="expect-fam" style="color:${f.fg}">${escapeHtml(f.label)}</span>
        <div class="chip-row">${ts.map((t) => `<span class="chip expect-chip${mine[t] ? ' mine' : ''}">${escapeHtml(t)}${mine[t] ? '<i class="mine-dot" aria-label="già nelle tue note"></i>' : ''}</span>`).join('')}</div>
      </div>`).join('')}`;
}
