import { api } from '../api-client.js';
import { escapeHtml, photoClass } from '../util.js';
import { alertModal, promptModal } from '../modal.js';
import { showToast } from '../toast.js';
import { tastingProfileHtml, wireTastingProfile, resetTastingProfile, readTastingProfile, isTastingProfileEmpty } from '../tasting-profile.js';
import { COUNTRIES } from '../data/wine-atlas.js';

// "Aggiungi un vino" is a sheet over whatever screen the "+" was tapped on,
// not a screen of its own: the search field is focused at once, and before a
// word is typed it offers the camera, recent searches and the user's own
// wines (+1). Results come in three groups — the user's cellar (filtered
// here, no request), the shared catalog, then Vivino (debounced, skeleton
// while it loads). The camera is a full-screen viewfinder with three modes:
// label photo, barcode, or back to typing.

let currentCellarId = null;
let cellarBottles = []; // the user's bottles, newest first — "Dalla tua cantina"
let cellarLoad = null;
let changed = false; // something was added: the screen below re-renders on close

const ICON_PLUS = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
const ICON_CAM = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7l1.8-2.5h4.4L16 7"/><circle cx="12" cy="13.5" r="3.2"/></svg>';
const ICON_BAR = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 6v12M7 6v12M10 6v12M14 6v12M17 6v12M20 6v12"/></svg>';
const ICON_CLOCK = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>';

function photoTag(imageUrl, type) {
  return imageUrl
    ? `<img class="result-photo photo product" src="${escapeHtml(imageUrl)}" alt="">`
    : `<div class="result-photo photo ${photoClass(type)}"></div>`;
}

// Every field here comes straight from the wines table via /api/wines/search
// (or a barcode lookup on the same table) — including rows other users
// created through POST /api/wines, which the backend does not validate at
// all. Treat every field as attacker-controlled, numeric-looking ones (id,
// vintage) included, and escape before it goes into innerHTML.
function resultRowHtml(w) {
  const name = escapeHtml(w.name);
  const vintage = w.vintage ? ' ' + escapeHtml(w.vintage) : '';
  const producer = escapeHtml(w.producer);
  const sub = `${producer} · ${escapeHtml(w.region ?? w.country)}`;
  const id = escapeHtml(w.id);
  return `
    <div class="result-row" data-wine-id="${id}" role="button" tabindex="0" aria-label="Aggiungi ${name}${vintage} alla cantina">
      ${photoTag(w.image_url, w.type)}
      <div class="result-body"><div class="name">${name}${vintage}</div><div class="sub">${sub}</div></div>
      <div class="add-btn" aria-hidden="true">${ICON_PLUS}</div>
    </div>`;
}

// A bottle already in the user's cellar: one tap on +1 adds a bottle of it.
function mineRowHtml(b) {
  const name = escapeHtml(b.name);
  const vintage = b.vintage ? ' ' + escapeHtml(b.vintage) : '';
  const qty = Number(b.quantity) || 0;
  const count = qty > 0 ? `×${qty} in cantina` : 'finita';
  return `
    <div class="result-row mine">
      ${photoTag(b.image_url, b.type)}
      <div class="result-body"><div class="name">${name}${vintage}</div><div class="sub">${escapeHtml(b.producer)} · ${count}</div></div>
      <button type="button" class="plus1-btn" data-plus1="${escapeHtml(b.id)}" aria-label="Aggiungi una bottiglia di ${name}${vintage}">+1</button>
    </div>`;
}

// A specific product query often ranks several near-identical wines, so
// this never auto-picks one candidate: the user taps the right one, same
// review-before-save principle as the rest of this feature.
function webCandidateRowHtml(candidate, i) {
  const name = escapeHtml(candidate.title ?? '');
  let source = 'Trovato sul web';
  if (candidate.sourceUrl) {
    try {
      source = new URL(candidate.sourceUrl).hostname.replace(/^www\./, '');
    } catch {
      // malformed sourceUrl from an external source — keep the generic label
    }
  }
  return `
    <div class="result-row" data-candidate="${i}" role="button" tabindex="0">
      ${photoTag(candidate.imageUrl, candidate.prefill?.type ?? 'rosso')}
      <div class="result-body"><div class="name">${name}</div><div class="sub">${escapeHtml(source)}</div></div>
      <div class="add-btn" aria-hidden="true">${ICON_PLUS}</div>
    </div>`;
}

const groupLabel = (title, count) => `<div class="add-group-lbl">${title}${count == null ? '' : ` <span>${count}</span>`}</div>`;
const MANUAL_HTML = '<button type="button" class="add-manual" data-manual>Non lo trovi? Aggiungilo a mano</button>';

// null = the user pressed Annulla: abort, don't default to adding 1.
async function askQuantity() {
  const raw = await promptModal('Quante bottiglie?', { title: 'Aggiungi alla cantina', defaultValue: '1', inputType: 'number', confirmLabel: 'Aggiungi' });
  if (raw === null) return null;
  return Number(raw) || 1;
}

// `finish` runs before the sheet closes (tasting note, photo upload), so the
// screen underneath redraws with everything already saved.
async function postBottle(wineId, quantity, finish) {
  if (!currentCellarId) await (cellarLoad ?? loadCellar());
  const bottle = await api.post(`/api/cellars/${currentCellarId}/bottles`, { wineId, quantity });
  changed = true;
  await finish?.(bottle);
  closeAddSheet();
  showToast(quantity > 1 ? `Aggiunte ${quantity} bottiglie alla cantina` : 'Aggiunto alla cantina');
  return bottle;
}

async function addWineToCellar(wineId) {
  const quantity = await askQuantity();
  if (quantity === null) return null;
  try {
    return await postBottle(wineId, quantity);
  } catch (err) {
    console.error(err);
    await alertModal('Impossibile aggiungere il vino, riprova.');
    return null;
  }
}

// +1 on a wine already in the cellar: no quantity prompt, an undo instead.
async function plusOne(bottleId) {
  const b = cellarBottles.find((x) => String(x.id) === String(bottleId));
  if (!b) return;
  const before = Number(b.quantity) || 0;
  try {
    await api.patch(`/api/bottles/${b.id}`, { quantity: before + 1 });
  } catch (err) {
    console.error(err);
    await alertModal('Impossibile aggiungere la bottiglia, riprova.');
    return;
  }
  b.quantity = before + 1;
  changed = true;
  rememberSearch(b.name);
  rerender();
  showToast(`+1 ${b.name}`, {
    actionLabel: 'Annulla',
    onAction: async () => {
      try {
        await api.patch(`/api/bottles/${b.id}`, { quantity: before });
        b.quantity = before;
        rerender();
      } catch (err) {
        console.error(err);
      }
    },
  });
}

async function uploadBottlePhoto(bottleId, file) {
  const form = new FormData();
  form.append('file', file);
  await api.post(`/api/bottles/${bottleId}/photos`, form);
}

// Phone camera photos land at several MB (12+ MP, HEIC/JPEG) — re-encode to a
// capped resolution JPEG before it ever reaches R2, where storage and class-A
// writes both count against the free tier. 1600px longest side and quality
// 0.82 keep a bottle label readable while cutting most photos to a few
// hundred KB. Falls back to the original file if the browser can't decode it
// (e.g. an exotic format createImageBitmap rejects).
async function compressForUpload(file, maxDim = 1600, quality = 0.82) {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    return blob ?? file;
  } catch (err) {
    console.error('photo compression failed, uploading original', err);
    return file;
  }
}

// ---- recent searches (this device only: a convenience, never data) ----
const RECENT_KEY = 'calice-recent-searches';
function recentSearches() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((x) => typeof x === 'string').slice(0, 5) : [];
  } catch {
    return [];
  }
}
// Saved when a search led somewhere (a result was picked), not per keystroke.
function rememberSearch(term) {
  const t = String(term ?? '').trim();
  if (!t) return;
  try {
    const list = recentSearches().filter((x) => x.toLowerCase() !== t.toLowerCase());
    localStorage.setItem(RECENT_KEY, JSON.stringify([t, ...list].slice(0, 5)));
  } catch {
    // storage unavailable (private mode): recents simply don't stick
  }
}

const SHEET_TYPES = new Set(['rosso', 'bianco', 'bollicine', 'rosato']);
const foldText = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Vivino's "region" for a wine is usually its appellation ("Franciacorta",
// "Barolo"). When it names one of Esplora's atlas wines exactly, the atlas
// supplies what Vivino doesn't: the administrative region (Franciacorta →
// Lombardia), the tier (→ "Franciacorta DOCG") and the grape — only when
// the appellation has a single one (Barolo → Nebbiolo): for a blend the
// atlas lists what the rules allow, not what this bottle is, so nothing is
// guessed. Fields Vivino already gave win.
function completeFromAtlas(prefill) {
  if (!prefill?.denomination) return prefill;
  const country = COUNTRIES.find((c) => foldText(c.name) === foldText(prefill.country));
  const wanted = foldText(prefill.denomination);
  for (const region of country?.regions ?? []) {
    const wine = (region.wines ?? []).find((w) => foldText(w.name) === wanted);
    if (!wine) continue;
    return {
      ...prefill,
      region: prefill.region ?? region.name,
      denomination: wine.appellation ? `${wine.name} ${wine.appellation}` : wine.name,
      grapeVariety: prefill.grapeVariety ?? (wine.grapes?.length === 1 ? wine.grapes[0] : undefined),
      type: prefill.type ?? (SHEET_TYPES.has(wine.type) ? wine.type : undefined),
    };
  }
  return prefill;
}

// ---- the sheet ----
const overlay = document.getElementById('add-overlay');
const input = document.getElementById('add-search-input');
const results = document.getElementById('add-results');

function currentQuery() {
  return input?.value.trim() ?? '';
}

// One bottle per wine (the newest), so +1 never lists the same wine twice.
function uniqueByWine(bottles) {
  const seen = new Set();
  return bottles.filter((b) => (seen.has(b.wine_id) ? false : seen.add(b.wine_id)));
}

function loadCellar() {
  cellarLoad = (async () => {
    const cellars = await api.get('/api/cellars');
    currentCellarId = cellars[0].id;
    cellarBottles = uniqueByWine(await api.get(`/api/cellars/${currentCellarId}/bottles`));
  })();
  cellarLoad.catch((err) => console.error(err));
  return cellarLoad;
}

function renderIdle() {
  if (!results) return;
  const recent = recentSearches();
  const mine = cellarBottles.slice(0, 5);
  results.innerHTML = `
    <div class="add-quick">
      <button type="button" class="add-quick-btn" data-cam="label"><i>${ICON_CAM}</i>Etichetta</button>
      <button type="button" class="add-quick-btn" data-cam="barcode"><i>${ICON_BAR}</i>Codice a barre</button>
    </div>
    ${recent.length ? `${groupLabel('Cercati di recente')}<div class="add-recent">${recent.map((r) => `<button type="button" class="recent-chip" data-recent="${escapeHtml(r)}">${ICON_CLOCK}${escapeHtml(r)}</button>`).join('')}</div>` : ''}
    ${mine.length ? `${groupLabel('Dalla tua cantina')}<div class="add-group">${mine.map(mineRowHtml).join('')}</div>` : ''}
    ${MANUAL_HTML}`;
}

// Words in any order, accents ignored ("chianti fontodi" finds Fontodi's
// Chianti Classico).
function matchesCellar(b, words) {
  const hay = foldText([b.name, b.producer, b.region, b.denomination, b.vintage].filter(Boolean).join(' '));
  return words.every((w) => hay.includes(w));
}

// What each group currently holds, so +1/undo can redraw without refetching.
let lastCatalog = null; // null = still loading
let lastWeb = null; // null = still loading
let webTimer;

function rerender() {
  const q = currentQuery();
  if (!q) renderIdle();
  else renderResults(q);
}

function renderResults(query) {
  const words = foldText(query).split(/\s+/).filter(Boolean);
  const mine = cellarBottles.filter((b) => matchesCellar(b, words));
  const mineIds = new Set(mine.map((b) => String(b.wine_id)));
  const catalog = lastCatalog?.filter((w) => !mineIds.has(String(w.id)));
  let html = '';
  if (mine.length) html += `${groupLabel('Nella tua cantina', mine.length)}<div class="add-group">${mine.map(mineRowHtml).join('')}</div>`;
  if (catalog?.length) html += `${groupLabel('Catalogo', catalog.length)}<div class="add-group">${catalog.map(resultRowHtml).join('')}</div>`;
  if (lastWeb === null) {
    html += `${groupLabel('Da Vivino', 'cerco…')}<div class="add-group" aria-hidden="true"><div class="add-skel"></div><div class="add-skel"></div></div>`;
  } else if (lastWeb.length) {
    html += `${groupLabel('Da Vivino', lastWeb.length)}<div class="add-group">${lastWeb.map(webCandidateRowHtml).join('')}</div>`;
  } else {
    html += `${groupLabel('Da Vivino', 0)}<p class="add-empty">Nessun risultato su Vivino per "${escapeHtml(query)}"</p>`;
  }
  results.innerHTML = html + MANUAL_HTML;
}

// Every await between the typed text and a DOM write re-checks that the text
// is still the same (see CLAUDE.md, "Ricerche live"): a late reply for an
// earlier query must never repaint the list.
async function runSearch() {
  const query = currentQuery();
  clearTimeout(webTimer);
  if (!query) {
    renderIdle();
    return;
  }
  lastCatalog = null;
  lastWeb = null;
  renderResults(query);
  webTimer = setTimeout(() => searchWeb(query), 600);
  try {
    const wines = await api.get(`/api/wines/search?q=${encodeURIComponent(query)}`);
    if (currentQuery() !== query) return;
    lastCatalog = wines;
  } catch (err) {
    console.error(err);
    if (currentQuery() !== query) return;
    lastCatalog = [];
  }
  renderResults(query);
}

async function searchWeb(query) {
  if (currentQuery() !== query) return; // superseded by further typing
  let suggestion = {};
  try {
    suggestion = await api.post('/api/wines/recognize', { query });
  } catch (err) {
    console.error(err);
  }
  if (currentQuery() !== query) return; // superseded while the request was in flight
  lastWeb = suggestion.candidates ?? [];
  renderResults(query);
}

export function openAddSheet({ focus = true } = {}) {
  if (!overlay) return;
  if (input) input.value = '';
  lastCatalog = null;
  lastWeb = null;
  changed = false;
  renderIdle();
  overlay.classList.add('open');
  // Synchronously, inside the tap: iOS only raises the keyboard for a focus
  // that happens in the user's own gesture.
  if (focus) input?.focus({ preventScroll: true });
  loadCellar().then(() => { if (overlay.classList.contains('open') && !currentQuery()) renderIdle(); }, () => {});
}

function closeAddSheet() {
  if (!overlay?.classList.contains('open')) return;
  clearTimeout(webTimer);
  input?.blur();
  overlay.classList.remove('open');
  // The screen underneath (Cantina, Home…) shows counts that just changed:
  // re-run its route so it redraws.
  if (changed) {
    changed = false;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }
}

input?.addEventListener('input', runSearch);
input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
document.getElementById('add-close')?.addEventListener('click', closeAddSheet);
document.getElementById('add-camera-btn')?.addEventListener('click', () => openViewfinder('label'));

results?.addEventListener('click', (e) => {
  const t = e.target;
  const recent = t.closest('[data-recent]');
  if (recent) {
    input.value = recent.dataset.recent;
    runSearch();
    return;
  }
  const cam = t.closest('[data-cam]');
  if (cam) {
    openViewfinder(cam.dataset.cam);
    return;
  }
  if (t.closest('[data-manual]')) {
    openRecognizeSheet({ name: currentQuery() || undefined });
    return;
  }
  const plus = t.closest('[data-plus1]');
  if (plus) {
    plusOne(plus.dataset.plus1);
    return;
  }
  const wineRow = t.closest('[data-wine-id]');
  if (wineRow) {
    rememberSearch(currentQuery());
    addWineToCellar(Number(wineRow.dataset.wineId));
    return;
  }
  const cand = t.closest('[data-candidate]');
  if (cand && lastWeb) {
    const query = currentQuery();
    const c = lastWeb[Number(cand.dataset.candidate)];
    if (!c) return;
    rememberSearch(query);
    // Vivino candidates carry structured fields (prefill); without them
    // the typed query stays the name.
    const prefill = completeFromAtlas(c.prefill) ?? {};
    openRecognizeSheet({ ...prefill, name: prefill.name ?? query, imageUrl: c.imageUrl, sourceUrl: c.sourceUrl, rawText: c.snippet });
  }
});

// ---- viewfinder: label photo / barcode / back to typing ----
const cam = {
  overlay: document.getElementById('camera-overlay'),
  video: document.getElementById('camera-video'),
  still: document.getElementById('camera-still'),
  frame: document.getElementById('camera-frame'),
  hint: document.getElementById('camera-hint'),
  found: document.getElementById('camera-found'),
  shutter: document.getElementById('camera-shutter'),
};
let cameraStream;
let camMode = 'label';
// Bumped on every mode switch, retry and close: a scan loop or a recognize
// reply from an older session sees the mismatch and drops its result.
let camSession = 0;
let foundAction = null;

const HINTS = {
  label: "Inquadra l'etichetta e scatta",
  barcode: 'Inquadra il codice a barre: si legge da solo',
};

function setHint(text) {
  if (cam.hint) cam.hint.textContent = text;
}

function snapshot() {
  const v = cam.video;
  const canvas = document.createElement('canvas');
  canvas.width = v.videoWidth;
  canvas.height = v.videoHeight;
  canvas.getContext('2d').drawImage(v, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.7);
}

// Freezes the picture on the shot just taken while it is being read; the
// stream keeps running underneath, so Riprova is instant.
function freeze(dataUrl) {
  cam.still.src = dataUrl;
  cam.overlay.classList.add('frozen', 'busy');
  cam.frame.classList.add('locked');
}

function resume() {
  camSession++;
  cam.overlay.classList.remove('frozen', 'busy');
  cam.frame.classList.remove('locked');
  cam.found.classList.remove('show');
  cam.still.removeAttribute('src');
  foundAction = null;
  setHint(HINTS[camMode]);
  if (camMode === 'barcode') scanLoop(camSession);
}

function showFound({ title, sub, primary, photo, type, action }) {
  cam.overlay.classList.remove('busy');
  setHint('');
  document.getElementById('camera-found-title').textContent = title;
  document.getElementById('camera-found-sub').textContent = sub ?? '';
  const thumb = document.getElementById('camera-found-thumb');
  thumb.className = `cf-thumb photo ${photoClass(type ?? 'rosso')}`;
  thumb.style.backgroundImage = photo ? `url("${photo.replace(/"/g, '%22')}")` : '';
  thumb.classList.toggle('has-photo', !!photo);
  document.getElementById('camera-ok').textContent = primary;
  foundAction = action;
  cam.found.classList.add('show');
}

function setCamMode(mode) {
  if (mode === 'type') {
    // Back to the keyboard: the search sheet, focused (still inside the tap).
    closeViewfinder();
    if (!overlay.classList.contains('open')) openAddSheet();
    else input?.focus({ preventScroll: true });
    return;
  }
  camMode = mode;
  cam.overlay.dataset.mode = mode;
  cam.overlay.querySelectorAll('.camera-modes [data-mode]').forEach((b) => {
    const on = b.dataset.mode === mode;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  });
  resume();
}

async function openViewfinder(mode) {
  input?.blur();
  cam.overlay.classList.add('open');
  setCamMode(mode);
  if (cameraStream) return;
  try {
    // 'ideal' width/height, not a hard 'exact' constraint — the browser
    // still picks a supported resolution if the device can't do 1080p, it
    // just aims high. A curved barcode wrapped around a bottle needs the
    // extra detail low-res video (often 640x480 by default) loses.
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
  } catch (err) {
    console.error(err);
    closeViewfinder();
    await alertModal('Impossibile accedere alla fotocamera');
    return;
  }
  if (!cam.overlay.classList.contains('open')) {
    // closed while the permission prompt was up
    cameraStream.getTracks().forEach((t) => t.stop());
    cameraStream = undefined;
    return;
  }
  cam.video.srcObject = cameraStream;
  try {
    await cam.video.play();
  } catch (err) {
    console.error(err);
  }
}

function closeViewfinder() {
  camSession++;
  cameraStream?.getTracks().forEach((t) => t.stop());
  cameraStream = undefined;
  if (cam.video) cam.video.srcObject = null;
  cam.overlay?.classList.remove('open', 'frozen', 'busy');
  cam.frame?.classList.remove('locked');
  cam.found?.classList.remove('show');
  foundAction = null;
}

// window.BarcodeDetector is always present now — index.html installs the
// zbar-wasm-backed polyfill for any browser missing the native API (Safari
// never shipped it). Polls detect() until a code is found, or the session
// changes (mode switch, close).
async function scanLoop(session) {
  if (!('BarcodeDetector' in window)) {
    setHint('Lettura dei codici non supportata qui: scatta l’etichetta o scrivi il nome');
    return;
  }
  const detector = new window.BarcodeDetector();
  while (session === camSession) {
    if (cam.video.readyState >= 2) {
      try {
        const codes = await detector.detect(cam.video);
        if (session !== camSession) return;
        if (codes.length) {
          onBarcode(codes[0].rawValue, session);
          return;
        }
      } catch (err) {
        console.error(err);
      }
    }
    await new Promise((r) => setTimeout(r, 350));
  }
}

async function onBarcode(code, session) {
  freeze(snapshot());
  setHint('Cerco il codice…');
  try {
    const wines = await api.get(`/api/wines/search?barcode=${encodeURIComponent(code)}`);
    if (session !== camSession) return;
    if (wines.length) {
      const w = wines[0];
      showFound({
        title: `${w.name}${w.vintage ? ' ' + w.vintage : ''}`,
        sub: `${w.producer} · trovato dal codice ${code}`,
        primary: 'Aggiungi alla cantina',
        photo: w.image_url,
        type: w.type,
        action: async () => {
          closeViewfinder();
          if (!currentCellarId) await loadCellar();
          addWineToCellar(w.id);
        },
      });
      return;
    }
    const suggestion = await api.post('/api/wines/recognize', { barcode: code });
    if (session !== camSession) return;
    // Whatever Open Food Facts found prefills the sheet; when it found
    // nothing, the sheet opens with just the barcode, to be filled by hand.
    // The barcode is saved with the wine, so next time it's a local hit.
    showFound(suggestion.name
      ? { title: suggestion.name, sub: `${suggestion.producer ? suggestion.producer + ' · ' : ''}codice ${code}`, primary: 'Conferma', photo: suggestion.imageUrl, type: suggestion.type, action: () => { closeViewfinder(); openRecognizeSheet(suggestion); } }
      : { title: `Codice ${code} non trovato`, sub: 'Inserisci tu i dati: la prossima volta lo riconosco', primary: 'Compila a mano', action: () => { closeViewfinder(); openRecognizeSheet(suggestion); } });
  } catch (err) {
    console.error(err);
    if (session !== camSession) return;
    showFound({ title: 'Ricerca non riuscita', sub: 'Controlla la connessione e riprova', primary: 'Compila a mano', action: () => { closeViewfinder(); openRecognizeSheet({ barcode: code }); } });
  }
}

async function shootLabel() {
  if (camMode !== 'label' || cam.overlay.classList.contains('frozen') || !cameraStream) return;
  const session = camSession;
  const photoBase64 = snapshot();
  freeze(photoBase64);
  setHint("Leggo l'etichetta…");
  const manual = (suggestion) => () => { closeViewfinder(); openRecognizeSheet(suggestion, photoBase64); };
  try {
    const suggestion = await api.post('/api/wines/recognize', { photoBase64 });
    if (session !== camSession) return;
    if (suggestion.ocrLimited) {
      // Label reading is capped per day to stay in Cloudflare's free tier
      // (OCR_DAILY_LIMIT in recognize.ts): say so, then let the user type.
      showFound({ title: 'Lettura automatica finita per oggi', sub: 'Compila i dati a mano: domani torna disponibile', primary: 'Compila a mano', photo: photoBase64, action: manual(suggestion) });
    } else if (suggestion.name) {
      const sub = [suggestion.producer, suggestion.region, suggestion.vintage].filter(Boolean).join(' · ');
      showFound({ title: suggestion.name, sub: `${sub ? sub + ' · ' : ''}letto dall'etichetta`, primary: 'Conferma', photo: photoBase64, type: suggestion.type, action: manual(suggestion) });
    } else {
      showFound({ title: 'Nome non leggibile', sub: 'Riprova più vicino, oppure completa tu i dati', primary: 'Compila a mano', photo: photoBase64, action: manual(suggestion) });
    }
  } catch (err) {
    console.error(err);
    if (session !== camSession) return;
    showFound({ title: "Non sono riuscito a leggere l'etichetta", sub: 'Controlla la connessione e riprova', primary: 'Compila a mano', photo: photoBase64, action: manual({}) });
  }
}

cam.overlay?.querySelectorAll('.camera-modes [data-mode]').forEach((b) => b.addEventListener('click', () => setCamMode(b.dataset.mode)));
cam.shutter?.addEventListener('click', shootLabel);
document.getElementById('camera-close')?.addEventListener('click', closeViewfinder);
document.getElementById('camera-retry')?.addEventListener('click', resume);
document.getElementById('camera-ok')?.addEventListener('click', () => foundAction?.());

let pendingImageUrl;
let pendingBarcode;
let pendingPhotoFile;

// The sheet is shared by three entry points that all end up at the same
// fields: a recognized/found wine under review, a fully manual add, and
// editing a wine already in the cellar (from Cantina's "Modifica" icon).
// Only 'edit' changes what saveRecognizedWine() does on submit — the note
// composer is identical and always starts blank in every case (notes are
// append-only tasting entries, not a single mutable record, so there is
// never a past note to restore here even when editing the wine's own data).
let sheetMode = 'create'; // 'create' | 'edit'
let editingWineId = null;
let editingBottleId = null;
let editSavedCallback = null;

const recognizeTaste = document.getElementById('recognize-taste');
if (recognizeTaste) {
  recognizeTaste.innerHTML = tastingProfileHtml();
  wireTastingProfile(recognizeTaste);
}

function resetNoteComposer() {
  document.getElementById('rec-note-text').value = '';
  document.querySelectorAll('#rec-note-stars span').forEach((s) => {
    s.classList.remove('on');
    s.setAttribute('aria-checked', 'false');
  });
  if (recognizeTaste) resetTastingProfile(recognizeTaste);
}

// The review photo's size is set here, not only in index.html's markup: a
// device can run this module fresh while still holding an older cached
// index.html (seen in production — new prefill, full-height photo).
function sizeReviewPhoto(img) {
  Object.assign(img.style, { display: 'block', width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: '180px', margin: '0 auto', borderRadius: '10px', objectFit: 'contain' });
}

function openRecognizeSheet(suggestion, capturedPhotoDataUrl) {
  sheetMode = 'create';
  editingWineId = null;
  editingBottleId = null;
  editSavedCallback = null;
  document.getElementById('recognize-title').textContent = 'Rivedi e conferma';
  document.getElementById('recognize-save').textContent = 'Salva';
  document.getElementById('rec-note-section').classList.remove('hidden');

  document.getElementById('rec-name').value = suggestion.name ?? '';
  document.getElementById('rec-producer').value = suggestion.producer ?? '';
  document.getElementById('rec-country').value = suggestion.country ?? 'Italia';
  document.getElementById('rec-region').value = suggestion.region ?? '';
  document.getElementById('rec-type').value = suggestion.type ?? 'rosso';
  document.getElementById('rec-vintage').value = suggestion.vintage ?? '';
  document.getElementById('rec-grape').value = suggestion.grapeVariety ?? '';
  document.getElementById('rec-denomination').value = suggestion.denomination ?? '';
  resetNoteComposer();
  pendingImageUrl = suggestion.imageUrl;
  pendingBarcode = suggestion.barcode;
  pendingPhotoFile = undefined;
  document.getElementById('rec-photo-input').value = '';

  const photoWrap = document.getElementById('recognize-photo-wrap');
  const photoImg = document.getElementById('recognize-photo');
  sizeReviewPhoto(photoImg);
  const shownPhoto = capturedPhotoDataUrl ?? suggestion.imageUrl;
  if (shownPhoto) {
    photoImg.src = shownPhoto;
    photoWrap.style.display = '';
  } else {
    photoWrap.style.display = 'none';
  }

  const rawTextEl = document.getElementById('recognize-rawtext');
  if (suggestion.rawText) {
    let prefix = "Testo letto dall'etichetta: ";
    if (suggestion.sourceUrl) {
      try {
        prefix = `Trovato su ${new URL(suggestion.sourceUrl).hostname.replace(/^www\./, '')}: `;
      } catch {
        // malformed sourceUrl — keep the OCR-style default prefix
      }
    }
    rawTextEl.textContent = prefix + suggestion.rawText;
    rawTextEl.style.display = '';
  } else {
    rawTextEl.style.display = 'none';
  }

  document.getElementById('recognize-overlay').classList.add('open');
}

// Opened from Cantina's per-row "Modifica" icon — bottle already carries its
// wine fields flattened in (same join cellar.js's list renders from), plus
// its own id and wine_id, so every field can come pre-filled and stay fully
// editable, unlike the partial data a scan/search result returns.
export function openEditWineSheet(bottle, onSaved) {
  sheetMode = 'edit';
  editingWineId = bottle.wine_id;
  editingBottleId = bottle.id;
  editSavedCallback = onSaved ?? null;
  document.getElementById('recognize-title').textContent = 'Modifica vino';
  document.getElementById('recognize-save').textContent = 'Salva modifiche';
  // The note belongs to the bottle sheet ("Le tue note"), which already has
  // its own composer: editing the wine's data doesn't repeat it.
  document.getElementById('rec-note-section').classList.add('hidden');

  document.getElementById('rec-name').value = bottle.name ?? '';
  document.getElementById('rec-producer').value = bottle.producer ?? '';
  document.getElementById('rec-country').value = bottle.country ?? '';
  document.getElementById('rec-region').value = bottle.region ?? '';
  document.getElementById('rec-type').value = bottle.type ?? 'rosso';
  document.getElementById('rec-vintage').value = bottle.vintage ?? '';
  document.getElementById('rec-grape').value = bottle.grape_variety ?? '';
  document.getElementById('rec-denomination').value = bottle.denomination ?? '';
  resetNoteComposer();
  pendingImageUrl = undefined;
  pendingBarcode = undefined;
  pendingPhotoFile = undefined;
  document.getElementById('rec-photo-input').value = '';

  const photoWrap = document.getElementById('recognize-photo-wrap');
  const photoImg = document.getElementById('recognize-photo');
  sizeReviewPhoto(photoImg);
  if (bottle.image_url) {
    photoImg.src = bottle.image_url;
    photoWrap.style.display = '';
  } else {
    photoWrap.style.display = 'none';
  }
  document.getElementById('recognize-rawtext').style.display = 'none';

  document.getElementById('recognize-overlay').classList.add('open');
}

function closeRecognizeSheet() {
  document.getElementById('recognize-overlay').classList.remove('open');
}

// Reads the composer's current state and, if anything was actually filled
// in, posts one new tasting note for the given bottle — silently does
// nothing otherwise, since the whole section is optional in every context
// it appears in.
async function maybeSaveNote(bottleId) {
  const text = document.getElementById('rec-note-text').value.trim();
  const starsOn = document.querySelectorAll('#rec-note-stars span.on').length;
  const profile = recognizeTaste ? readTastingProfile(recognizeTaste) : null;
  const profileEmpty = !profile || isTastingProfileEmpty(profile);
  if (!text && starsOn === 0 && profileEmpty) return;
  const rating = starsOn || (text ? 3 : 0);
  try {
    await api.post(`/api/bottles/${bottleId}/notes`, {
      rating,
      text,
      flavorTags: profile?.flavorTags ?? [],
      foodPairings: profile?.foodPairings ?? [],
      tasteAcidity: profile?.tasteAcidity,
      tasteSweetness: profile?.tasteSweetness,
      tasteTannin: profile?.tasteTannin,
      tasteBody: profile?.tasteBody,
      tasteAlcohol: profile?.tasteAlcohol,
      tasteIntensity: profile?.tasteIntensity,
      tasteFinish: profile?.tasteFinish,
    });
  } catch (err) {
    console.error(err);
    await alertModal('Vino salvato, ma il salvataggio della nota di degustazione è fallito.');
  }
}

async function saveRecognizedWine() {
  const name = document.getElementById('rec-name').value.trim();
  if (!name) {
    await alertModal('Il nome del vino è obbligatorio');
    return;
  }
  const producer = document.getElementById('rec-producer').value.trim() || 'Produttore sconosciuto';
  const country = document.getElementById('rec-country').value.trim() || 'Italia';
  const region = document.getElementById('rec-region').value.trim() || undefined;
  const type = document.getElementById('rec-type').value;
  const vintageRaw = document.getElementById('rec-vintage').value.trim();
  const vintage = vintageRaw ? Number(vintageRaw) : undefined;
  const grapeVariety = document.getElementById('rec-grape').value.trim() || undefined;
  const denomination = document.getElementById('rec-denomination').value.trim() || undefined;

  if (sheetMode === 'edit') {
    try {
      await api.patch(`/api/wines/${editingWineId}`, { name, producer, country, region, type, vintage, grapeVariety, denomination });
      closeRecognizeSheet();
      if (pendingPhotoFile) {
        try {
          await uploadBottlePhoto(editingBottleId, pendingPhotoFile);
        } catch (err) {
          console.error(err);
          await alertModal('Vino modificato, ma il caricamento della foto è fallito.');
        }
      }
      editSavedCallback?.();
    } catch (err) {
      console.error(err);
      await alertModal('Impossibile salvare le modifiche: controlla i dati inseriti e riprova.');
    }
    return;
  }

  // imageUrl comes from Open Food Facts, outside user control and outside
  // the review form's editable fields — drop it rather than sending an
  // oversized value the backend will reject (imageUrl is cosmetic, never
  // worth blocking the save over).
  const imageUrl = pendingImageUrl && pendingImageUrl.length <= 200 ? pendingImageUrl : undefined;

  // Quantity first, before anything is created: asking after POST /api/wines
  // meant that Annulla left an orphan wine in the shared catalog (it then
  // showed up in every search). On Annulla the sheet stays open with the
  // form and the tasting note intact.
  const quantity = await askQuantity();
  if (quantity === null) return;

  try {
    const wine = await api.post('/api/wines', { name, producer, country, region, type, vintage, grapeVariety, denomination, imageUrl, barcode: pendingBarcode });
    closeRecognizeSheet();
    await postBottle(wine.id, quantity, async (bottle) => {
      await maybeSaveNote(bottle.id);
      if (pendingPhotoFile) {
        try {
          await uploadBottlePhoto(bottle.id, pendingPhotoFile);
        } catch (err) {
          console.error(err);
          await alertModal('Vino salvato, ma il caricamento della foto è fallito.');
        }
      }
    });
  } catch (err) {
    console.error(err);
    await alertModal('Impossibile aggiungere il vino: controlla i dati inseriti e riprova.');
  }
}

document.getElementById('recognize-close')?.addEventListener('click', closeRecognizeSheet);
// Disabled for the whole save: a second tap while POST /api/wines is in
// flight would create the wine (and the bottle, and the note) twice.
const recognizeSave = document.getElementById('recognize-save');
recognizeSave?.addEventListener('click', async () => {
  if (recognizeSave.disabled) return;
  recognizeSave.disabled = true;
  try {
    await saveRecognizedWine();
  } finally {
    recognizeSave.disabled = false;
  }
});
document.getElementById('rec-photo-pick')?.addEventListener('click', () => document.getElementById('rec-photo-input')?.click());
document.getElementById('rec-photo-input')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  pendingPhotoFile = await compressForUpload(file);
  const photoImg = document.getElementById('recognize-photo');
  sizeReviewPhoto(photoImg);
  photoImg.src = URL.createObjectURL(pendingPhotoFile);
  document.getElementById('recognize-photo-wrap').style.display = '';
});
