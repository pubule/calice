import { api } from '../api-client.js';
import { logout } from '../auth.js';
import { navigate } from '../router.js';
import { escapeHtml } from '../util.js';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

let firstCellarId = null;

// Cellar names and followed-user names are both attacker-controllable
// (POST /api/cellars takes an arbitrary `name`; user names are unvalidated
// at signup) — escape both before they reach innerHTML.
function followRowHtml(u) {
  const initials = escapeHtml(String(u.name).slice(0, 2).toUpperCase());
  return `
    <div class="follow-row"><div class="rev-avatar">${initials}</div><span class="name">${escapeHtml(u.name)}</span><div class="follow-btn" data-id="${u.id}">Seguito</div></div>`;
}

async function renderFollows() {
  const follows = await api.get('/api/follows');
  const el = document.getElementById('profile-follows');
  if (!el) return;
  el.innerHTML = follows.length ? follows.map(followRowHtml).join('') : '<p style="font-size:11.5px;color:#8f8474;">Non segui ancora nessuno.</p>';
  el.querySelectorAll('.follow-btn').forEach((btn) =>
    btn.addEventListener('click', async () => {
      // Re-fetch from the server after the mutation rather than trusting an
      // optimistic local removal, so the list reflects what actually persisted.
      await api.del(`/api/follows/${btn.dataset.id}`);
      await renderFollows();
    }),
  );
}

// Invite/notif/logout controls live in the static page shell, not inside a
// container this module re-renders — wire them once at module load (this
// module only ever evaluates once, whereas mountProfile() re-runs on every
// visit to #/profile). Attaching them inside mountProfile() would stack a
// duplicate handler on every revisit: a second click would then generate two
// invite codes, subscribe twice, or log out twice.
document.getElementById('invite-btn')?.addEventListener('click', async () => {
  if (firstCellarId == null) return;
  const { code } = await api.post(`/api/cellars/${firstCellarId}/invite`);
  document.getElementById('invite-result').textContent = `${window.location.origin}/#/invite/${code}`;
});

document.getElementById('notif-toggle')?.addEventListener('change', async (e) => {
  if (!e.target.checked) return;
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('push not supported in this browser');
    // No page in this app registers a service worker yet, so
    // `serviceWorker.ready` would otherwise hang forever with no feedback —
    // race it against a timeout so an unregistered SW degrades the same way
    // as an unsupported browser instead of leaving the toggle stuck.
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) => setTimeout(() => reject(new Error('no service worker registered')), 3000)),
    ]);
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(window.CALICE_VAPID_PUBLIC_KEY),
    });
    await api.post('/api/push/subscribe', sub.toJSON());
  } catch (err) {
    // Permission denied, unsupported browser, or a subscribe/network
    // failure — none of these should crash the screen. Reset the toggle so
    // the UI doesn't claim a subscription that doesn't exist.
    console.error('push subscription failed', err);
    e.target.checked = false;
  }
});

document.getElementById('logout-btn')?.addEventListener('click', async () => {
  await logout();
  navigate('#/login');
});

export async function mountProfile() {
  const cellars = await api.get('/api/cellars');
  firstCellarId = cellars[0]?.id ?? null;
  document.getElementById('profile-cellar-count').textContent = String(cellars.length);
  await renderFollows();
}
