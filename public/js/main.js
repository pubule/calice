import { registerRoute, startRouter, navigate } from './router.js';
import { me } from './auth.js';
import { mountHome } from './screens/home.js';
import { mountCellar } from './screens/cellar.js';
import { mountAdd } from './screens/add.js';
import { mountStats } from './screens/stats.js';
import { mountProfile } from './screens/profile.js';
import { mountInviteAccept } from './screens/invite.js';

function showView(id) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
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
    document.documentElement.style.setProperty('--app-top', `${vv.offsetTop}px`);
    document.documentElement.style.setProperty('--app-height', `${vv.height}px`);
    document.querySelector('.navbar')?.classList.toggle('kb-hidden', vv.height < fullHeight - 100);
  };
  vv.addEventListener('resize', applyViewportHeight);
  vv.addEventListener('scroll', applyViewportHeight);
  applyViewportHeight();
}

registerRoute('#/home', async () => { showView('view-home'); await mountHome(); });
registerRoute('#/cellar', async () => { showView('view-cellar'); await mountCellar(); });
registerRoute('#/add', async () => { showView('view-add'); await mountAdd(); });
registerRoute('#/stats', async () => { showView('view-stats'); await mountStats(); });
registerRoute('#/profile', async () => { showView('view-profile'); await mountProfile(); });
registerRoute('#/invite/:code', async (search, params) => { showView('view-invite'); await mountInviteAccept(search, params); });

document.querySelector('.logout')?.addEventListener('click', () => {
  // Cloudflare Access, not the app, owns the session: this clears the
  // Access cookie and re-prompts Google login on the next visit.
  window.location.href = 'https://smartcores.cloudflareaccess.com/cdn-cgi/access/logout';
});

document.querySelectorAll('.navbtn[data-view]').forEach((btn) => {
  btn.addEventListener('click', () => navigate('#/' + btn.dataset.view.replace('view-', '')));
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
