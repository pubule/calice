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
  return `
    <div class="result-row" data-wine-id="${id}">
      <div class="result-photo photo ${photoClass(w.type)}"></div>
      <div class="result-body"><div class="name">${name}${vintage}</div><div class="sub">${sub}</div></div>
      <div class="add-btn" data-wine-id="${id}"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></div>
    </div>`;
}

async function addWineToCellar(wineId) {
  const raw = prompt('Quante bottiglie?', '1');
  if (raw === null) return; // user pressed Cancel — abort, don't default to adding 1
  const quantity = Number(raw) || 1;
  await api.post(`/api/cellars/${currentCellarId}/bottles`, { wineId, quantity });
  alert('Aggiunto alla cantina');
}

function wireResults(container) {
  container.querySelectorAll('.add-btn').forEach((btn) =>
    btn.addEventListener('click', () => addWineToCellar(Number(btn.dataset.wineId))),
  );
}

async function runSearch(query) {
  const results = document.getElementById('add-results');
  if (!results) return;
  if (!query) {
    results.innerHTML = '';
    return;
  }
  const wines = await api.get(`/api/wines/search?q=${encodeURIComponent(query)}`);
  results.innerHTML = wines.length ? wines.map(resultRowHtml).join('') : '<p class="sub">Nessun vino trovato</p>';
  wireResults(results);
}

async function runBarcodeScan() {
  if (!('BarcodeDetector' in window)) {
    alert('Scansione barcode non supportata su questo browser, usa la ricerca testuale.');
    return;
  }
  const results = document.getElementById('add-results');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const video = document.createElement('video');
    video.srcObject = stream;
    await video.play();
    const detector = new window.BarcodeDetector();
    const barcodes = await detector.detect(video);
    if (!barcodes.length) {
      alert('Nessun codice a barre rilevato');
      return;
    }
    const wines = await api.get(`/api/wines/search?barcode=${encodeURIComponent(barcodes[0].rawValue)}`);
    if (wines.length) {
      if (results) {
        results.innerHTML = wines.map(resultRowHtml).join('');
        wireResults(results);
      }
      return;
    }
    const suggestion = await api.post('/api/wines/recognize', { barcode: barcodes[0].rawValue });
    openRecognizeSheet(suggestion);
  } catch (err) {
    console.error(err);
    alert('Impossibile accedere alla fotocamera');
  } finally {
    stream?.getTracks().forEach((t) => t.stop());
  }
}

async function runLabelScan() {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const video = document.createElement('video');
    video.srcObject = stream;
    await video.play();
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const photoBase64 = canvas.toDataURL('image/jpeg', 0.7);
    const suggestion = await api.post('/api/wines/recognize', { photoBase64 });
    openRecognizeSheet(suggestion, photoBase64);
  } catch (err) {
    console.error(err);
    alert('Impossibile accedere alla fotocamera');
  } finally {
    stream?.getTracks().forEach((t) => t.stop());
  }
}

let pendingImageUrl;
let pendingBarcode;

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
    rawTextEl.textContent = "Testo letto dall'etichetta: " + suggestion.rawText;
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

  try {
    const wine = await api.post('/api/wines', { name, producer, country, region, type, vintage, grapeVariety, denomination, imageUrl: pendingImageUrl, barcode: pendingBarcode });
    closeRecognizeSheet();
    await addWineToCellar(wine.id);
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
document.getElementById('scan-barcode-tile')?.addEventListener('click', runBarcodeScan);
document.getElementById('scan-label-tile')?.addEventListener('click', runLabelScan);
document.getElementById('manual-add-link')?.addEventListener('click', () => openRecognizeSheet({}));
document.getElementById('recognize-close')?.addEventListener('click', closeRecognizeSheet);
document.getElementById('recognize-save')?.addEventListener('click', saveRecognizedWine);

export async function mountAdd() {
  const cellars = await api.get('/api/cellars');
  currentCellarId = cellars[0].id;

  const searchInput = document.getElementById('add-search-input');
  if (searchInput) searchInput.value = '';
  const results = document.getElementById('add-results');
  if (results) results.innerHTML = '';
}
