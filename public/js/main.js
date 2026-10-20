import { registerRoute, startRouter, navigate } from './router.js';
import { me } from './auth.js';
import { mountHome } from './screens/home.js';
import { mountCellar, mountPlaces } from './screens/cellar.js';
import { openAddSheet } from './screens/add.js';
import { mountStats } from './screens/stats.js';
import { mountProfile } from './screens/profile.js';
import { mountExplore } from './screens/explore.js';
import { mountAromas } from './screens/aromas.js';
import { mountTasting } from './screens/tasting.js';
import './sheet-gestures.js';
import { warmUp } from './warmup.js';
import { startLoaderGlass } from './loader-glass.js';

// Views without a tab of their own light the tab they are reached from.
// Esplora is a sub-section opened from Home, so it keeps Home lit. The raised
// "+" is not a tab: it opens the "Aggiungi un vino" sheet over the current
// screen (screens/add.js). Statistiche is opened from Profilo.
const TAB_FOR_VIEW = { 'view-explore': 'view-home', 'view-aromas': 'view-home', 'view-tasting': 'view-home', 'view-stats': 'view-profile' };

// Tab → route, explicit rather than derived from the view id (routes are not
// all `#/<name>`: Esplora lives at #/esplora). The "Vini" tab is view-cellar
// at #/cellar; the "Cantina" tab (its elements) is view-places at #/cantina.
const HASH_FOR_VIEW = {
  'view-home': '#/home',
  'view-cellar': '#/cellar',
  'view-places': '#/cantina',
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

// A text field the user can actually be typing in: focused, on screen, and
// not inside a sheet that has been closed (closed sheets stay in the DOM, so
// a field in one can keep the focus while invisible).
const CLOSED_LAYER = '.compare-overlay:not(.open), .detail-overlay:not(.open), .camera-overlay:not(.open)';
function isLiveField(el) {
  if (!el || !(el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'file', 'range', 'button', 'submit'].includes(el.type)))) return false;
  return !el.closest(CLOSED_LAYER) && el.getClientRects().length > 0;
}

// Closing a sheet takes the focus out of it: a field left focused inside a
// closed sheet keeps iOS in "typing" mode with nothing visible to type in.
// One observer for every sheet, so a new one can't forget it.
new MutationObserver((records) => {
  for (const r of records) {
    const el = r.target;
    const wasOpen = /(^|\s)open(\s|$)/.test(r.oldValue ?? '');
    if (wasOpen && !el.classList.contains('open') && el.contains(document.activeElement)) {
      document.activeElement.blur();
    }
  }
}).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });

// .screen is the app's fixed frame: only views and sheets inside it scroll.
// A browser can still scroll it to bring a caret into view (typing while the
// "Aggiungi un vino" sheet is still sliding up moved the whole app 91px and
// hid the sheet's header), so put it straight back.
const appFrame = document.querySelector('.screen');
appFrame?.addEventListener('scroll', () => {
  if (appFrame.scrollTop || appFrame.scrollLeft) appFrame.scrollTo(0, 0);
});

// Scrolls the field's own scroll container (a .view or a sheet — never the
// fixed .screen) so the field sits in the middle of the visible area.
function revealField(el) {
  let sc = el.parentElement;
  while (sc && sc !== document.body) {
    const oy = getComputedStyle(sc).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && sc.scrollHeight > sc.clientHeight) break;
    sc = sc.parentElement;
  }
  if (!sc || sc === document.body) return;
  const r = el.getBoundingClientRect();
  const box = sc.getBoundingClientRect();
  const visibleBottom = Math.min(box.bottom, vv ? vv.offsetTop + vv.height : window.innerHeight);
  // Already fully in view (e.g. a search bar at the top): leave it alone.
  if (r.top >= box.top + 8 && r.bottom <= visibleBottom - 8) return;
  const room = visibleBottom - box.top;
  const offset = r.height < room ? (room - r.height) / 2 : 16;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  sc.scrollTo({ top: sc.scrollTop + (r.top - box.top - offset), behavior: reduce ? 'auto' : 'smooth' });
}

let pendingReveal = null;
document.addEventListener('focusin', (e) => {
  const el = e.target;
  const typing = el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'file', 'range'].includes(el.type));
  if (!typing) return;
  pendingReveal = el;
  // No keyboard resize (desktop, hardware keyboard): reveal anyway. On iOS
  // this may run before the keyboard is up (the field still looks visible,
  // so nothing moves) and the resize handler below does the real work.
  setTimeout(() => {
    if (pendingReveal === el && document.activeElement === el) revealField(el);
  }, 450);
});
document.addEventListener('focusout', (e) => { if (pendingReveal === e.target) pendingReveal = null; });
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
    const shrunk = isLiveField(document.activeElement) && vv.height < fullHeight - 100;
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
  // The override must never outlive the keyboard. iOS doesn't always send a
  // last resize when the keyboard goes away (seen in build 109: after adding
  // a wine the app stayed cut at the keyboard's height, tab bar mid-screen),
  // so re-check whenever a field loses focus — once the keyboard has had
  // time to close — and when the app comes back to the foreground.
  document.addEventListener('focusout', () => {
    [0, 350, 800].forEach((ms) => setTimeout(applyViewportHeight, ms));
  });
  window.addEventListener('pageshow', applyViewportHeight);
  document.addEventListener('visibilitychange', applyViewportHeight);
  // Once the keyboard has settled, bring the focused field to the middle of
  // what is still visible — tapping the tasting note low in the bottle sheet
  // otherwise left it hidden behind the keyboard. Once per focus, so later
  // viewport events never fight the user's own scrolling.
  vv.addEventListener('resize', () => {
    const active = document.activeElement;
    if (pendingReveal && active === pendingReveal && vv.height < fullHeight - 100) {
      pendingReveal = null;
      requestAnimationFrame(() => revealField(active));
    }
  });
  // No eager call on load — see the focus gating above; nothing is focused
  // at load anyway, so it would be a no-op.
}

registerRoute('#/home', async () => { showView('view-home'); await mountHome(); });
registerRoute('#/cellar', async () => { showView('view-cellar'); await mountCellar(); });
// Old links to the Add screen: Home with the sheet open on top.
registerRoute('#/add', async () => {
  history.replaceState(history.state, '', '#/home');
  showView('view-home');
  openAddSheet({ focus: false });
  await mountHome();
});
registerRoute('#/cantina', async () => { showView('view-places'); await mountPlaces(); });
registerRoute('#/stats', async () => { showView('view-stats'); await mountStats(); });
registerRoute('#/profile', async () => { showView('view-profile'); await mountProfile(); });
registerRoute('#/esplora', async () => { showView('view-explore'); await mountExplore(); });
registerRoute('#/aromi', async () => { showView('view-aromas'); await mountAromas(); });
registerRoute('#/assaggio', async (search) => { showView('view-tasting'); await mountTasting(search); });

document.querySelector('.logout')?.addEventListener('click', () => {
  // Cloudflare Access, not the app, owns the session: this clears the
  // Access cookie and re-prompts Google login on the next visit.
  window.location.href = 'https://smartcores.cloudflareaccess.com/cdn-cgi/access/logout';
});

document.querySelectorAll('.navbtn[data-view]').forEach((btn) => {
  btn.addEventListener('click', () => navigate(HASH_FOR_VIEW[btn.dataset.view]));
});
document.querySelector('.nav-add')?.addEventListener('click', () => openAddSheet());

// Cloudflare Access already gated this request before it reached us, so
// /api/auth/me should always succeed (it also creates the user + their
// first cellar on their very first visit). A failure here is a transient
// hiccup, not a logged-out state — there's no login screen to send anyone
// to anymore.
// The start-up loader stays up while warmUp() fetches what every screen
// needs; the first screen renders underneath, then the loader fades away.
const loader = document.getElementById('app-loader');
const glass = startLoaderGlass(document.getElementById('app-loader-glass'));
const hideLoader = () => {
  glass.set(1);
  loader?.classList.add('done');
  setTimeout(() => { glass.stop(); loader?.remove(); }, 400);
};
me()
  .then(() => warmUp((p) => glass.set(p)))
  .then(() => startRouter())
  .then(() => requestAnimationFrame(hideLoader))
  .catch((err) => {
    hideLoader();
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
