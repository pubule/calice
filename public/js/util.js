export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const WINE_TYPES = ['rosso', 'bianco', 'bollicine', 'rosato'];

export function photoClass(type) {
  return WINE_TYPES.includes(type) ? `photo-${type}` : 'photo-rosso';
}
