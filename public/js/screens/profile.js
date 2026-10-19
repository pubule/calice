import { api } from '../api-client.js';
import { escapeHtml, skeletonBar } from '../util.js';
import { alertModal, confirmModal, promptModal } from '../modal.js';
import { navigate } from '../router.js';
import { drinkWindow, drinkSummary } from '../drink-window.js';
import { TASTE_AXES, toStep } from '../tasting-profile.js';

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
    <div class="follow-row"><div class="rev-avatar">${initials}</div><span class="name">${escapeHtml(u.name)}</span><div class="follow-btn" data-id="${u.id}" data-name="${escapeHtml(u.name)}" role="button" tabindex="0" aria-label="Seguito: smetti di seguire ${escapeHtml(u.name)}">Seguito</div></div>`;
}

async function renderFollows() {
  const follows = await api.get('/api/follows');
  const el = document.getElementById('profile-follows');
  if (!el) return;
  el.innerHTML = follows.length ? follows.map(followRowHtml).join('') : '<p style="font-size:calc(11.5rem/17);color:#736a5d;">Non segui ancora nessuno.</p>';
  el.querySelectorAll('.follow-btn').forEach((btn) =>
    btn.addEventListener('click', async () => {
      // Unfollowing is easy to hit by accident, so confirm first. confirmModal
      // writes the message via textContent, so the raw name is safe here.
      const ok = await confirmModal(`Smettere di seguire ${btn.dataset.name}?`, { confirmLabel: 'Smetti di seguire', danger: true });
      if (!ok) return;
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

// Excel in Italian reads ";" as the separator and "," as the decimal mark;
// the BOM makes it read accents as UTF-8.
function csvField(value) {
  const s = String(value ?? '');
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const decimal = (n) => (n == null || n === '' ? '' : String(Math.round(Number(n) * 100) / 100).replace('.', ','));
const capitalized = (t) => (t ? t[0].toUpperCase() + t.slice(1) : '');
const dateOnly = (d) => (d ? String(d).slice(0, 10) : '');
const spot = (p) => (p.slot_tier == null ? p.element_name : `${p.element_name} · L${p.slot_tier} ${String.fromCharCode(65 + p.slot_col)}.${p.slot_depth}`);
const WINDOW_BASIS = { manual: 'impostata a mano', disgorged: 'stimata dalla sboccatura', vintage: "stimata dall'annata", added: "stimata dalla data d'inserimento" };
const hasContent = (n) => n.text || n.flavor_tags?.length || n.food_pairings?.length || TASTE_AXES.some((a) => n[`taste_${a.id}`] != null);

// One row per wine with everything the app shows about it, including the
// caller's latest tasting note.
const CSV_COLUMNS = [
  ['Cantina', (b) => b.cellarName],
  ['Vino', (b) => b.name],
  ['Produttore', (b) => b.producer],
  ['Annata', (b) => b.vintage],
  ['Tipo', (b) => capitalized(b.type)],
  ['Paese', (b) => b.country],
  ['Regione', (b) => b.region],
  ['Denominazione', (b) => b.denomination],
  ['Vitigni', (b) => b.grape_variety],
  ['Gradazione (% vol)', (b) => decimal(b.alcohol)],
  ['Bottiglie', (b) => b.quantity],
  ['Prezzo a bottiglia (€)', (b) => decimal(b.price_paid)],
  ['Valore totale (€)', (b) => (b.price_paid == null ? '' : decimal(b.price_paid * b.quantity))],
  ['Posizione in cantina', (b) => (b.places ?? []).map(spot).join(', ')],
  ['Sboccatura', (b) => b.disgorged_at],
  ['Da bere dal', (b) => b.window.from],
  ['Da bere fino al', (b) => b.window.until],
  ['Al meglio dal', (b) => b.window.peakFrom],
  ['Al meglio fino al', (b) => b.window.peakUntil],
  ['Stato', (b) => drinkSummary(b.window).title],
  ['Finestra', (b) => WINDOW_BASIS[b.window.basis]],
  ['Il mio voto', (b) => decimal(b.my_rating)],
  ['Voto Vivino', (b) => decimal(b.vivino_rating)],
  ['Valutazioni Vivino', (b) => b.vivino_ratings_count],
  ['La mia nota', (b) => b.note?.text],
  ['Aromi', (b) => (b.note?.flavor_tags ?? []).join(', ')],
  ['Abbinamenti', (b) => (b.note?.food_pairings ?? []).join(', ')],
  ...TASTE_AXES.map((axis) => [`${axis.name} (1-10)`, (b) => (b.note?.[`taste_${axis.id}`] == null ? '' : toStep(b.note[`taste_${axis.id}`]))]),
  ['Aggiunto il', (b) => dateOnly(b.added_at)],
  ['Sito del produttore', (b) => b.producer_url],
  ['Foto', (b) => (b.image_url ? new URL(b.image_url, window.location.origin).href : '')],
];

document.getElementById('export-csv-row')?.addEventListener('click', async () => {
  const [me, cellars] = await Promise.all([api.get('/api/auth/me'), api.get('/api/cellars')]);
  const rows = [];
  for (const cellar of cellars) {
    const bottles = await api.get(`/api/cellars/${cellar.id}/bottles`);
    const notes = await Promise.all(bottles.map((b) => api.get(`/api/bottles/${b.id}/notes`).catch(() => [])));
    bottles.forEach((b, i) => {
      // Notes come newest first: the caller's latest one with something written.
      const note = notes[i].find((n) => n.user_id === me.id && hasContent(n));
      rows.push({ ...b, cellarName: cellar.name, window: drinkWindow(b), note });
    });
  }
  const lines = [CSV_COLUMNS.map(([title]) => title), ...rows.map((b) => CSV_COLUMNS.map(([, value]) => value(b)))];
  const csv = `﻿${lines.map((line) => line.map(csvField).join(';')).join('\r\n')}\r\n`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
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
    // index.html registers the service worker unconditionally on load, but
    // `serviceWorker.ready` still waits for it to actually activate — which
    // can be slow (or, in principle, never happen: a blocked script, a
    // registration that throws silently). Race it against a timeout so a
    // stuck activation degrades the same way as an unsupported browser
    // instead of leaving the toggle spinning forever.
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
