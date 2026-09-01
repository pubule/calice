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
  const quantity = Number(prompt('Quante bottiglie?', '1')) || 1;
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
    if (results) {
      results.innerHTML = wines.length ? wines.map(resultRowHtml).join('') : '<p class="sub">Nessun vino trovato per questo codice</p>';
      wireResults(results);
    }
  } catch (err) {
    console.error(err);
    alert('Impossibile accedere alla fotocamera');
  } finally {
    stream?.getTracks().forEach((t) => t.stop());
  }
}

async function runManualAdd() {
  const name = prompt('Nome del vino');
  if (!name) return;
  const producer = prompt('Produttore') || '';
  const country = prompt('Paese', 'Italia') || 'Italia';
  const region = prompt('Regione') || '';
  const type = prompt('Tipo (rosso/bianco/bollicine/rosato)', 'rosso') || 'rosso';
  const wine = await api.post('/api/wines', { name, producer, country, region, type });
  await addWineToCellar(wine.id);
}

// Wired once at module load — mountAdd() re-runs on every visit to #/add, so
// listeners on elements it doesn't re-render (search input, scan tile,
// manual-add link) belong here, not there, to avoid stacking duplicates.
// Mirrors the wireStaticControls() split in screens/cellar.js.
document.getElementById('add-search-input')?.addEventListener('input', (e) => runSearch(e.target.value.trim()));
document.getElementById('scan-barcode-tile')?.addEventListener('click', runBarcodeScan);
document.getElementById('manual-add-link')?.addEventListener('click', runManualAdd);

export async function mountAdd() {
  const cellars = await api.get('/api/cellars');
  currentCellarId = cellars[0].id;

  const searchInput = document.getElementById('add-search-input');
  if (searchInput) searchInput.value = '';
  const results = document.getElementById('add-results');
  if (results) results.innerHTML = '';
}
