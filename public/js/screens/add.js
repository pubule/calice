import { api } from '../api-client.js';
import { escapeHtml, photoClass } from '../util.js';

let currentCellarId = null;

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
  const photo = w.image_url
    ? `<img class="result-photo photo" src="${escapeHtml(w.image_url)}" alt="">`
    : `<div class="result-photo photo ${photoClass(w.type)}"></div>`;
  return `
    <div class="result-row" data-wine-id="${id}">
      ${photo}
      <div class="result-body"><div class="name">${name}${vintage}</div><div class="sub">${sub}</div></div>
      <div class="add-btn" data-wine-id="${id}"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></div>
    </div>`;
}

async function addWineToCellar(wineId) {
  const raw = prompt('Quante bottiglie?', '1');
  if (raw === null) return null; // user pressed Cancel — abort, don't default to adding 1
  const quantity = Number(raw) || 1;
  const bottle = await api.post(`/api/cellars/${currentCellarId}/bottles`, { wineId, quantity });
  alert('Aggiunto alla cantina');
  return bottle;
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

function wireResults(container) {
  container.querySelectorAll('.add-btn').forEach((btn) =>
    btn.addEventListener('click', () => addWineToCellar(Number(btn.dataset.wineId))),
  );
}

// A specific product query (e.g. "Zamuner Riserva del Fondatore") often
// ranks a retailer's page above the producer's own site, so this never
// auto-picks one candidate — it shows up to 3 and lets the user tap the
// right one, same review-before-save principle as the rest of this feature.
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
  const photo = candidate.imageUrl
    ? `<img class="result-photo photo" src="${escapeHtml(candidate.imageUrl)}" alt="">`
    : `<div class="result-photo photo photo-rosso"></div>`;
  return `
    <div class="result-row" data-candidate="${i}">
      ${photo}
      <div class="result-body"><div class="name">${name}</div><div class="sub">${escapeHtml(source)}</div></div>
      <div class="add-btn"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></div>
    </div>`;
}

// Debounced separately from the local (free, instant) catalog search below:
// the web fallback spends from Tavily's 1000-credit/month budget, so it must
// not fire on every keystroke while the user is still typing.
let webSearchTimer;

function currentQuery() {
  return document.getElementById('add-search-input')?.value.trim() ?? '';
}

async function searchWeb(query) {
  const results = document.getElementById('add-results');
  const countEl = document.getElementById('add-results-count');
  if (!results || currentQuery() !== query) return; // superseded by further typing
  let suggestion = { name: query };
  try {
    suggestion = await api.post('/api/wines/recognize', { query });
  } catch (err) {
    console.error(err);
  }
  if (currentQuery() !== query) return; // superseded while the request was in flight

  const candidates = suggestion.candidates ?? [];
  if (!candidates.length) {
    results.innerHTML = `<p class="sub">Nessun risultato sul web per "${escapeHtml(query)}"</p>`;
    if (countEl) countEl.textContent = 'Risultati (0)';
    return;
  }
  results.innerHTML = candidates.map((c, i) => webCandidateRowHtml(c, i)).join('');
  results.querySelectorAll('[data-candidate]').forEach((row) => {
    row.addEventListener('click', () => {
      const c = candidates[Number(row.dataset.candidate)];
      openRecognizeSheet({ name: query, imageUrl: c.imageUrl, sourceUrl: c.sourceUrl, rawText: c.snippet });
    });
  });
  // "Non lo trovi? Aggiungilo manualmente" below the results list already
  // covers picking none of these — no second manual-add link here.
  if (countEl) countEl.textContent = `Risultati (${candidates.length})`;
}

async function runSearch(query) {
  const results = document.getElementById('add-results');
  const countEl = document.getElementById('add-results-count');
  if (!results) return;
  clearTimeout(webSearchTimer);
  if (!query) {
    results.innerHTML = '';
    if (countEl) countEl.textContent = 'Risultati';
    return;
  }
  const wines = await api.get(`/api/wines/search?q=${encodeURIComponent(query)}`);
  if (countEl) countEl.textContent = `Risultati (${wines.length})`;
  if (wines.length) {
    results.innerHTML = wines.map(resultRowHtml).join('');
    wireResults(results);
    return;
  }
  // Local catalog miss: search the web (Tavily) for a real bottle photo,
  // debounced so a still-typing user doesn't spend credits on every
  // intermediate substring.
  results.innerHTML = `<p class="sub">Cerco "${escapeHtml(query)}" sul web <span class="loading-dots"><span></span><span></span><span></span></span></p>`;
  webSearchTimer = setTimeout(() => searchWeb(query), 600);
}

// Shared live viewfinder for both scan flows — the previous version never
// attached the <video> to the page, so the camera stream ran invisibly and
// a photo got snapped automatically a few seconds later with no way to aim
// or retry. This shows the feed for real and lets the user act on it
// (shutter tap for a label, just aiming for a barcode).
let cameraStream;

// Stops the feed but keeps the overlay up in a spinner state — used the
// instant a shot/detection happens, so the user is blocked from poking at
// the app again while the recognize call is still in flight.
function stopCameraStream() {
  cameraStream?.getTracks().forEach((t) => t.stop());
  cameraStream = undefined;
  document.getElementById('camera-overlay')?.classList.add('loading');
}

function closeCamera() {
  stopCameraStream();
  document.getElementById('camera-overlay')?.classList.remove('open', 'loading');
}

async function openCamera(hint) {
  const overlay = document.getElementById('camera-overlay');
  const video = document.getElementById('camera-video');
  const hintEl = document.getElementById('camera-hint');
  if (hintEl) hintEl.textContent = hint;
  overlay?.classList.add('open');
  try {
    // 'ideal' width/height, not a hard 'exact' constraint — the browser
    // still picks a supported resolution if the device can't do 1080p, it
    // just aims high. A curved barcode wrapped around a bottle needs the
    // extra detail low-res video (often 640x480 by default) loses.
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
  } catch (err) {
    overlay?.classList.remove('open');
    throw err;
  }
  video.srcObject = cameraStream;
  await video.play();
  return video;
}

// window.BarcodeDetector is always present now — index.html installs the
// zbar-wasm-backed polyfill for any browser missing the native API (Safari
// never shipped it). Polls detect() in a loop until a code is found or the
// user closes the camera.
function scanBarcode(video) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    document.getElementById('camera-close')?.addEventListener('click', () => finish(undefined), { once: true });

    const detector = new window.BarcodeDetector();
    (async () => {
      while (!settled) {
        try {
          const barcodes = await detector.detect(video);
          if (barcodes.length) {
            finish(barcodes[0].rawValue);
            return;
          }
        } catch (err) {
          console.error(err);
        }
        if (settled) return;
        await new Promise((r) => setTimeout(r, 350));
      }
    })();
  });
}

async function runBarcodeScan() {
  if (!('BarcodeDetector' in window)) {
    alert('Scansione barcode non supportata su questo browser, usa la ricerca testuale.');
    return;
  }
  document.getElementById('camera-shutter-wrap')?.classList.add('hidden'); // continuous auto-detect, no shutter
  let video;
  try {
    video = await openCamera('Inquadra il codice a barre da vicino, più dritto possibile');
  } catch (err) {
    console.error(err);
    alert('Impossibile accedere alla fotocamera');
    return;
  }

  const barcodeValue = await scanBarcode(video);
  if (!barcodeValue) {
    closeCamera(); // user closed the camera without a match
    return;
  }
  stopCameraStream(); // got a match — spinner up, block the user until data's ready

  const results = document.getElementById('add-results');
  try {
    const wines = await api.get(`/api/wines/search?barcode=${encodeURIComponent(barcodeValue)}`);
    if (wines.length) {
      closeCamera();
      if (results) {
        results.innerHTML = wines.map(resultRowHtml).join('');
        wireResults(results);
      }
      return;
    }
    const suggestion = await api.post('/api/wines/recognize', { barcode: barcodeValue });
    closeCamera();

    // Local + Open Food Facts both missed: no trustworthy name to prefill
    // (a barcode number isn't one) — fall back to Tavily candidates, same
    // review-before-save picker as the text-search miss, keeping the
    // barcode attached so it still gets saved once the user confirms.
    const candidates = suggestion.candidates ?? [];
    if (!suggestion.name && candidates.length) {
      if (results) {
        results.innerHTML = candidates.map((c, i) => webCandidateRowHtml(c, i)).join('');
        results.querySelectorAll('[data-candidate]').forEach((row) => {
          row.addEventListener('click', () => {
            const c = candidates[Number(row.dataset.candidate)];
            openRecognizeSheet({ name: c.title, imageUrl: c.imageUrl, sourceUrl: c.sourceUrl, rawText: c.snippet, barcode: barcodeValue });
          });
        });
        const countEl = document.getElementById('add-results-count');
        if (countEl) countEl.textContent = `Risultati (${candidates.length})`;
      }
      return;
    }

    openRecognizeSheet(suggestion);
  } catch (err) {
    console.error(err);
    closeCamera();
    alert('Errore durante la ricerca del codice a barre');
  }
}

async function runLabelScan() {
  document.getElementById('camera-shutter-wrap')?.classList.remove('hidden');
  let video;
  try {
    video = await openCamera("Inquadra l'etichetta e scatta");
  } catch (err) {
    console.error(err);
    alert('Impossibile accedere alla fotocamera');
    return;
  }

  const photoBase64 = await new Promise((resolve) => {
    document.getElementById('camera-shutter')?.addEventListener('click', () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    }, { once: true });
    document.getElementById('camera-close')?.addEventListener('click', () => resolve(null), { once: true });
  });
  if (!photoBase64) {
    closeCamera(); // user closed the camera without shooting
    return;
  }
  stopCameraStream(); // shot taken — spinner up, block the user until data's ready

  try {
    const suggestion = await api.post('/api/wines/recognize', { photoBase64 });
    closeCamera();
    openRecognizeSheet(suggestion, photoBase64);
  } catch (err) {
    console.error(err);
    closeCamera();
    alert("Errore durante il riconoscimento dell'etichetta");
  }
}

let pendingImageUrl;
let pendingBarcode;
let pendingPhotoFile;

function openRecognizeSheet(suggestion, capturedPhotoDataUrl) {
  document.getElementById('rec-name').value = suggestion.name ?? '';
  document.getElementById('rec-producer').value = suggestion.producer ?? '';
  document.getElementById('rec-country').value = suggestion.country ?? 'Italia';
  document.getElementById('rec-region').value = suggestion.region ?? '';
  document.getElementById('rec-type').value = suggestion.type ?? 'rosso';
  document.getElementById('rec-vintage').value = suggestion.vintage ?? '';
  document.getElementById('rec-grape').value = suggestion.grapeVariety ?? '';
  document.getElementById('rec-denomination').value = suggestion.denomination ?? '';
  pendingImageUrl = suggestion.imageUrl;
  pendingBarcode = suggestion.barcode;
  pendingPhotoFile = undefined;
  document.getElementById('rec-photo-input').value = '';

  const photoWrap = document.getElementById('recognize-photo-wrap');
  const photoImg = document.getElementById('recognize-photo');
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

function closeRecognizeSheet() {
  document.getElementById('recognize-overlay').classList.remove('open');
}

async function saveRecognizedWine() {
  const name = document.getElementById('rec-name').value.trim();
  if (!name) {
    alert('Il nome del vino è obbligatorio');
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

  // imageUrl comes from Open Food Facts, outside user control and outside
  // the review form's editable fields — drop it rather than sending an
  // oversized value the backend will reject (imageUrl is cosmetic, never
  // worth blocking the save over).
  const imageUrl = pendingImageUrl && pendingImageUrl.length <= 200 ? pendingImageUrl : undefined;

  try {
    const wine = await api.post('/api/wines', { name, producer, country, region, type, vintage, grapeVariety, denomination, imageUrl, barcode: pendingBarcode });
    closeRecognizeSheet();
    const bottle = await addWineToCellar(wine.id);
    if (bottle && pendingPhotoFile) {
      try {
        await uploadBottlePhoto(bottle.id, pendingPhotoFile);
      } catch (err) {
        console.error(err);
        alert('Vino salvato, ma il caricamento della foto è fallito.');
      }
    }
  } catch (err) {
    console.error(err);
    alert('Impossibile aggiungere il vino: controlla i dati inseriti e riprova.');
  }
}

// Wired once at module load — mountAdd() re-runs on every visit to #/add, so
// listeners on elements it doesn't re-render (search input, scan tile,
// manual-add link) belong here, not there, to avoid stacking duplicates.
// Mirrors the wireStaticControls() split in screens/cellar.js.
document.getElementById('add-search-input')?.addEventListener('input', (e) => runSearch(e.target.value.trim()));
// Navbar hide-while-keyboard-open is handled globally in main.js via
// visualViewport (covers every input, not just this one).
document.getElementById('scan-barcode-tile')?.addEventListener('click', runBarcodeScan);
document.getElementById('scan-label-tile')?.addEventListener('click', runLabelScan);
document.getElementById('camera-close')?.addEventListener('click', closeCamera);
document.getElementById('manual-add-link')?.addEventListener('click', () => openRecognizeSheet({}));
document.getElementById('recognize-close')?.addEventListener('click', closeRecognizeSheet);
document.getElementById('recognize-save')?.addEventListener('click', saveRecognizedWine);
document.getElementById('rec-photo-pick')?.addEventListener('click', () => document.getElementById('rec-photo-input')?.click());
document.getElementById('rec-photo-input')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  pendingPhotoFile = await compressForUpload(file);
  document.getElementById('recognize-photo').src = URL.createObjectURL(pendingPhotoFile);
  document.getElementById('recognize-photo-wrap').style.display = '';
});

export async function mountAdd() {
  const cellars = await api.get('/api/cellars');
  currentCellarId = cellars[0].id;

  const searchInput = document.getElementById('add-search-input');
  if (searchInput) searchInput.value = '';
  const results = document.getElementById('add-results');
  if (results) results.innerHTML = '';
  const countEl = document.getElementById('add-results-count');
  if (countEl) countEl.textContent = 'Risultati';
}
