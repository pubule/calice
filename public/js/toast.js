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
  // Without an action the pill is text only and needs equal padding on both
  // sides (the asymmetric default leaves room for the button's own padding).
  t.classList.toggle('has-action', !!actionLabel);
  // Sit just above the highest point of the tab bar — the raised "+" circle
  // pokes above the bar itself, and the toast is centred right over it.
  // Measured each time: the keyboard can hide the bar (no layout box → 64px
  // fallback).
  const nav = document.querySelector('.navbar');
  const navH = nav?.offsetHeight || 64;
  const circle = document.querySelector('.nav-add-circle');
  const raised = nav?.offsetHeight && circle
    ? Math.max(0, nav.getBoundingClientRect().top - circle.getBoundingClientRect().top)
    : 0;
  t.style.bottom = `${navH + raised + 12}px`;
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
