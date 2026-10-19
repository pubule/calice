import { api } from '../api-client.js';
import { escapeHtml, photoClass, priceText } from '../util.js';
import { estimatedWindow } from '../drink-window.js';
import { alertModal, promptModal, pasteModal, quantityModal } from '../modal.js';
import { MAX_QUANTITY, WHOLE_NUMBER_ATTRS, parseDecimal, parsePrice, PRICE_ERROR, parseVintage, VINTAGE_ERROR, parseQuantity, quantityError, quantityStepperHtml, wireQuantitySteppers, parseDisgorged, DISGORGED_HINT } from '../fields.js';
import { showToast } from '../toast.js';
import { tastingProfileHtml, wireTastingProfile, resetTastingProfile, readTastingProfile, setTastingProfile, isTastingProfileEmpty, TASTE_AXES } from '../tasting-profile.js';
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

const ICON_CAM = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7l1.8-2.5h4.4L16 7"/><circle cx="12" cy="13.5" r="3.2"/></svg>';
const ICON_BAR = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 6v12M7 6v12M10 6v12M14 6v12M17 6v12M20 6v12"/></svg>';
const ICON_CLOCK = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>';

function photoTag(imageUrl, type) {
  return imageUrl
    ? `<img class="result-photo photo product" src="${escapeHtml(imageUrl)}" alt="">`
    : `<div class="result-photo photo ${photoClass(type)}"></div>`;
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
      ${tasting?.note
    ? `<button type="button" class="choose-btn" data-choose="${escapeHtml(b.id)}" aria-label="Scegli ${name}${vintage} per il tuo assaggio">Scegli</button>`
    : `<button type="button" class="plus1-btn" data-plus1="${escapeHtml(b.id)}" aria-label="Aggiungi una bottiglia di ${name}${vintage}">+1</button>`}
    </div>`;
}

const ICON_CHEV = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
const TYPE_LABEL = { rosso: 'Rosso', bianco: 'Bianco', bollicine: 'Bollicine', rosato: 'Rosato' };

// A wine the user can add, from the shared catalog or from Vivino, in one
// shape. Catalog rows come from the wines table and Vivino rows from an
// unofficial index: every field is attacker-controlled and escaped on output.
function catalogPick(w) {
  return {
    key: `c${w.id}`, wineId: w.id, name: w.name, producer: w.producer, vintage: w.vintage,
    type: w.type, country: w.country, region: w.region, denomination: w.denomination, grape: w.grape_variety, image: w.image_url,
    alcohol: w.alcohol, producerUrl: w.producer_url,
    rating: w.vivino_rating ? { average: w.vivino_rating, count: w.vivino_ratings_count } : undefined,
  };
}
function webPick(c, i) {
  const pre = completeFromAtlas(c.prefill) ?? {};
  return {
    key: `w${i}`, wineId: null, name: pre.name ?? c.title ?? '', title: c.title, producer: pre.producer,
    type: pre.type, country: pre.country, region: pre.region, denomination: pre.denomination, grape: pre.grapeVariety,
    image: c.imageUrl, sourceUrl: c.sourceUrl, snippet: c.snippet, rating: c.rating, vintageRatings: c.vintageRatings,
    alcohol: pre.alcohol, producerUrl: pre.producerUrl,
  };
}

// Vivino's rating for the chosen vintage when that year has enough ratings,
// otherwise the wine's overall one.
function ratingFor(w, vintage) {
  const year = String(vintage ?? '').trim();
  const r = year && w.vintageRatings?.[year];
  return r ? { ...r, year } : w.rating;
}

const alcoholLabel = (a) => (a ? `${String(a).replace('.', ',')}% vol` : null);

// Tapping a result opens it in place (the user's choice among three mockups,
// over a second sheet): what will be saved, the vintage, how many bottles,
// one button. The long form stays behind "Modifica tutti i dati".
let expanded = null; // { key, qty, vintage } — survives re-renders of the list

function pickRowHtml(w) {
  const open = expanded?.key === w.key;
  const name = escapeHtml(w.name);
  const vintage = w.vintage ? ' ' + escapeHtml(w.vintage) : '';
  const where = w.denomination || w.region || w.country;
  const base = [w.producer, where].filter(Boolean).map(escapeHtml).join(' · ') || (w.wineId ? '' : 'Vivino');
  const sub = isWished(w) ? `${base}${base ? ' · ' : ''}♡ nei desideri` : base;
  return `
    <div class="result-item${open ? ' open' : ''}" data-key="${escapeHtml(w.key)}">
      <div class="result-row" data-expand role="button" tabindex="0" aria-expanded="${open}">
        ${photoTag(w.image, w.type ?? 'rosso')}
        <div class="result-body"><div class="name">${name}${vintage}</div><div class="sub">${sub}</div></div>
        <span class="result-chev">${ICON_CHEV}</span>
      </div>
      ${open ? pickPanelHtml(w) : ''}
    </div>`;
}

// Vivino's community rating, e.g. "Vivino ★ 3,8 · 475 voti".
function vivinoLabel(r) {
  if (!r?.average) return null;
  return `Vivino${r.year ? ' ' + r.year : ''} ★ ${r.average.toFixed(1).replace('.', ',')} · ${r.count.toLocaleString('it-IT')} ${r.count === 1 ? 'voto' : 'voti'}`;
}

function pickPanelHtml(w) {
  const facts = [TYPE_LABEL[w.type], w.denomination && w.region ? w.region : null, w.grape, alcoholLabel(w.alcohol)].filter(Boolean);
  const vivino = vivinoLabel(ratingFor(w, expanded.vintage));
  // Always editable, starting from the wine's own vintage: another year of a
  // wine already in the catalog is added as that year (see ensureWine).
  const vintageField = `
      <div class="exp-row"><label for="exp-vintage">Annata</label><input id="exp-vintage" class="search exp-vintage" ${WHOLE_NUMBER_ATTRS} maxlength="4" placeholder="es. 2019" value="${escapeHtml(expanded.vintage ?? '')}"></div>`;
  // Sparkling wines: when it was disgorged (from the label), the best guide
  // to when to drink it. Same field as in the full sheet.
  const disgorgedField = w.type === 'bollicine' ? `
      <div class="exp-row"><label for="exp-disgorged">Sboccatura</label><input id="exp-disgorged" class="search exp-disgorged" type="month" value="${escapeHtml(expanded.disgorged ?? '')}" aria-describedby="exp-disgorged-hint"></div>
      <p class="exp-hint" id="exp-disgorged-hint">${DISGORGED_HINT}</p>` : '';
  return `
    <div class="result-exp">
      ${facts.length || vivino ? `<div class="exp-facts">${facts.map((f) => `<span>${escapeHtml(f)}</span>`).join('')}${vivino ? `<span data-vivino>${escapeHtml(vivino)}</span>` : ''}</div>` : '<p class="exp-note">Da Vivino arriva solo il nome: gli altri dati li puoi aggiungere con "Modifica tutti i dati".</p>'}
      ${vintageField}
      ${expanded.mode === 'wish' ? `
      <div class="exp-row"><label for="exp-price">Prezzo obiettivo</label><div class="affix-field exp-price"><input id="exp-price" type="text" inputmode="decimal" autocomplete="off" placeholder="es. 18,50" value="${escapeHtml(expanded.price ?? '')}"><span aria-hidden="true">€</span></div></div>
      <p class="exp-hint">A quanto vale la pena comprarlo.</p>
      <button type="button" class="exp-add" data-wish>Aggiungi ai desideri</button>
      <button type="button" class="exp-edit" data-tocellar>Aggiungi alla cantina invece</button>` : `
      ${disgorgedField}
      <div class="exp-row"><label for="exp-qty">Bottiglie</label>${quantityStepperHtml({ id: 'exp-qty', value: expanded.qty })}</div>
      <div class="exp-row"><label for="exp-paid">Prezzo a bottiglia</label><div class="affix-field exp-price"><input id="exp-paid" type="text" inputmode="decimal" autocomplete="off" placeholder="es. 18,50" value="${escapeHtml(expanded.paid ?? '')}"><span aria-hidden="true">€</span></div></div>
      <button type="button" class="exp-add" data-confirm>Aggiungi alla cantina</button>
      <div class="exp-links"><button type="button" class="exp-edit" data-towish>${isWished(w) ? '♡ Cambia il prezzo obiettivo' : '♡ Metti nei desideri'}</button><button type="button" class="exp-edit" data-edit>Modifica tutti i dati</button></div>`}
    </div>`;
}

const groupLabel = (title, count) => `<div class="add-group-lbl">${title}${count == null ? '' : ` <span>${count}</span>`}</div>`;
const MANUAL_HTML = '<button type="button" class="add-manual" data-manual>Non lo trovi? Aggiungilo a mano</button>';

// null = the user pressed Annulla: abort, don't default to adding 1.
function askQuantity() {
  return quantityModal({ title: 'Aggiungi alla cantina', message: 'Quante bottiglie?', value: 1, min: 1 });
}

// `finish` runs before the sheet closes (tasting note, photo upload), so the
// screen underneath redraws with everything already saved.
async function postBottle(wineId, quantity, finish, pricePaid, disgorgedAt) {
  if (!currentCellarId) await (cellarLoad ?? loadCellar());
  const bottle = await api.post(`/api/cellars/${currentCellarId}/bottles`, { wineId, quantity, pricePaid: pricePaid ?? undefined, disgorgedAt: disgorgedAt ?? undefined });
  changed = true;
  // A pending tasting's note goes on the new bottle; the full sheet saves its
  // own composer instead (prefilled with the tasting, see openRecognizeSheet).
  if (tasting?.note && !finish) await saveTastingNote(bottle.id);
  await finish?.(bottle);
  const placed = tasting;
  closeAddSheet();
  showToast(placed?.note ? 'Aggiunto alla cantina con la tua nota' : quantity > 1 ? `Aggiunte ${quantity} bottiglie alla cantina` : 'Aggiunto alla cantina');
  placed?.done?.({ kind: 'cellar', bottle });
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
// Same folding as the catalog search on the Worker (foldSearch in wines.ts).
const foldText = (t) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’‘`´]/g, "'").toLowerCase().trim();

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
  // Vivino now sends the class too ("Franciacorta DOCG"); the atlas is keyed
  // by the bare name.
  const wanted = foldText(prefill.denomination).replace(/\s+(docg|doc|igt|igp|aoc|aop|doca|doq|do)$/, '');
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

// Same wine already listed higher up (in the cellar, or in the catalog):
// Vivino often returns it again under "<producer> <name>".
function wineKeys(producer, name) {
  const keys = [foldText(`${producer ?? ''} ${name ?? ''}`)];
  if (producer && foldText(name).startsWith(foldText(producer))) keys.push(foldText(name));
  return keys;
}

let shownPicks = new Map(); // key -> pick currently on screen

function renderResults(query) {
  const words = foldText(query).split(/\s+/).filter(Boolean);
  const mine = cellarBottles.filter((b) => matchesCellar(b, words));
  const mineIds = new Set(cellarBottles.map((b) => String(b.wine_id)));
  const catalog = (lastCatalog ?? []).filter((w) => !mineIds.has(String(w.id))).map(catalogPick);
  const known = new Set([...cellarBottles, ...(lastCatalog ?? [])].flatMap((w) => wineKeys(w.producer, w.name)));
  const web = (lastWeb ?? []).map(webPick).filter((w) => !known.has(foldText(w.title)) && !wineKeys(w.producer, w.name).some((k) => known.has(k)));
  shownPicks = new Map([...catalog, ...web].map((w) => [w.key, w]));
  if (expanded && !shownPicks.has(expanded.key)) expanded = null;
  let html = '';
  if (mine.length) html += `${groupLabel('Nella tua cantina', mine.length)}<div class="add-group">${mine.map(mineRowHtml).join('')}</div>`;
  if (catalog.length) html += `${groupLabel('Catalogo', catalog.length)}<div class="add-group">${catalog.map(pickRowHtml).join('')}</div>`;
  if (lastWeb === null) {
    html += `${groupLabel('Da Vivino', 'cerco…')}<div class="add-group" aria-hidden="true"><div class="add-skel"></div><div class="add-skel"></div></div>`;
  } else if (web.length) {
    html += `${groupLabel('Da Vivino', web.length)}<div class="add-group">${web.map(pickRowHtml).join('')}</div>`;
  } else {
    html += `${groupLabel('Da Vivino', 0)}<p class="add-empty">Nessun altro risultato su Vivino per "${escapeHtml(query)}"</p>`;
  }
  results.innerHTML = html + MANUAL_HTML;
}

// The panel's "Aggiungi alla cantina": a catalog wine is added as it is; a
// Vivino one is created first (POST /api/wines dedupes on name, producer and
// vintage, so the same wine is never stored twice).
// The vintage in the open panel: empty = none; undefined when not a year.
function panelVintage() {
  const r = parseVintage(expanded?.vintage);
  return r.invalid ? undefined : r.value;
}

async function confirmPick(w, button) {
  const qty = parseQuantity(expanded?.qty, 1);
  const vintage = panelVintage();
  if (vintage === undefined) {
    await alertModal(VINTAGE_ERROR);
    return;
  }
  if (qty.invalid || qty.value == null) {
    await alertModal(quantityError(1));
    return;
  }
  const paid = parsePrice(expanded?.paid);
  if (paid.invalid) {
    await alertModal(PRICE_ERROR);
    return;
  }
  const disgorged = w.type === 'bollicine' ? parseDisgorged(expanded?.disgorged) : null;
  button.disabled = true;
  try {
    const wineId = await ensureWine(w, vintage);
    rememberSearch(currentQuery());
    expanded = null;
    await postBottle(wineId, qty.value, undefined, paid.value, disgorged);
  } catch (err) {
    console.error(err);
    await alertModal('Impossibile aggiungere il vino, riprova.');
  } finally {
    button.disabled = false;
  }
}

// The wine's id in the catalog, creating it first for a Vivino result
// (POST /api/wines dedupes, so the same wine is never stored twice).
async function ensureWine(w, vintage) {
  if (w.wineId) {
    if ((w.vintage ?? null) === (vintage ?? null)) return w.wineId;
    // Another year of a catalog wine: that vintage's wine (copied if new).
    return (await api.post(`/api/wines/${w.wineId}/vintage`, { vintage: vintage ?? null })).id;
  }
  const imageUrl = w.image && w.image.length <= 200 ? w.image : undefined;
  const wine = await api.post('/api/wines', {
    name: w.name, producer: w.producer || 'Produttore sconosciuto', country: w.country || 'Italia',
    region: w.region || undefined, type: SHEET_TYPES.has(w.type) ? w.type : 'rosso', vintage: vintage ?? undefined,
    grapeVariety: w.grape || undefined, denomination: w.denomination || undefined, imageUrl,
    vivinoRating: ratingFor(w, vintage)?.average, vivinoRatingsCount: ratingFor(w, vintage)?.count,
    alcohol: w.alcohol || undefined, producerUrl: w.producerUrl || undefined,
  });
  return wine.id;
}

// ---- wishlist: "Metti nei desideri" from an opened result ----
let wishedWineIds = new Set(); // wines already in this cellar's wishlist
let wishedKeys = new Set(); // results wished during this sheet session (Vivino ones have no id yet)
const isWished = (w) => wishedKeys.has(w.key) || (w.wineId != null && wishedWineIds.has(Number(w.wineId)));

async function loadWishlist() {
  try {
    if (!currentCellarId) await (cellarLoad ?? loadCellar());
    const list = await api.get(`/api/cellars/${currentCellarId}/wishlist`);
    wishedWineIds = new Set(list.map((x) => Number(x.wine_id)));
  } catch (err) {
    console.error(err);
  }
}

// The sheet stays open (the user may go on searching); the row shows it.
async function confirmWish(w, button) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Aggiungo…';
  try {
    const vintage = panelVintage();
    if (vintage === undefined) {
      await alertModal("L'annata deve essere un anno, per esempio 2019.");
      return;
    }
    const target = parsePrice(expanded?.price);
    if (target.invalid) {
      await alertModal(PRICE_ERROR);
      return;
    }
    const price = target.value;
    if (!currentCellarId) await (cellarLoad ?? loadCellar());
    const wineId = await ensureWine(w, vintage);
    await api.post(`/api/cellars/${currentCellarId}/wishlist`, { wineId, targetPrice: price ?? undefined, note: tasting?.note ?? undefined });
    if (tasting) {
      finishWish();
      return;
    }
    wishedKeys.add(w.key);
    wishedWineIds.add(Number(wineId));
    changed = true;
    rememberSearch(currentQuery());
    expanded = null;
    renderResults(currentQuery());
    const euro = price != null ? priceText(price) : null;
    showToast(euro ? `Nei desideri, obiettivo ${euro} €` : 'Aggiunto ai desideri');
  } catch (err) {
    console.error(err);
    // The reason is shown, not only "riprova": a silent failure here once
    // could not be told apart from a tap that never arrived.
    await alertModal(`Impossibile aggiungere ai desideri, riprova.\n(${err?.message ?? err})`);
  } finally {
    if (button.isConnected) {
      button.disabled = false;
      button.textContent = label;
    }
  }
}

function editPick(w) {
  rememberSearch(currentQuery());
  const vintage = panelVintage() ?? undefined;
  openRecognizeSheet({
    name: w.name, producer: w.producer, country: w.country, region: w.region, type: SHEET_TYPES.has(w.type) ? w.type : undefined,
    vintage, grapeVariety: w.grape, denomination: w.denomination, imageUrl: w.image, sourceUrl: w.sourceUrl, rawText: w.snippet,
    rating: w.rating, vintageRatings: w.vintageRatings, alcohol: w.alcohol, producerUrl: w.producerUrl,
    quantity: parseQuantity(expanded?.qty, 1).value ?? 1, price: parsePrice(expanded?.paid).value ?? undefined,
    disgorgedAt: parseDisgorged(expanded?.disgorged) ?? undefined,
  });
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
  expanded = null;
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

// ---- a guided tasting being placed (tasting.js), or a wish being bought ----
// `tasting.note` (a note body, as POST /api/bottles/:id/notes takes it) goes
// on the wine the user picks: as the note of the bottle added to the cellar,
// or kept with the wish. `mode` is where a picked result goes by default;
// `done` runs once the wine is placed. Forgotten when the sheet closes.
let tasting = null;

async function saveTastingNote(bottleId) {
  try {
    await api.post(`/api/bottles/${bottleId}/notes`, tasting.note);
  } catch (err) {
    console.error(err);
    await alertModal("Vino aggiunto, ma la nota dell'assaggio non è stata salvata.");
  }
}

function finishWish() {
  const placed = tasting;
  changed = true;
  closeAddSheet();
  showToast(placed?.note ? 'Nei desideri con la tua nota' : 'Aggiunto ai desideri');
  placed?.done?.({ kind: 'wish' });
}

// "Scegli" on a wine already in the cellar: the note goes on it (no extra
// bottle), or the wine goes in the wishlist with the note.
async function chooseMine(bottleId) {
  const b = cellarBottles.find((x) => String(x.id) === String(bottleId));
  if (!b || !tasting) return;
  try {
    if (tasting.mode === 'wish') {
      await api.post(`/api/cellars/${currentCellarId}/wishlist`, { wineId: b.wine_id, note: tasting.note });
      finishWish();
      return;
    }
    await api.post(`/api/bottles/${b.id}/notes`, tasting.note);
  } catch (err) {
    console.error(err);
    await alertModal('Non è stato possibile salvare la nota, riprova.');
    return;
  }
  const placed = tasting;
  changed = true;
  closeAddSheet();
  showToast(`Nota aggiunta a ${b.name}`);
  placed.done?.({ kind: 'cellar', bottle: b });
}

async function wishWineId(wineId) {
  try {
    if (!currentCellarId) await (cellarLoad ?? loadCellar());
    await api.post(`/api/cellars/${currentCellarId}/wishlist`, { wineId, note: tasting?.note ?? undefined });
    finishWish();
  } catch (err) {
    console.error(err);
    await alertModal('Impossibile aggiungere ai desideri, riprova.');
  }
}

function showPlacing() {
  const title = document.getElementById('add-title');
  const note = document.getElementById('add-tasting-note');
  if (title) title.textContent = !tasting ? 'Aggiungi un vino' : tasting.title ?? (tasting.mode === 'wish' ? 'Aggiungi ai desideri' : 'Aggiungi alla cantina');
  if (!note) return;
  const n = tasting?.note;
  note.classList.toggle('hidden', !n);
  if (!n) return;
  const parts = [n.rating ? `★ ${String(n.rating).replace('.', ',')}` : null, n.flavorTags?.length ? `${n.flavorTags.length} aromi` : null, n.foodPairings?.length ? `${n.foodPairings.length} abbinamenti` : null].filter(Boolean);
  note.querySelector('span').textContent = `Il tuo assaggio${parts.length ? ` (${parts.join(', ')})` : ''} diventerà la nota del vino che scegli.`;
}

// "Comprato: sposta in cantina" on a wish (cellar.js): the sheet opens on
// that wine's panel, ready to add; its note, if any, goes with it.
export function openAddSheetForWine(wine, { note = null, done } = {}) {
  openAddSheet({ focus: false, tasting: { note, mode: 'cellar', title: 'Sposta in cantina', done } });
  const pick = catalogPick(wine);
  input.value = wine.name;
  lastCatalog = [wine];
  lastWeb = [];
  expanded = { key: pick.key, qty: 1, vintage: pick.vintage ? String(pick.vintage) : '', mode: 'cellar', price: '' };
  renderResults(currentQuery());
}

export function openAddSheet({ focus = true, query = '', tasting: placing = null } = {}) {
  if (!overlay) return;
  if (input) input.value = '';
  expanded = null;
  wishedKeys = new Set();
  lastCatalog = null;
  lastWeb = null;
  changed = false;
  tasting = placing;
  showPlacing();
  renderIdle();
  overlay.classList.add('open');
  // Synchronously, inside the tap: iOS only raises the keyboard for a focus
  // that happens in the user's own gesture.
  if (focus) input?.focus({ preventScroll: true });
  loadCellar().then(() => { if (overlay.classList.contains('open') && !currentQuery()) renderIdle(); }, () => {});
  loadWishlist();
  if (query) {
    input.value = query;
    runSearch();
  }
}

function closeAddSheet() {
  if (!overlay?.classList.contains('open')) return;
  clearTimeout(webTimer);
  input?.blur();
  overlay.classList.remove('open');
  tasting = null;
  showPlacing();
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

results?.addEventListener('click', (e) => handleResultsTap(e.target));

function handleResultsTap(t) {
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
  const choose = t.closest('[data-choose]');
  if (choose) {
    chooseMine(choose.dataset.choose);
    return;
  }
  const plus = t.closest('[data-plus1]');
  if (plus) {
    plusOne(plus.dataset.plus1);
    return;
  }
  const item = t.closest('.result-item');
  const pick = item && shownPicks.get(item.dataset.key);
  if (!pick) return;
  const step = t.closest('[data-qty-step]');
  if (step) {
    const input = item.querySelector('#exp-qty');
    const current = parseQuantity(input.value, 1).value ?? 1;
    expanded.qty = Math.min(MAX_QUANTITY, Math.max(1, current + Number(step.dataset.qtyStep)));
    input.value = String(expanded.qty);
    return;
  }
  if (t.closest('[data-confirm]')) {
    confirmPick(pick, t.closest('[data-confirm]'));
    return;
  }
  if (t.closest('[data-wish]')) {
    confirmWish(pick, t.closest('[data-wish]'));
    return;
  }
  const modeSwitch = t.closest('[data-towish], [data-tocellar]');
  if (modeSwitch) {
    expanded.mode = modeSwitch.hasAttribute('data-towish') ? 'wish' : 'cellar';
    // No automatic focus on the price: it is optional, and the keyboard would
    // cover the button.
    renderResults(currentQuery());
    return;
  }
  if (t.closest('[data-edit]')) {
    editPick(pick);
    return;
  }
  if (t.closest('[data-expand]')) {
    expanded = expanded?.key === pick.key ? null : { key: pick.key, qty: 1, vintage: pick.vintage ? String(pick.vintage) : '', mode: tasting?.mode === 'wish' ? 'wish' : 'cellar', price: '' };
    renderResults(currentQuery());
    const opened = expanded && results.querySelector(`.result-item[data-key="${CSS.escape(pick.key)}"]`);
    // Scroll the results list only: scrollIntoView would also move the sheet
    // itself (overflow:hidden is still scrollable) and hide its header.
    if (opened) {
      const box = results.getBoundingClientRect();
      const r = opened.getBoundingClientRect();
      const delta = r.bottom > box.bottom - 12 ? Math.min(r.bottom - box.bottom + 12, r.top - box.top - 8) : 0;
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (delta > 0) results.scrollBy({ top: delta, behavior: reduce ? 'auto' : 'smooth' });
    }
  }
}

// Panel buttons act on the touch itself (pointerup) as well as on the click
// Safari synthesizes after it: on the iPhone a tap on "Aggiungi ai desideri"
// produced no click at all (build 119; Chromium fine). One action per tap:
// the click that follows a handled touch is ignored. A touch that turned into
// a scroll gets pointercancel, never pointerup, so scrolling never triggers.
let lastTouchAction = 0;
let touchStart = null;
results?.addEventListener('pointerdown', (e) => {
  touchStart = e.pointerType === 'touch' ? { x: e.clientX, y: e.clientY } : null;
});
results?.addEventListener('pointerup', (e) => {
  if (e.pointerType !== 'touch' || !touchStart) return;
  const moved = Math.hypot(e.clientX - touchStart.x, e.clientY - touchStart.y);
  touchStart = null;
  if (moved > 10 || !e.target.closest('.result-exp button')) return;
  lastTouchAction = Date.now();
  handleResultsTap(e.target);
  const field = document.activeElement;
  if (field?.closest?.('.result-exp') && field.matches('input')) setTimeout(() => field.blur(), 0);
});
results?.addEventListener('click', (e) => {
  if (e.target.closest('.result-exp button') && Date.now() - lastTouchAction < 800) {
    e.stopImmediatePropagation();
  }
}, true);

// A tap on a panel button while its field still has the keyboard up (the
// price, the vintage): on iOS the tap first takes the focus away, the keyboard
// closes and the sheet changes height, so the button moves before the click
// lands and nothing happens (seen on build 119 with "Aggiungi ai desideri").
// Keeping the focus where it is during the tap keeps the layout still; the
// keyboard is closed right after, once the click has been delivered.
results?.addEventListener('mousedown', (e) => {
  const field = document.activeElement;
  if (field?.closest?.('.result-exp') && e.target.closest('.result-exp button')) e.preventDefault();
});
results?.addEventListener('click', (e) => {
  if (e.target.closest('.result-exp button')) {
    const field = document.activeElement;
    if (field?.closest?.('.result-exp') && field.matches('input')) setTimeout(() => field.blur(), 0);
  }
});
results?.addEventListener('input', (e) => {
  if (!expanded) return;
  if (e.target.id === 'exp-price') {
    expanded.price = e.target.value;
    return;
  }
  if (e.target.id === 'exp-paid') {
    expanded.paid = e.target.value;
    return;
  }
  if (e.target.id === 'exp-disgorged') {
    expanded.disgorged = e.target.value;
    return;
  }
  if (e.target.id === 'exp-qty') {
    e.target.value = e.target.value.replace(/\D/g, '');
    expanded.qty = e.target.value;
    return;
  }
  if (e.target.id !== 'exp-vintage') return;
  e.target.value = e.target.value.replace(/\D/g, '');
  expanded.vintage = e.target.value;
  // The Vivino chip follows the typed year (that vintage's rating, if any).
  const pick = shownPicks.get(expanded.key);
  const chip = e.target.closest('.result-item')?.querySelector('[data-vivino]');
  const label = pick && vivinoLabel(ratingFor(pick, expanded.vintage));
  if (chip && label) chip.textContent = label;
});

results?.addEventListener('change', (e) => {
  if (e.target.id === 'exp-disgorged' && expanded) expanded.disgorged = e.target.value;
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
        primary: tasting?.mode === 'wish' ? 'Aggiungi ai desideri' : 'Aggiungi alla cantina',
        photo: w.image_url,
        type: w.type,
        action: async () => {
          closeViewfinder();
          if (!currentCellarId) await loadCellar();
          if (tasting?.mode === 'wish') wishWineId(w.id);
          else addWineToCellar(w.id);
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
let pendingVivino; // Vivino's ratings for the wine the sheet was opened with: { rating, vintageRatings }
let vivinoFieldStart = ''; // what the Vivino field showed when the sheet opened

// Numbers typed with a comma or a dot ("12,5"); '' means "none".
const decimalText = (n) => (n == null || n === '' ? '' : String(n).replace('.', ','));
function readDecimal(id) {
  return parseDecimal(document.getElementById(id).value);
}
// The three fields that usually come from Vivino, checked before saving.
// The rating keeps Vivino's own (with its number of ratings) while the field
// is untouched; a rating typed by hand has no count.
async function readVivinoFields(vintage) {
  const alcohol = readDecimal('rec-alcohol');
  if (alcohol.invalid || (alcohol.value != null && !(alcohol.value > 0 && alcohol.value <= 25))) {
    await alertModal('La gradazione deve essere un numero tra 0 e 25, per esempio 12,5.');
    return null;
  }
  let site = document.getElementById('rec-site').value.trim();
  if (site) {
    if (!/^https?:\/\//i.test(site)) site = `https://${site}`;
    try {
      const u = new URL(site);
      if (!u.hostname.includes('.')) throw new Error('no domain');
      site = u.toString();
    } catch {
      await alertModal('Il sito del produttore non sembra un indirizzo web, per esempio tenutambrosini.it.');
      return null;
    }
  }
  const field = document.getElementById('rec-vivino');
  let rating = null;
  if (field.value.trim() === vivinoFieldStart.trim()) {
    rating = vivinoFieldStart ? ratingFor(pendingVivino ?? {}, vintage) ?? null : null;
  } else {
    const typed = readDecimal('rec-vivino');
    if (typed.invalid || (typed.value != null && !(typed.value >= 1 && typed.value <= 5))) {
      await alertModal('Il voto su Vivino va da 1 a 5, per esempio 3,8.');
      return null;
    }
    rating = typed.value != null ? { average: typed.value, count: null } : null;
  }
  return {
    alcohol: alcohol.value,
    producerUrl: site || null,
    vivinoRating: rating?.average ?? null,
    vivinoRatingsCount: rating?.count ?? null,
  };
}

function fillVivinoFields({ alcohol, producerUrl, rating }) {
  document.getElementById('rec-alcohol').value = decimalText(alcohol);
  // Shown without "https://" and the trailing slash ("www.tenutambrosini.it");
  // saving adds https:// back (readVivinoFields). An http:// site keeps it.
  document.getElementById('rec-site').value = (producerUrl ?? '').replace(/^https:\/\//i, '').replace(/\/$/, '');
  vivinoFieldStart = rating?.average ? decimalText(rating.average) : '';
  document.getElementById('rec-vivino').value = vivinoFieldStart;
}
// The wine's main photo as chosen in the sheet, saved with the wine:
// { file } a photo or a copied image, { url } a copied image link,
// { remove: true } back to the type's placeholder; null = unchanged.
let pendingPhoto = null;

// The sheet is shared by three entry points that all end up at the same
// fields: a recognized/found wine under review, a fully manual add, and
// editing a wine already in the cellar (from Cantina's "Modifica" icon).
// Only 'edit' changes what saveRecognizedWine() does on submit — the note
// composer is identical and always starts blank in every case (notes are
// append-only tasting entries, not a single mutable record, so there is
// never a past note to restore here even when editing the wine's own data).
let sheetMode = 'create'; // 'create' | 'edit'
let editingWineId = null;
let editingVintage = null; // the bottle's vintage when the edit sheet opened
let editingQuantity = null; // its bottles in that row
let editingBottleId = null;
let editingDrinkBottle = null; // the bottle being edited, for the drink estimate

// The number of bottles in the full sheet: the app's one quantity control.
// 1 or more when adding, 0 allowed when editing (all drunk).
function setReviewQuantity(value, min) {
  const slot = document.getElementById('rec-qty-slot');
  slot.innerHTML = quantityStepperHtml({ id: 'rec-qty', value, min });
  wireQuantitySteppers(slot);
}

// Disgorgement shows for sparkling wines only, when adding and when editing.
function syncDisgorgedField() {
  const sparkling = document.getElementById('rec-type').value === 'bollicine';
  document.getElementById('rec-disgorged-field').classList.toggle('hidden', !sparkling);
}
document.getElementById('rec-type')?.addEventListener('change', syncDisgorgedField);

// "Da bere" in the edit sheet: the estimate (from what is typed now: type,
// denomination, vintage) shows as placeholders and as a note; years typed
// replace it, "Usa la stima" empties them.
function renderDrinkEstimate() {
  if (!editingDrinkBottle) return;
  const vintage = Number(document.getElementById('rec-vintage').value) || null;
  const type = document.getElementById('rec-type').value;
  syncDisgorgedField();
  const disgorged = type === 'bollicine' ? document.getElementById('rec-disgorged').value || null : null;
  const w = estimatedWindow({
    ...editingDrinkBottle,
    name: document.getElementById('rec-name').value,
    type,
    denomination: document.getElementById('rec-denomination').value,
    vintage,
    disgorged_at: disgorged,
  });
  const from = document.getElementById('rec-drink-from');
  const until = document.getElementById('rec-drink-until');
  from.placeholder = String(w.from);
  until.placeholder = String(w.until);
  const est = document.getElementById('rec-drink-est');
  const best = w.peakFrom === w.peakUntil ? `nel ${w.peakFrom}` : `tra il ${w.peakFrom} e il ${w.peakUntil}`;
  const base = w.basis === 'disgorged' ? 'dalla sboccatura'
    : vintage ? `dall'annata ${vintage}` : 'da quando l\'hai aggiunto (con l\'annata è più precisa)';
  est.textContent = `Stima ${base}: dal ${w.from} al ${w.until}, al meglio ${best}. Scrivi gli anni per cambiarla.`;
  if (from.value || until.value) {
    const reset = Object.assign(document.createElement('a'), { textContent: 'Usa la stima', role: 'button', tabIndex: 0 });
    reset.addEventListener('click', () => { from.value = ''; until.value = ''; renderDrinkEstimate(); });
    est.append(' ', reset);
  }
}
for (const id of ['rec-drink-from', 'rec-drink-until', 'rec-vintage', 'rec-type', 'rec-denomination', 'rec-name', 'rec-disgorged']) {
  document.getElementById(id)?.addEventListener('input', renderDrinkEstimate);
  document.getElementById(id)?.addEventListener('change', renderDrinkEstimate);
}
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
  document.getElementById('rec-drink-field').classList.add('hidden');
  document.getElementById('rec-disgorged-field').classList.add('hidden');
  editingDrinkBottle = null;

  document.getElementById('rec-name').value = suggestion.name ?? '';
  document.getElementById('rec-producer').value = suggestion.producer ?? '';
  document.getElementById('rec-country').value = suggestion.country ?? 'Italia';
  document.getElementById('rec-region').value = suggestion.region ?? '';
  document.getElementById('rec-type').value = suggestion.type ?? 'rosso';
  document.getElementById('rec-vintage').value = suggestion.vintage ?? '';
  document.getElementById('rec-grape').value = suggestion.grapeVariety ?? '';
  document.getElementById('rec-denomination').value = suggestion.denomination ?? '';
  resetNoteComposer();
  // Placing a guided tasting: its note fills the composer (still editable),
  // and in the wishlist mode the sheet adds a wish instead of bottles.
  if (tasting?.note) prefillNoteComposer(tasting.note);
  const toWish = tasting?.mode === 'wish';
  document.getElementById('recognize-save').textContent = toWish ? 'Aggiungi ai desideri' : 'Salva';
  document.getElementById('rec-qty-field').classList.toggle('hidden', toWish);
  document.querySelector('label[for="rec-price"]').textContent = toWish ? 'Prezzo obiettivo' : 'Prezzo a bottiglia';
  pendingImageUrl = suggestion.imageUrl;
  pendingBarcode = suggestion.barcode;
  pendingVivino = { rating: suggestion.rating, vintageRatings: suggestion.vintageRatings };
  // Typed in the add panel before opening the full sheet: nothing is lost.
  document.getElementById('rec-price').value = suggestion.price != null ? priceText(suggestion.price, { grouping: false }) : '';
  setReviewQuantity(suggestion.quantity ?? 1, 1);
  document.getElementById('rec-disgorged').value = suggestion.disgorgedAt ?? '';
  syncDisgorgedField();
  fillVivinoFields({ alcohol: suggestion.alcohol, producerUrl: suggestion.producerUrl, rating: ratingFor(pendingVivino, suggestion.vintage) });
  pendingPhoto = null;
  document.getElementById('rec-photo-input').value = '';

  showReviewPhoto(capturedPhotoDataUrl ?? suggestion.imageUrl ?? null);

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
  editingVintage = bottle.vintage ?? null;
  editingQuantity = bottle.quantity;
  editingBottleId = bottle.id;
  editSavedCallback = onSaved ?? null;
  document.getElementById('recognize-title').textContent = 'Modifica vino';
  document.getElementById('recognize-save').textContent = 'Salva modifiche';
  document.getElementById('rec-qty-field').classList.remove('hidden');
  document.querySelector('label[for="rec-price"]').textContent = 'Prezzo a bottiglia';
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
  document.getElementById('rec-price').value = priceText(bottle.price_paid, { grouping: false });
  setReviewQuantity(Number(bottle.quantity) || 0, 0);
  editingDrinkBottle = bottle;
  document.getElementById('rec-drink-from').value = bottle.drink_from ? String(bottle.drink_from).slice(0, 4) : '';
  document.getElementById('rec-drink-until').value = bottle.drink_until ? String(bottle.drink_until).slice(0, 4) : '';
  document.getElementById('rec-drink-field').classList.remove('hidden');
  document.getElementById('rec-disgorged').value = bottle.disgorged_at ?? '';
  renderDrinkEstimate();
  pendingVivino = bottle.vivino_rating != null ? { rating: { average: Number(bottle.vivino_rating), count: bottle.vivino_ratings_count ?? null } } : null;
  fillVivinoFields({ alcohol: bottle.alcohol, producerUrl: bottle.producer_url, rating: pendingVivino?.rating });
  resetNoteComposer();
  pendingImageUrl = undefined;
  pendingBarcode = undefined;
  pendingPhoto = null;
  document.getElementById('rec-photo-input').value = '';

  showReviewPhoto(bottle.image_url ?? null);
  document.getElementById('recognize-rawtext').style.display = 'none';

  document.getElementById('recognize-overlay').classList.add('open');
}

function closeRecognizeSheet() {
  document.getElementById('recognize-overlay').classList.remove('open');
}

function prefillNoteComposer(note) {
  document.getElementById('rec-note-text').value = note.text ?? '';
  document.querySelectorAll('#rec-note-stars span').forEach((s, i) => {
    const on = i < Math.round(note.rating ?? 0);
    s.classList.toggle('on', on);
    s.setAttribute('aria-checked', String(i + 1 === Math.round(note.rating ?? 0)));
  });
  if (recognizeTaste) {
    setTastingProfile(recognizeTaste, {
      flavor_tags: note.flavorTags, food_pairings: note.foodPairings,
      ...Object.fromEntries(TASTE_AXES.map((a) => [`taste_${a.id}`, note[a.key]])),
    });
  }
}

// The composer as a note body, or null when nothing was written.
function composerNote() {
  const text = document.getElementById('rec-note-text').value.trim();
  const starsOn = document.querySelectorAll('#rec-note-stars span.on').length;
  const profile = recognizeTaste ? readTastingProfile(recognizeTaste) : null;
  const profileEmpty = !profile || isTastingProfileEmpty(profile);
  if (!text && starsOn === 0 && profileEmpty) return null;
  // A tasting's half stars (4,5) survive when the stars were not touched.
  const rating = tasting?.note && starsOn === Math.round(tasting.note.rating ?? 0) ? tasting.note.rating : starsOn || (text ? 3 : 0);
  return {
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
  };
}

// Reads the composer's current state and, if anything was actually filled
// in, posts one new tasting note for the given bottle — silently does
// nothing otherwise, since the whole section is optional in every context
// it appears in.
async function maybeSaveNote(bottleId) {
  const note = composerNote();
  if (!note) return;
  try {
    await api.post(`/api/bottles/${bottleId}/notes`, note);
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
  const vintageRead = parseVintage(document.getElementById('rec-vintage').value);
  if (vintageRead.invalid) {
    await alertModal(VINTAGE_ERROR);
    return;
  }
  const vintage = vintageRead.value ?? undefined;
  const grapeVariety = document.getElementById('rec-grape').value.trim() || undefined;
  const denomination = document.getElementById('rec-denomination').value.trim() || undefined;
  const extras = await readVivinoFields(vintage);
  if (!extras) return;
  // Price per bottle: belongs to the bottle, not to the shared wine.
  const priceRead = parsePrice(document.getElementById('rec-price').value);
  if (priceRead.invalid) {
    await alertModal(PRICE_ERROR);
    return;
  }
  const pricePaid = priceRead.value;
  // How many bottles: a new wine needs at least one; editing can set any
  // count, 0 included (all drunk, the wine stays listed as finished).
  const minQty = sheetMode === 'edit' ? 0 : 1;
  const qtyRead = parseQuantity(document.getElementById('rec-qty').value, minQty);
  if (qtyRead.invalid) {
    await alertModal(quantityError(minQty));
    return;
  }
  const quantity = qtyRead.value ?? (sheetMode === 'edit' ? null : 1);

  // Drinking window (edit only): two years, or both empty for the estimate.
  let drink = null;
  if (sheetMode === 'edit') {
    const f = document.getElementById('rec-drink-from').value.trim();
    const u = document.getElementById('rec-drink-until').value.trim();
    const year = (v) => (/^\d{4}$/.test(v) && Number(v) >= 1900 && Number(v) <= 2200 ? Number(v) : null);
    // Disgorgement (sparkling only; cleared if the type changed).
    const dis = document.getElementById('rec-disgorged').value;
    const disgorgedAt = type === 'bollicine' && /^\d{4}-\d{2}$/.test(dis) ? dis : null;
    if (!f && !u) drink = { drinkFrom: null, drinkUntil: null };
    else if (year(f) && year(u) && year(f) <= year(u)) drink = { drinkFrom: `${f}-01-01`, drinkUntil: `${u}-12-31` };
    else {
      await alertModal('Scrivi due anni, per esempio dal 2028 al 2040, oppure lasciali vuoti per usare la stima.');
      return;
    }
    drink.disgorgedAt = disgorgedAt;
  }

  if (sheetMode === 'edit') {
    try {
      // Another vintage is another wine, possibly shared with other bottles:
      // only this bottle moves to that vintage's wine (never rewrite the
      // year of the shared one), then the form's data goes on that wine.
      // A row can hold several bottles: when it does, ask how many are of
      // the new year; those become their own row, the others stay as they are.
      let wineId = editingWineId;
      let bottleId = editingBottleId;
      let split = false;
      if ((vintage ?? null) !== editingVintage) {
        const inRow = Number(editingQuantity) || 1;
        let moving = inRow;
        if (inRow > 1) {
          const label = vintage ? `del ${vintage}` : 'senza annata';
          const picked = await quantityModal({
            title: `Quante sono ${label}?`,
            message: `Hai ${inRow} bottiglie in questa riga. Le altre restano ${editingVintage ? `del ${editingVintage}` : 'senza annata'}.`,
            value: 1, min: 1, confirmLabel: 'Continua',
          });
          if (picked == null) return;
          if (picked > inRow) {
            await alertModal(`In questa riga ci sono ${inRow} bottiglie: scrivi un numero da 1 a ${inRow}.`);
            return;
          }
          moving = picked;
        }
        const res = await api.post(`/api/bottles/${editingBottleId}/vintage`, { vintage: vintage ?? null, quantity: moving });
        wineId = res.wine.id;
        bottleId = res.bottleId;
        split = bottleId !== editingBottleId;
      }
      await api.patch(`/api/wines/${wineId}`, { name, producer, country, region, type, vintage, grapeVariety, denomination, ...extras });
      // After a split the quantity field still describes the old row: only
      // price and window go on the new one.
      await api.patch(`/api/bottles/${bottleId}`, { pricePaid, ...(quantity == null || split ? {} : { quantity }), ...drink });
      if (split) showToast(`Annata ${vintage ?? 'tolta'}: separata in una riga a parte`);
      closeRecognizeSheet();
      await savePendingPhoto(wineId, 'Vino modificato');
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

  // The number of bottles is a field of the form (checked above, before
  // anything is created): no separate "Quante bottiglie?" dialog any more.

  try {
    const wine = await api.post('/api/wines', {
      name, producer, country, region, type, vintage, grapeVariety, denomination, imageUrl, barcode: pendingBarcode,
      alcohol: extras.alcohol ?? undefined, producerUrl: extras.producerUrl ?? undefined,
      vivinoRating: extras.vivinoRating ?? undefined, vivinoRatingsCount: extras.vivinoRatingsCount ?? undefined,
    });
    closeRecognizeSheet();
    if (tasting?.mode === 'wish') {
      if (!currentCellarId) await (cellarLoad ?? loadCellar());
      await api.post(`/api/cellars/${currentCellarId}/wishlist`, { wineId: wine.id, targetPrice: pricePaid ?? undefined, note: composerNote() ?? undefined });
      await savePendingPhoto(wine.id, 'Vino salvato');
      finishWish();
      return;
    }
    await postBottle(wine.id, quantity, async (bottle) => {
      await maybeSaveNote(bottle.id);
      await savePendingPhoto(wine.id, 'Vino salvato');
    }, pricePaid, type === 'bollicine' ? parseDisgorged(document.getElementById('rec-disgorged').value) : null);
  } catch (err) {
    console.error(err);
    await alertModal('Impossibile aggiungere il vino: controlla i dati inseriti e riprova.');
  }
}

document.getElementById('recognize-close')?.addEventListener('click', closeRecognizeSheet);
// While the Vivino rating is untouched it follows the vintage being typed
// (that year's rating when Vivino has one), so the field shows what is saved.
document.getElementById('rec-vintage')?.addEventListener('input', (e) => {
  const field = document.getElementById('rec-vivino');
  if (!vivinoFieldStart || field.value.trim() !== vivinoFieldStart.trim()) return;
  const r = ratingFor(pendingVivino ?? {}, e.target.value);
  vivinoFieldStart = r?.average ? decimalText(r.average) : vivinoFieldStart;
  field.value = vivinoFieldStart;
});
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
// ---- the wine's main photo, chosen in the sheet ----

function showReviewPhoto(src) {
  const photoImg = document.getElementById('recognize-photo');
  sizeReviewPhoto(photoImg);
  const wrap = document.getElementById('recognize-photo-wrap');
  if (src) photoImg.src = src;
  else photoImg.removeAttribute('src');
  wrap.style.display = src ? '' : 'none';
  // No photo: the type's placeholder, so it is clear where the photo goes.
  const placeholder = document.getElementById('recognize-photo-placeholder');
  placeholder.className = `rec-photo-placeholder photo ${photoClass(document.getElementById('rec-type').value || 'rosso')}${src ? ' hidden' : ''}`;
  document.getElementById('rec-photo-remove').classList.toggle('hidden', !src);
}

// Smaller before upload. A cut-out (transparent background, as product
// shots often are) stays PNG so it can stand on the landscape; anything
// else becomes JPEG.
async function compressWineImage(blob) {
  try {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let transparent = false;
    for (let i = 3; i < img.data.length; i += 4 * 97) if (img.data[i] < 250) { transparent = true; break; }
    // Shop photos of a bottle usually sit on plain white: clear the white
    // that touches the edges, and the bottle stands on the landscape.
    if (!transparent && clearWhiteBackground(img)) {
      ctx.putImageData(img, 0, 0);
      transparent = true;
    }
    const out = await new Promise((resolve) => canvas.toBlob(resolve, transparent ? 'image/png' : 'image/jpeg', 0.86));
    return out ?? blob;
  } catch (err) {
    console.error('wine image compression failed, sending original', err);
    return blob;
  }
}

// Flood fill from the borders over near-white pixels, making them
// transparent. Only when all four corners are white (a white backdrop, not
// a photo that happens to have a bright patch). Returns whether it did.
function clearWhiteBackground(img) {
  const { width: w, height: h, data } = img;
  const white = (p) => data[p * 4] > 236 && data[p * 4 + 1] > 236 && data[p * 4 + 2] > 236;
  if (![0, w - 1, (h - 1) * w, h * w - 1].every(white)) return false;
  const seen = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  let cleared = 0;
  while (stack.length) {
    const p = stack.pop();
    if (seen[p] || !white(p)) continue;
    seen[p] = 1;
    data[p * 4 + 3] = 0;
    cleared++;
    const x = p % w;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (p >= w) stack.push(p - w);
    if (p < w * (h - 1)) stack.push(p + w);
  }
  // Nearly everything white: not a bottle on a backdrop, leave it alone.
  if (cleared > w * h * 0.95) {
    for (let p = 0; p < w * h; p++) data[p * 4 + 3] = 255;
    return false;
  }
  return cleared > 0;
}

async function choosePhotoBlob(blob) {
  const file = await compressWineImage(blob);
  pendingPhoto = { file };
  showReviewPhoto(URL.createObjectURL(file));
}

// What was copied in Safari: an image (long press → Copia) or a link to one.
// iOS shows its own "Incolla" bubble to allow reading it.
async function pastePhoto() {
  try {
    const items = navigator.clipboard?.read ? await navigator.clipboard.read() : [];
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith('image/'));
      if (type) return choosePhotoBlob(await item.getType(type));
    }
    let text = '';
    for (const item of items) if (item.types.includes('text/plain')) text = await (await item.getType('text/plain')).text();
    if (!text && navigator.clipboard?.readText) text = await navigator.clipboard.readText();
    text = text.trim();
    if (/^https?:\/\/\S+$/i.test(text)) {
      pendingPhoto = { url: text };
      showReviewPhoto(text);
      return;
    }
  } catch (err) {
    console.error('clipboard read failed', err);
  }
  // Reading the clipboard from a button is refused or comes back empty on
  // some iPhones: a box to paste into with the system's own Incolla always
  // works.
  const pasted = await pasteModal();
  if (pasted?.file) await choosePhotoBlob(pasted.file);
  else if (pasted?.url) {
    pendingPhoto = { url: pasted.url };
    showReviewPhoto(pasted.url);
  }
}

// Saved once the wine exists (and is in the user's cellar).
async function savePendingPhoto(wineId, doneLabel) {
  if (!pendingPhoto || !wineId) return;
  const photo = pendingPhoto;
  pendingPhoto = null;
  try {
    if (photo.remove) await api.del(`/api/wines/${wineId}/image`);
    else if (photo.url) await api.put(`/api/wines/${wineId}/image`, { url: photo.url });
    else {
      const form = new FormData();
      form.append('file', photo.file, 'foto');
      await api.put(`/api/wines/${wineId}/image`, form);
    }
  } catch (err) {
    console.error(err);
    await alertModal(photo.url
      ? `${doneLabel}, ma la foto non si è potuta scaricare dal link: prova a copiare l'immagine stessa invece del link.`
      : `${doneLabel}, ma il caricamento della foto è fallito.`);
  }
}

document.getElementById('rec-photo-pick')?.addEventListener('click', () => document.getElementById('rec-photo-input')?.click());
document.getElementById('rec-photo-paste')?.addEventListener('click', pastePhoto);
document.getElementById('rec-photo-remove')?.addEventListener('click', () => {
  pendingPhoto = { remove: true };
  showReviewPhoto(null);
});
document.getElementById('rec-photo-input')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (file) await choosePhotoBlob(file);
});
