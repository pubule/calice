export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const WINE_TYPES = ['rosso', 'bianco', 'bollicine', 'rosato'];

export function photoClass(type) {
  return WINE_TYPES.includes(type) ? `photo-${type}` : 'photo-rosso';
}

// One shimmering placeholder bar, sized to approximate the real content it
// stands in for — combine a few of these to build a skeleton for a given
// section's real layout (see .skeleton in app.css for the shimmer itself).
export function skeletonBar(width = '100%', height = 12) {
  return `<div class="skeleton" style="width:${width}; height:${height}px; border-radius:6px;"></div>`;
}

// Prices always with two decimals, Italian style: "26,00". `grouping:false`
// for a value put back into an input field (readDecimal() would read the
// thousands dot "1.200" as 1.2). null/invalid → ''.
export function priceText(n, { grouping = true } = {}) {
  const v = Number(n);
  if (n == null || n === '' || !Number.isFinite(v)) return '';
  return v.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: grouping });
}
