import { api } from '../api-client.js';
import { escapeHtml, skeletonBar } from '../util.js';
import { alertModal, promptModal } from '../modal.js';
import { navigate } from '../router.js';

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

document.getElementById('find-friends-btn')?.addEventListener('click', async () => {
  const email = await promptModal('Email della persona da seguire', { title: 'Trova amici', placeholder: 'email@esempio.com', confirmLabel: 'Cerca' });
  if (!email) return;
  try {
    const user = await api.get(`/api/follows/lookup?email=${encodeURIComponent(email.trim())}`);
    await api.post(`/api/follows/${user.id}`);
    await renderFollows();
  } catch (err) {
    if (err.status === 404) await alertModal('Nessun utente trovato con questa email.', { title: 'Trova amici' });
    else if (err.status === 400) await alertModal('Non puoi seguire te stesso.', { title: 'Trova amici' });
    else await alertModal('Ricerca non riuscita, riprova.', { title: 'Trova amici' });
  }
});

document.getElementById('my-cellars-row')?.addEventListener('click', () => navigate('#/cellar'));

document.getElementById('help-row')?.addEventListener('click', () => {
  alertModal(
    'Aggiungi vini scansionando l\'etichetta, il codice a barre o cercandoli per nome. Tocca "Elementi cantina" per organizzare le bottiglie su scaffali, celle o scatoloni. Segui altre persone da Profilo per vedere la loro attività. Problemi? Scrivi a chi ti ha invitato in questa cantina.',
    { title: 'Aiuto' },
  );
});

function csvField(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

document.getElementById('export-csv-row')?.addEventListener('click', async () => {
  const cellars = await api.get('/api/cellars');
  const header = ['cantina', 'vino', 'produttore', 'annata', 'tipo', 'paese', 'regione', 'quantita', 'prezzo_pagato', 'valutazione'];
  const lines = [header.join(',')];
  for (const cellar of cellars) {
    const bottles = await api.get(`/api/cellars/${cellar.id}/bottles`);
    for (const b of bottles) {
      lines.push([cellar.name, b.name, b.producer, b.vintage ?? '', b.type, b.country, b.region ?? '', b.quantity, b.price_paid ?? '', b.score ?? ''].map(csvField).join(','));
    }
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `calice-cantina-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
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

export async function mountProfile() {
  document.getElementById('profile-follows').innerHTML = Array.from(
    { length: 2 },
    () => `<div class="follow-row"><div class="rev-avatar skeleton"></div>${skeletonBar('50%', 11)}</div>`,
  ).join('');

  // Set via textContent (not innerHTML), so no escapeHtml() needed here —
  // the DOM API itself treats these as plain text, not markup.
  const user = await api.get('/api/auth/me');
  document.getElementById('profile-avatar').textContent = String(user.name).slice(0, 2).toUpperCase();
  document.getElementById('profile-name').textContent = user.name;
  document.getElementById('profile-email').textContent = user.email;

  const cellars = await api.get('/api/cellars');
  firstCellarId = cellars[0]?.id ?? null;
  document.getElementById('profile-cellar-count').textContent = String(cellars.length);
  await renderFollows();
}
