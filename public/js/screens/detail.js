import { api } from '../api-client.js';
import { escapeHtml, photoClass } from '../util.js';
import { openLocationPicker, locationLabel } from './cellar.js';

let currentBottleId = null;
let currentBottle = null; // same object reference cellar.js's currentBottles holds, mutated in place on save
let currentMeId = null;

function noteHtml(n) {
  // rating/text/author_name all come from the API as unvalidated JSON (no
  // backend schema check) — coerce rating to a safe 0-5 int so a malicious
  // non-numeric value can't turn '★'.repeat(NaN) into a thrown exception
  // that would blank the whole notes list, and escape every string field
  // before it goes into innerHTML.
  const rating = Math.min(5, Math.max(0, Math.round(Number(n.rating)) || 0));
  return `
    <div class="rev-card">
      <div class="rev-head"><div class="rev-avatar">${escapeHtml(n.author_name.slice(0, 2).toUpperCase())}</div><div class="rev-name">${escapeHtml(n.author_name)}</div><span class="rev-src">${new Date(n.created_at).toLocaleDateString('it-IT')}</span></div>
      <div class="rev-stars">${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}</div>
      <div class="rev-text">${escapeHtml(n.text)}</div>
    </div>`;
}

function renderHero(bottle) {
  const hero = document.querySelector('#detail-overlay .detail-hero');
  hero.className = 'detail-hero photo ' + photoClass(bottle.type);
  // A real product photo (saved from a web-search candidate) overrides the
  // generic type-tinted gradient set by the class above.
  hero.style.backgroundImage = bottle.image_url ? `url('${bottle.image_url.replace(/'/g, "\\'")}')` : '';
  document.querySelector('#detail-overlay .info .name').textContent = bottle.name;
  document.querySelector('#detail-overlay .info .sub').textContent =
    `${bottle.producer} · ${bottle.region ?? bottle.country}${bottle.vintage ? ' · ' + bottle.vintage : ''}`;
  const badge = document.querySelector('#detail-overlay .badge-score');
  if (bottle.score != null) {
    badge.textContent = Number(bottle.score).toFixed(1);
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
  document.getElementById('loc-value').textContent = locationLabel(bottle) || 'Non assegnata';
}

async function loadNotes(bottleId) {
  const notes = await api.get(`/api/bottles/${bottleId}/notes`);
  document.getElementById('notes-mine').innerHTML =
    notes.filter((n) => n.user_id === currentMeId).map(noteHtml).join('') || '<p>Nessuna nota ancora.</p>';
  document.getElementById('notes-others').innerHTML =
    notes.filter((n) => n.user_id !== currentMeId).map(noteHtml).join('') || '<p>Nessuna nota ancora da chi condivide o segui.</p>';
}

async function loadPhotos(bottleId) {
  const photos = await api.get(`/api/bottles/${bottleId}/photos`);
  const gallery = document.getElementById('detail-gallery');
  gallery.innerHTML =
    photos
      .map((p) => `<div class="gallery-thumb" style="background-image:url('${escapeHtml(p.url)}');background-size:cover;"></div>`)
      .join('') +
    '<div class="gallery-add" id="gallery-add-btn"><svg viewBox="0 0 24 24" style="width:18px;height:18px;" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><input type="file" accept="image/*" capture="environment" style="display:none" id="gallery-file-input"></div>';
  document.getElementById('gallery-add-btn').addEventListener('click', () => document.getElementById('gallery-file-input').click());
  document.getElementById('gallery-file-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    await api.post(`/api/bottles/${currentBottleId}/photos`, form);
    await loadPhotos(currentBottleId);
  });
}

export async function openDetail(bottle, me) {
  currentBottleId = bottle.id;
  currentBottle = bottle;
  currentMeId = me.id;
  document.getElementById('detail-overlay').classList.add('open');
  renderHero(bottle);
  await Promise.all([loadNotes(currentBottleId), loadPhotos(currentBottleId)]);
}

// The gallery add-tile and file input are re-created on every loadPhotos()
// call (they're part of its innerHTML), so they get wired there. Everything
// else in the sheet (close, tab switch, star picker, note form, location edit)
// is static markup that exists once for the app's lifetime — wire it once
// here, mirroring cellar.js's wireStaticControls(), instead of re-attaching
// a fresh listener (and stacking duplicates) on every openDetail() call.
function wireStaticControls() {
  document.getElementById('detail-close')?.addEventListener('click', () => {
    document.getElementById('detail-overlay').classList.remove('open');
  });

  document.querySelectorAll('.rev-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.rev-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.rev-tabpanel').forEach((panel) => {
        panel.style.display = panel.dataset.panel === tab.dataset.tab ? 'flex' : 'none';
      });
    });
  });

  document.querySelectorAll('.stars-input span').forEach((s, i, arr) => {
    s.addEventListener('click', () => arr.forEach((el, j) => el.classList.toggle('on', j <= i)));
  });

  document.getElementById('note-submit')?.addEventListener('click', async () => {
    if (currentBottleId == null) return;
    const textEl = document.getElementById('note-text');
    const text = textEl.value.trim();
    if (!text) return;
    const rating = document.querySelectorAll('.stars-input span.on').length || 3;
    await api.post(`/api/bottles/${currentBottleId}/notes`, { rating, text });
    textEl.value = '';
    document.querySelectorAll('.stars-input span.on').forEach((s) => s.classList.remove('on'));
    await loadNotes(currentBottleId);
  });

  document.getElementById('loc-edit-btn')?.addEventListener('click', () => {
    if (!currentBottle) return;
    openLocationPicker(currentBottle, (updated) => {
      document.getElementById('loc-value').textContent = locationLabel(updated) || 'Non assegnata';
    });
  });
}

wireStaticControls();
