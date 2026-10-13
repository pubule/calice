import { registerRoute, startRouter, navigate } from './router.js';
import { me } from './auth.js';
import { mountHome } from './screens/home.js';
import { mountCellar } from './screens/cellar.js';
import { mountAdd } from './screens/add.js';
import { mountStats } from './screens/stats.js';
import { mountProfile } from './screens/profile.js';
import { mountInviteAccept } from './screens/invite.js';
import { mountExplore } from './screens/explore.js';
import './sheet-gestures.js';

// Views without a tab of their own light the tab they are reached from.
// Esplora is a sub-section opened from Home, so it keeps Home lit. Add has its
// own slot in the bar (the raised "+"), which lights itself.
const TAB_FOR_VIEW = { 'view-explore': 'view-home', 'view-invite': 'view-home' };

// Tab → route, explicit rather than derived from the view id (routes are not
// all `#/<name>`: Esplora lives at #/esplora).
const HASH_FOR_VIEW = {
  'view-home': '#/home',
  'view-cellar': '#/cellar',
  'view-add': '#/add',
  'view-stats': '#/stats',
  'view-profile': '#/profile',
};

function showView(id) {
  const tabView = TAB_FOR_VIEW[id] ?? id;
  document.querySelectorAll('.navbtn[data-view]').forEach((b) => {
    const current = b.dataset.view === tabView;
    b.classList.toggle('active', current);
    if (current) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active', 'shown'));
  const next = document.getElementById(id);
  if (!next) return;
  next.classList.add('active');
  // .shown added a frame later (not in the same tick) so the browser paints
  // opacity:0 first — otherwise the two class changes can be coalesced into
  // one style recalc and the crossfade never runs. See app.css .view.active.
  requestAnimationFrame(() => next.classList.add('shown'));
}

// iOS Safari (standalone PWA) doesn't reliably shrink 100dvh when the
// keyboard opens — it pans the whole layout instead, dragging the navbar
// into view above the keyboard. Track the real visible height ourselves via
// visualViewport and drive .screen's height from it; also treat a shrunk
// viewport as "keyboard open" to hide the navbar, which is more reliable
// than a single input's focus/blur (covers any field, any screen).
const vv = window.visualViewport;
if (vv) {
  const fullHeight = window.innerHeight;
  const applyViewportHeight = () => {
    // .screen is position:fixed and pinned to the ACTUAL visible rectangle
    // (top + height from visualViewport), not the layout viewport — iOS
    // pans the layout viewport to reveal a focused input above the
    // keyboard regardless of any element's CSS height, so without this the
    // panned-past area (below a merely-shortened .screen) shows through as
    // unpainted black canvas.
    //
    // Only apply that override while a text input genuinely has focus. A
    // resize/scroll event on visualViewport doesn't only fire when the
    // keyboard opens — it also fires on cold launch and, worse, every time
    // the standalone PWA resumes from the background (switching back from
    // another app), and in both cases iOS can report transient/unsettled
    // numbers before they are trustworthy. Gating on a real focused
    // input/textarea (rather than trying to guess from vv.height alone) is
    // the one signal that's actually true only when the keyboard is really
    // up, so cold-launch and background-resume always fall through to
    // .screen's own correct CSS default (stretched top:0/bottom:0) instead
    // of sometimes latching onto a bad transient value.
    const screen = document.querySelector('.screen');
    const active = document.activeElement;
    const editing = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
    const shrunk = editing && vv.height < fullHeight - 100;
    if (shrunk) {
      // Setting top AND height over-constrains the box, so the stylesheet's
      // bottom:0 is dropped for the duration — exactly the intent. Removing
      // both inline values restores the stretch.
      screen?.style.setProperty('top', `${vv.offsetTop}px`);
      screen?.style.setProperty('height', `${vv.height}px`);
    } else {
      screen?.style.removeProperty('top');
      screen?.style.removeProperty('height');
    }
    document.querySelector('.navbar')?.classList.toggle('kb-hidden', shrunk);
  };
  vv.addEventListener('resize', applyViewportHeight);
  vv.addEventListener('scroll', applyViewportHeight);
  // No eager call on load — see the focus gating above; nothing is focused
  // at load anyway, so it would be a no-op.
}

registerRoute('#/home', async () => { showView('view-home'); await mountHome(); });
registerRoute('#/cellar', async () => { showView('view-cellar'); await mountCellar(); });
registerRoute('#/add', async () => { showView('view-add'); await mountAdd(); });
registerRoute('#/stats', async () => { showView('view-stats'); await mountStats(); });
registerRoute('#/profile', async () => { showView('view-profile'); await mountProfile(); });
registerRoute('#/invite/:code', async (search, params) => { showView('view-invite'); await mountInviteAccept(search, params); });
registerRoute('#/esplora', async () => { showView('view-explore'); await mountExplore(); });

document.querySelector('.logout')?.addEventListener('click', () => {
  // Cloudflare Access, not the app, owns the session: this clears the
  // Access cookie and re-prompts Google login on the next visit.
  window.location.href = 'https://smartcores.cloudflareaccess.com/cdn-cgi/access/logout';
});

document.querySelectorAll('.navbtn[data-view]').forEach((btn) => {
  btn.addEventListener('click', () => navigate(HASH_FOR_VIEW[btn.dataset.view]));
});

// Back from Add. Each history entry is stamped with its depth inside the app
// (history.state.calDepth): a cold start, including a deep link to #/add, is
// depth 0, every in-app hash navigation is one deeper, and traversing history
// keeps the stamps already stored. So depth > 0 means the previous entry is
// ours and history.back() is safe; at depth 0 it would leave the app (or do
// nothing in a standalone PWA), so go to Cantina instead.
let calDepth = 0;
function stampHistoryDepth() {
  try {
    const stored = history.state?.calDepth;
    calDepth = Number.isInteger(stored) ? stored : calDepth + 1;
    if (stored !== calDepth) history.replaceState({ ...(history.state || {}), calDepth }, '');
  } catch {
    calDepth = 0; // history API unavailable: always take the safe branch
  }
}
try {
  const initial = history.state?.calDepth;
  calDepth = Number.isInteger(initial) ? initial : 0;
  if (initial !== calDepth) history.replaceState({ ...(history.state || {}), calDepth }, '');
} catch { /* see above */ }
window.addEventListener('hashchange', stampHistoryDepth);

document.getElementById('add-back-btn')?.addEventListener('click', () => {
  if (calDepth > 0) history.back();
  else navigate('#/cellar');
});

// Cloudflare Access already gated this request before it reached us, so
// /api/auth/me should always succeed (it also creates the user + their
// first cellar on their very first visit). A failure here is a transient
// hiccup, not a logged-out state — there's no login screen to send anyone
// to anymore.
me()
  .then(() => startRouter())
  .catch((err) => {
    console.error('bootstrap failed', err);
    const shell = document.querySelector('.screen');
    if (!shell) return;
    shell.textContent = '';
    const box = document.createElement('div');
    box.style.cssText = 'padding:40px 20px;text-align:center;color:#756b60;';
    box.append('Errore di connessione. ');
    const reload = document.createElement('button');
    reload.textContent = 'Ricarica';
    reload.style.cssText = 'text-decoration:underline;background:none;border:none;color:inherit;font:inherit;cursor:pointer;';
    reload.addEventListener('click', () => location.reload());
    box.append(reload);
    shell.append(box);
  });

// Keyboard / VoiceOver activation for the app's many non-native controls
// (divs with role="button"/"tab"/"radio" and a click listener): Enter or
// Space on the focused element fires its click, like a native <button>.
// One delegated listener, so markup rendered later is covered too. Real
// buttons, links and form fields are left to the browser.
document.addEventListener('keydown', (e) => {
  if ((e.key !== 'Enter' && e.key !== ' ') || e.repeat || e.defaultPrevented) return;
  const el = e.target;
  if (!(el instanceof Element) || !el.matches('[role="button"], [role="tab"], [role="radio"]')) return;
  if (el.matches('button, a[href], input, textarea, select') || el.getAttribute('aria-disabled') === 'true') return;
  e.preventDefault(); // Space would otherwise scroll the page
  el.click();
});

// iOS Safari only applies :active to non-link elements while some touchstart
// listener exists on the page — without this the press states in app.css
// never show on divs with role="button".
document.addEventListener('touchstart', () => {}, { passive: true });
