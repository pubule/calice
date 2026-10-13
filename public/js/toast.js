// Brief feedback banner with an optional action (e.g. "Annulla" after a
// removal). One toast at a time: a new call replaces whatever is showing.
// The element is built once and lives inside .screen, the app's fixed root,
// so it shares the same viewport box as the tab bar it sits above.

let el = null;
let hideTimer = null;

function ensureEl() {
  if (el) return el;
  el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.innerHTML = '<span class="toast-msg"></span><button type="button" class="toast-action"></button>';
  document.querySelector('.screen').appendChild(el);
  return el;
}

function hide() {
  clearTimeout(hideTimer);
  el?.classList.remove('show');
}

export function showToast(message, { actionLabel, onAction, duration = 5000 } = {}) {
  const t = ensureEl();
  const btn = t.querySelector('.toast-action');
  t.querySelector('.toast-msg').textContent = message;
  btn.textContent = actionLabel ?? '';
  btn.classList.toggle('hidden', !actionLabel);
  // Sit just above the tab bar. Measured each time: its height can change
  // (e.g. when the keyboard hides it, offsetHeight becomes 0 and we fall back).
  const navH = document.querySelector('.navbar')?.offsetHeight || 64;
  t.style.bottom = `${navH + 12}px`;
  // Re-assigning onclick drops the previous toast's handler, so a stale
  // action can never fire for the toast that replaced it.
  btn.onclick = () => {
    hide();
    onAction?.();
  };
  t.classList.add('show');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hide, duration);
}
