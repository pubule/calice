import { api } from '../api-client.js';
import { escapeHtml, photoClass, priceText } from '../util.js';
import { openLocationPicker, locationLabel, refreshCellarList, editBottle, deleteBottle } from './cellar.js';
import { confirmModal, alertModal, promptModal } from '../modal.js';
import { showToast } from '../toast.js';
import { landscapeFor, knownLandscape } from '../landscape.js';
import { drinkWindow, drinkSummary } from '../drink-window.js';
import { tastingProfileHtml, wireTastingProfile, resetTastingProfile, readTastingProfile, setTastingProfile, isTastingProfileEmpty, tasteSummary, FLAVOR_CATEGORIES, TASTE_AXES, toStep } from '../tasting-profile.js';

let currentBottleId = null;
let currentBottle = null; // same object reference cellar.js's currentBottles holds, mutated in place on save
let currentMeId = null;
// The user's own note on this bottle (one per bottle and person): shown
// read-only in the "Sentori e note" tab, edited on #note-overlay, and saving
// updates it. Null when there is none yet — the first save creates it.
let ownNote = null;
let savedNoteId = null;
let myRatingValue = 0; // the note sheet's score, 0 = none (1-5, tenths allowed)
let noteSnapshot = ''; // the sheet's state when opened, to ask before discarding changes

const ratingText = (r) => String(Math.round(r * 10) / 10).replace('.', ',');
const myStars = Array.from(document.querySelectorAll('#note-overlay .stars-input span'));
const detailTaste = document.getElementById('detail-taste');

// Stars filled in proportion to the score (4,5 = four and a half) and the
// number shown next to them.
function setMyStars(r) {
  myRatingValue = r || 0;
  myStars.forEach((star, i) => {
    const fill = Math.max(0, Math.min(1, myRatingValue - i));
    star.classList.toggle('on', fill >= 1);
    star.style.setProperty('--fill', `${fill * 100}%`);
    star.setAttribute('aria-checked', String(i + 1 === Math.round(myRatingValue)));
  });
  const value = document.getElementById('note-rating-value');
  if (value) value.textContent = myRatingValue ? ratingText(myRatingValue) : '–';
}

function noteHtml(n) {
  // rating/text/author_name all come from the API as unvalidated JSON (no
  // backend schema check) — coerce rating to a safe 0-5 int so a malicious
  // non-numeric value can't turn '★'.repeat(NaN) into a thrown exception
  // that would blank the whole notes list, and escape every string field
  // before it goes into innerHTML.
  const rating = Math.min(5, Math.max(0, Math.round(Number(n.rating)) || 0));
  const flavorTags = Array.isArray(n.flavor_tags) ? n.flavor_tags : [];
  const foodPairings = Array.isArray(n.food_pairings) ? n.food_pairings : [];
  const tags = [...flavorTags, ...foodPairings];
  const tagsHtml = tags.length
    ? `<div class="chip-row" style="margin-top:8px;">${tags.map((t) => `<span class="chip" style="cursor:default">${escapeHtml(t)}</span>`).join('')}</div>`
    : '';
  // Only the leaning sides are shown (same dominant/neutral rule as the
  // sliders themselves) — a full bar per axis would be a lot of visual
  // weight to repeat for every historical note.
  const summary = tasteSummary(n);
  const summaryHtml = summary ? `<div class="note-taste-summary">${escapeHtml(summary)}</div>` : '';
  return `
    <div class="rev-card">
      <div class="rev-head"><div class="rev-avatar">${escapeHtml(n.author_name.slice(0, 2).toUpperCase())}</div><div class="rev-name">${escapeHtml(n.author_name)}</div><span class="rev-src">${new Date(n.created_at).toLocaleDateString('it-IT')}</span></div>
      <div class="rev-stars" role="img" aria-label="${rating} su 5 stelle">${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}</div>
      ${n.text ? `<div class="rev-text">${escapeHtml(n.text)}</div>` : ''}
      ${summaryHtml}
      ${tagsHtml}
    </div>`;
}

const TYPE_LABEL = { rosso: 'Rosso', bianco: 'Bianco', bollicine: 'Bollicine', rosato: 'Rosato' };

function renderStats(bottle) {
  // ...and what it is worth, as a row of numbers: price, the user's own score
  // and Vivino's community rating.
  const one = (n) => Number(n).toFixed(1).replace('.', ',');
  const stat = (value, label, aria) => {
    const el = document.createElement('div');
    el.className = 'hero-stat';
    el.append(Object.assign(document.createElement('b'), { textContent: value }), Object.assign(document.createElement('span'), { textContent: label }));
    if (aria) el.setAttribute('aria-label', aria);
    return el;
  };
  const stats = [];
  if (priceText(bottle.price_paid)) stats.push(stat(`${priceText(bottle.price_paid)} €`, 'a bottiglia'));
  if (bottle.my_rating != null) stats.push(stat(`★ ${one(bottle.my_rating)}`, 'il tuo voto', `Il tuo voto ${one(bottle.my_rating)} su 5`));
  if (bottle.vivino_rating != null) {
    const n = Number(bottle.vivino_ratings_count) || 0;
    const votes = `${n.toLocaleString('it-IT')} ${n === 1 ? 'voto' : 'voti'}`;
    stats.push(stat(`★ ${one(bottle.vivino_rating)}`, 'Vivino', `Voto medio su Vivino ${one(bottle.vivino_rating)} su 5, ${votes}`));
  }
  document.querySelector('#detail-overlay .hero-stats').replaceChildren(...stats);
}

// The "Il vino" tab: what the wine is, one row per known fact (grapes as
// chips). Facts nobody has filled stay out; with none at all, a pointer to
// Modifica.
function renderFacts(bottle) {
  const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  const disg = /^(\d{4})-(\d{2})$/.exec(bottle.disgorged_at ?? '');
  const grapes = (bottle.grape_variety ?? '').split(',').map((g) => g.trim()).filter(Boolean);
  const rows = [
    ['Denominazione', bottle.denomination],
    ['Vitigni', grapes.length ? grapes : null],
    ['Gradazione', bottle.alcohol ? `${String(bottle.alcohol).replace('.', ',')}% vol` : null],
    ['Annata', bottle.vintage ? String(bottle.vintage) : null],
    ['Sboccatura', disg ? `${MONTHS[Number(disg[2]) - 1]} ${disg[1]}` : null],
    ['Regione', [bottle.region, bottle.country].filter(Boolean).join(', ') || null],
  ].filter(([, v]) => v);
  const el = (tag, className, text) => Object.assign(document.createElement(tag), { className, textContent: text ?? '' });
  const facts = document.getElementById('detail-facts');
  if (!rows.length) {
    facts.replaceChildren(el('p', 'fact-empty', 'Nessun dato sul vino: aggiungili da Modifica.'));
    return;
  }
  facts.replaceChildren(...rows.map(([label, value]) => {
    const row = el('div', Array.isArray(value) ? 'fact-row stacked' : 'fact-row');
    const v = Array.isArray(value)
      ? Object.assign(el('div', 'fact-chips'), { role: 'list' })
      : el('span', 'fact-value', value);
    if (Array.isArray(value)) v.append(...value.map((g) => Object.assign(el('span', 'grape-chip', g), { role: 'listitem' })));
    row.append(el('span', 'fact-label', label), v);
    return row;
  }));
}

function selectDetailTab(tab) {
  document.querySelectorAll('#detail-tabs button').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === tab);
    b.setAttribute('aria-pressed', String(b.dataset.tab === tab));
  });
  document.querySelectorAll('#detail-overlay .detail-tab-panel').forEach((p) => p.classList.toggle('hidden', p.dataset.tabPanel !== tab));
}

function renderHero(bottle) {
  const art = document.querySelector('#detail-overlay .hero-art');
  const product = art.querySelector('.hero-product');
  // Without a photo the thumbnail shows the type's placeholder (photoClass).
  art.className = 'hero-art photo ' + photoClass(bottle.type);
  art.style.backgroundImage = bottle.image_url ? 'none' : '';
  art.classList.toggle('has-product', !!bottle.image_url);
  product.onload = () => {
    // Vivino's cut-out bottles are tall and narrow: they stand on the
    // landscape without a frame; a photo of the label stays a thumbnail.
    art.classList.toggle('cutout', product.naturalWidth / product.naturalHeight < 0.5);
  };
  if (bottle.image_url) {
    product.src = bottle.image_url;
    // Already in the cache (start-up loader): decide now, so the sheet does
    // not open on the thumbnail and then jump to the standing bottle.
    if (product.complete && product.naturalWidth) product.onload();
  } else product.removeAttribute('src');
  const hero = document.querySelector('#detail-overlay .detail-hero');
  const type = hero.querySelector('.hero-type');
  type.className = 'hero-type ' + (TYPE_LABEL[bottle.type] ? bottle.type : 'rosso');
  type.textContent = TYPE_LABEL[bottle.type] ?? 'Vino';
  hero.querySelector('.hero-origin').textContent = [bottle.region, bottle.country].filter(Boolean).join(', ');
  hero.querySelector('.name').textContent = bottle.name;
  document.getElementById('detail-bar-name').textContent = bottle.name;
  // Producer, then the producer's website (from Vivino) as a link.
  const sub = hero.querySelector('.sub');
  sub.replaceChildren(bottle.producer ?? '');
  let site = null;
  try {
    const u = bottle.producer_url ? new URL(bottle.producer_url) : null;
    if (u && (u.protocol === 'https:' || u.protocol === 'http:')) site = u;
  } catch { /* not a URL: no link */ }
  if (site) {
    const a = Object.assign(document.createElement('a'), {
      href: site.href, target: '_blank', rel: 'noopener noreferrer', className: 'hero-site',
      textContent: site.hostname.replace(/^www\./, ''),
    });
    a.setAttribute('aria-label', `Sito del produttore: ${a.textContent}`);
    sub.append(' · ', a);
  }
  renderFacts(bottle);
  renderStats(bottle);
  loadLandscape(bottle);
  document.getElementById('loc-value').textContent = locationLabel(bottle) || 'Non assegnata';
  const w = drinkWindow(bottle);
  const sum = drinkSummary(w);
  const value = document.getElementById('drink-value');
  value.replaceChildren(Object.assign(document.createElement('b'), { textContent: sum.title }), ` · ${sum.text}`);
  value.firstChild.style.cssText = 'display:inline; color:#241e1a; font-size:inherit; margin:0;';
  const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  const dis = /^(\d{4})-(\d{2})$/.exec(bottle.disgorged_at ?? '');
  document.getElementById('drink-note').textContent = w.basis === 'disgorged' && dis
    ? `Stima dalla sboccatura (${MONTHS[Number(dis[2]) - 1]} ${dis[1]}).`
    : w.basis === 'added'
    ? 'Stima da quando l\'hai aggiunto: con l\'annata (in Modifica) è più precisa.'
    : w.basis === 'manual' ? 'Anni scelti da te.'
    : bottle.type === 'bollicine' ? 'Aggiungi la sboccatura (in Modifica) per una stima più precisa.' : '';
}

// The vineyard photo behind the bottle, for the wine's denomination, region
// or country (see js/landscape.js). Usually already known and in the image
// cache thanks to the start-up loader: then it shows at once, without a fade.
async function loadLandscape(bottle) {
  const land = document.querySelector('#detail-overlay .hero-land');
  const img = land.querySelector('.hero-land-img');
  const credit = document.getElementById('land-credit');
  const id = bottle.id;
  land.classList.remove('loaded');
  img.removeAttribute('src');
  credit.classList.add('hidden');
  let l = knownLandscape(bottle);
  if (l === undefined) {
    try {
      l = await landscapeFor(bottle);
    } catch {
      return; // no photo this time: the plain background stays
    }
  }
  // The user may have opened another wine while this was loading.
  if (currentBottle?.id !== id || !l) return;
  img.onload = () => { if (currentBottle?.id === id) land.classList.add('loaded'); };
  img.src = l.url;
  if (img.complete && img.naturalWidth) land.classList.add('loaded');
  const a = Object.assign(document.createElement('a'), { href: l.pageUrl, target: '_blank', rel: 'noopener', textContent: l.author });
  credit.replaceChildren('Foto del paesaggio: ', a, ` · ${l.license} · Wikimedia Commons`);
  credit.classList.remove('hidden');
}

// The small name in the top bar appears once the big one has scrolled under it.
const detailSheet = document.querySelector('#detail-overlay .detail-sheet');
detailSheet?.addEventListener('scroll', () => {
  const name = detailSheet.querySelector('.detail-hero .name');
  const top = detailSheet.getBoundingClientRect().top;
  detailSheet.classList.toggle('compact', name.getBoundingClientRect().bottom < top + 52);
}, { passive: true });

let undoTimer = null;

function renderQuantity() {
  const q = Number(currentBottle?.quantity) || 0;
  document.getElementById('uncork-count').textContent = q === 1 ? 'Resta 1 bottiglia' : `Restano ${q} bottiglie`;
}

function hideUndo() {
  clearTimeout(undoTimer);
  undoTimer = null;
  document.getElementById('uncork-undo')?.classList.add('hidden');
}

// Quantity changes go through PATCH /api/bottles/:id ({ quantity } only). The
// bottle object is shared with cellar.js's list, so mutating it and asking
// the list to re-render is all the list needs.
// Fewer bottles than places frees the most recently placed ones (server
// side): the sheet shows the new positions, and returns the freed ones so
// an undo can put them back.
async function setQuantity(bottle, quantity) {
  const before = bottle.places ?? [];
  const updated = await api.patch(`/api/bottles/${bottle.id}`, { quantity });
  bottle.quantity = quantity;
  bottle.places = updated.places ?? [];
  if (currentBottle === bottle) {
    renderQuantity();
    document.getElementById('loc-value').textContent = locationLabel(bottle) || 'Non assegnata';
  }
  refreshCellarList();
  return before.filter((p) => !bottle.places.some((q) => q.id === p.id));
}

async function uncorkOne() {
  const bottle = currentBottle;
  if (!bottle) return;
  const btn = document.getElementById('uncork-btn');
  const before = Number(bottle.quantity) || 0;
  btn.disabled = true;
  try {
    if (before <= 1) {
      const ok = await confirmModal("Era l'ultima bottiglia: rimuovere il vino dalla cantina?", {
        title: 'Ultima bottiglia',
        confirmLabel: 'Rimuovi',
        danger: true,
      });
      if (!ok) return;
      await api.del(`/api/bottles/${bottle.id}`);
      hideUndo();
      document.getElementById('detail-overlay').classList.remove('open');
      refreshCellarList(bottle.id);
      return;
    }
    const freed = await setQuantity(bottle, before - 1);
    clearTimeout(undoTimer);
    const undo = document.getElementById('uncork-undo');
    const spot = (p) => (p.slot_tier == null ? p.element_name : `${p.element_name} · L${p.slot_tier} ${String.fromCharCode(65 + p.slot_col)}.${p.slot_depth}`);
    undo.querySelector('span').textContent = freed.length ? `Bottiglia stappata · liberato ${freed.map(spot).join(', ')}` : 'Bottiglia stappata';
    undo.classList.remove('hidden');
    document.getElementById('uncork-undo-btn').onclick = async () => {
      hideUndo();
      await setQuantity(bottle, before);
      for (const p of freed) {
        const res = await api.post(`/api/bottles/${bottle.id}/places`, { elementId: p.element_id, tier: p.slot_tier, col: p.slot_col, depth: p.slot_depth }).catch(() => null);
        if (res) bottle.places = res.places;
      }
      if (currentBottle === bottle) document.getElementById('loc-value').textContent = locationLabel(bottle) || 'Non assegnata';
      refreshCellarList();
    };
    undoTimer = setTimeout(hideUndo, 5000);
  } catch (err) {
    console.error('uncork failed', err);
  } finally {
    btn.disabled = false;
  }
}

// Own notes are not listed under the card: the latest one IS the card
// (renderNoteCard). Any older own notes (from before notes were edited in place) are
// still shown, as "Note precedenti", so nothing written is hidden.
async function loadNotes(bottleId) {
  const notes = await api.get(`/api/bottles/${bottleId}/notes`);
  const mine = notes.filter((n) => n.user_id === currentMeId);
  const older = mine.filter((n) => n.id !== savedNoteId);
  document.getElementById('notes-mine').innerHTML = older.length
    ? `<div class="field-label">Note precedenti</div>${older.map(noteHtml).join('')}`
    : '';
  return mine;
}

// The "Sentori e note" card: the user's note to read, each part only when it
// has a value (voto, testo, aromi per famiglia, gusto segnato, abbinamenti).
// Every value comes from the API, so text goes in through textContent.
function renderNoteCard(note) {
  const card = document.getElementById('note-card');
  const el = (tag, className, text) => Object.assign(document.createElement(tag), { className, textContent: text ?? '' });
  const action = (label) => Object.assign(el('button', 'note-card-btn', label), { type: 'button' });
  if (!note) {
    card.classList.add('empty');
    card.replaceChildren(action('Scrivi una nota'));
    return;
  }
  card.classList.remove('empty');
  const parts = [];
  const created = note.created_at ? new Date(`${String(note.created_at).replace(' ', 'T')}Z`) : null;
  const head = el('div', 'nc-head');
  head.append(el('h4', '', 'La tua nota'));
  if (created && !Number.isNaN(created.getTime())) head.append(el('span', 'nc-date', created.toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })));
  parts.push(head);

  const rating = Number(note.rating) || 0;
  if (rating > 0) {
    const row = el('div', 'nc-stars');
    row.setAttribute('role', 'img');
    row.setAttribute('aria-label', `Il tuo voto: ${ratingText(rating)} su 5`);
    for (let i = 0; i < 5; i++) {
      const star = el('span', '', '★');
      star.style.setProperty('--fill', `${Math.max(0, Math.min(1, rating - i)) * 100}%`);
      row.append(star);
    }
    row.append(el('b', '', ratingText(rating)));
    parts.push(row);
  }
  if (note.text) parts.push(el('p', 'nc-text', note.text));

  const tags = Array.isArray(note.flavor_tags) ? note.flavor_tags : [];
  const families = FLAVOR_CATEGORIES.map((c) => [c, tags.filter((t) => c.tags.includes(t))]).filter(([, ts]) => ts.length);
  if (families.length) {
    const box = el('div', 'nc-aromas');
    box.append(el('div', 'nc-label', 'Aromi'));
    for (const [cat, ts] of families) {
      const row = el('div', 'nc-aroma-row');
      const icon = el('span', 'nc-icon');
      icon.innerHTML = cat.icon; // our own constant SVG
      Object.assign(icon.style, { background: cat.bg, color: cat.fg });
      icon.setAttribute('aria-hidden', 'true');
      row.append(icon, el('span', 'nc-fam', cat.label), el('span', 'nc-list', ts.join(', ')));
      box.append(row);
    }
    parts.push(box);
  }

  const axes = TASTE_AXES.filter((a) => note[`taste_${a.id}`] != null);
  if (axes.length) {
    const box = el('div', 'nc-taste');
    box.append(el('div', 'nc-label', 'Gusto'));
    for (const axis of axes) {
      const v = Number(note[`taste_${axis.id}`]);
      const bar = el('span', 'nc-bar');
      bar.setAttribute('aria-hidden', 'true');
      bar.append(Object.assign(el('i', ''), { style: `width:${toStep(v) * 10}%` }));
      box.append(el('span', 'nc-axis', axis.name), bar, el('span', 'nc-side', v < 40 ? axis.left : v > 60 ? axis.right : 'equilibrato'));
    }
    parts.push(box);
  }

  const pairings = Array.isArray(note.food_pairings) ? note.food_pairings : [];
  if (pairings.length) {
    const box = el('div', 'nc-pairings');
    box.append(el('div', 'nc-label', 'Abbinamenti'), el('div', 'nc-list', pairings.join(', ')));
    parts.push(box);
  }
  parts.push(action('Modifica la nota'));
  card.replaceChildren(...parts);
}

const noteSheetState = () => JSON.stringify([readTastingProfile(detailTaste), myRatingValue]);

function openNoteSheet() {
  if (ownNote) setTastingProfile(detailTaste, ownNote);
  else resetTastingProfile(detailTaste);
  setMyStars(Number(ownNote?.rating) || 0);
  noteSnapshot = noteSheetState();
  document.querySelector('#note-overlay .detail-sheet').scrollTop = 0;
  document.getElementById('note-overlay').classList.add('open');
}

function closeNoteSheet() {
  document.getElementById('note-overlay').classList.remove('open');
}

async function loadPhotos(bottleId) {
  const photos = await api.get(`/api/bottles/${bottleId}/photos`);
  const gallery = document.getElementById('detail-gallery');
  gallery.innerHTML =
    photos
      .map((p) => `<div class="gallery-thumb" style="background-image:url('${escapeHtml(p.url)}');background-size:cover;"></div>`)
      .join('') +
    '<div class="gallery-add" id="gallery-add-btn" role="button" tabindex="0" aria-label="Aggiungi foto"><svg aria-hidden="true" viewBox="0 0 24 24" style="width:18px;height:18px;" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><input type="file" accept="image/*" capture="environment" style="display:none" id="gallery-file-input"></div>';
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
  const sheet = document.querySelector('#detail-overlay .detail-sheet');
  sheet.scrollTop = 0;
  sheet.classList.remove('compact');
  document.getElementById('detail-overlay').classList.add('open');
  hideUndo();
  selectDetailTab('wine');
  closeNoteSheet();
  ownNote = null;
  savedNoteId = null;
  renderNoteCard(null);
  renderQuantity();
  renderHero(bottle);
  // Notes are fetched once to find the user's own (newest first from the
  // API), shown on the card, then the older ones listed under it.
  const [mine] = await Promise.all([api.get(`/api/bottles/${currentBottleId}/notes`), loadPhotos(currentBottleId)]);
  if (currentBottle !== bottle) return; // another bottle was opened meanwhile
  ownNote = mine.filter((n) => n.user_id === currentMeId)[0] ?? null;
  savedNoteId = ownNote?.id ?? null;
  renderNoteCard(ownNote);
  await loadNotes(currentBottleId);
}

// The gallery add-tile and file input are re-created on every loadPhotos()
// call (they're part of its innerHTML), so they get wired there. Everything
// else in the sheet (close, tab switch, star picker, note form, location edit)
// is static markup that exists once for the app's lifetime — wire it once
// here, mirroring cellar.js's wireStaticControls(), instead of re-attaching
// a fresh listener (and stacking duplicates) on every openDetail() call.
function wireStaticControls() {
  document.getElementById('uncork-btn')?.addEventListener('click', uncorkOne);
  document.getElementById('detail-tabs')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tab]');
    if (btn) selectDetailTab(btn.dataset.tab);
  });

  // Same actions as the swipe on a Cantina row (kept here too: a swipe is
  // invisible to VoiceOver and keyboard users).
  document.getElementById('detail-edit-btn')?.addEventListener('click', () => {
    if (!currentBottle) return;
    editBottle(currentBottle, (updated) => {
      // The list was re-fetched: swap in the fresh object and redraw the header.
      if (!updated || currentBottleId !== updated.id) return;
      currentBottle = updated;
      renderHero(updated);
      renderQuantity();
    });
  });
  document.getElementById('detail-delete-btn')?.addEventListener('click', async () => {
    if (!currentBottle) return;
    if (await deleteBottle(currentBottle)) {
      hideUndo();
      document.getElementById('detail-overlay').classList.remove('open');
    }
  });

  document.getElementById('detail-close')?.addEventListener('click', () => {
    document.getElementById('detail-overlay').classList.remove('open');
  });

  // Scoped per .stars-input group, not globally: the page now has two star
  // groups (this sheet's note composer and the add/edit-wine sheet's), and a
  // single document-wide querySelectorAll would toggle both groups together
  // from either one's clicks.
  document.querySelectorAll('.stars-input').forEach((group) => {
    const spans = Array.from(group.querySelectorAll('span'));
    spans.forEach((s, i) => {
      s.addEventListener('click', () => spans.forEach((el, j) => {
        el.classList.toggle('on', j <= i);
        el.setAttribute('aria-checked', String(j === i));
      }));
    });
  });

  // The note sheet's stars: the score is saved with the rest of the note by
  // "Salva" (no instant save any more: one way to save, per the spec).
  myStars.forEach((star, i) => star.addEventListener('click', () => setMyStars(i + 1)));
  // The number next to the stars: tapped, it asks for the score with a
  // comma (4,5), for what whole stars cannot say.
  document.getElementById('note-rating-value')?.addEventListener('click', async () => {
    const typed = await promptModal('Da 1 a 5, anche con la virgola: per esempio 4,5.', {
      title: 'Il tuo voto', defaultValue: myRatingValue ? ratingText(myRatingValue) : '', placeholder: 'es. 4,5', inputMode: 'decimal',
    });
    if (typed == null || !typed.trim()) return;
    const v = Number(typed.trim().replace(',', '.'));
    if (!(v >= 1 && v <= 5)) {
      await alertModal('Il voto va da 1 a 5, per esempio 4 o 4,5.');
      return;
    }
    setMyStars(Math.round(v * 10) / 10);
  });

  detailTaste.innerHTML = tastingProfileHtml();
  wireTastingProfile(detailTaste);

  document.getElementById('note-card')?.addEventListener('click', (e) => {
    if (e.target.closest('.note-card-btn')) openNoteSheet();
  });
  // Also what the sheet gestures (backdrop tap, drag down) call.
  document.getElementById('note-cancel')?.addEventListener('click', async () => {
    if (noteSheetState() !== noteSnapshot
      && !(await confirmModal('Le modifiche alla nota andranno perse.', { title: 'Scartare le modifiche?', confirmLabel: 'Scarta', cancelLabel: 'Continua', danger: true }))) return;
    closeNoteSheet();
  });

  const noteSave = document.getElementById('note-save');
  noteSave?.addEventListener('click', async () => {
    const bottle = currentBottle;
    if (!bottle || noteSave.disabled) return;
    const profile = readTastingProfile(detailTaste);
    const { text } = profile;
    // Nothing written and no note yet: nothing to save.
    if (myRatingValue === 0 && isTastingProfileEmpty(profile) && savedNoteId == null) {
      closeNoteSheet();
      return;
    }
    // 0 stars defaults to 3 only when there's free text to go with it (the
    // original behaviour: writing something implies a decent rating even if
    // no star was tapped) — a profile-only save with no stars stays 0
    // (genuinely unrated) instead of inventing a rating nobody gave.
    const rating = myRatingValue || (text ? 3 : 0);
    // Disabled while in flight: repeated taps once saved the same note five
    // times in production.
    noteSave.disabled = true;
    const payload = {
      rating,
      text,
      flavorTags: profile.flavorTags,
      foodPairings: profile.foodPairings,
      tasteAcidity: profile.tasteAcidity,
      tasteSweetness: profile.tasteSweetness,
      tasteTannin: profile.tasteTannin,
      tasteBody: profile.tasteBody,
      tasteAlcohol: profile.tasteAlcohol,
      tasteIntensity: profile.tasteIntensity,
      tasteFinish: profile.tasteFinish,
    };
    const updating = savedNoteId != null;
    try {
      const note = updating
        ? await api.patch(`/api/bottles/${bottle.id}/notes/${savedNoteId}`, payload)
        : await api.post(`/api/bottles/${bottle.id}/notes`, payload);
      savedNoteId = note?.id ?? savedNoteId;
    } catch (err) {
      console.error(err);
      await alertModal('Non è stato possibile salvare la nota. Riprova.', { title: 'Nota non salvata' });
      return;
    } finally {
      noteSave.disabled = false;
    }
    showToast(updating ? 'Nota aggiornata' : 'Nota salvata');
    closeNoteSheet();
    // The score is the note's: the numbers above and Cantina's list follow.
    bottle.my_rating = rating || null;
    refreshCellarList();
    if (currentBottle !== bottle) return;
    renderStats(bottle);
    const mine = await loadNotes(bottle.id);
    if (currentBottle !== bottle) return;
    ownNote = mine.find((n) => n.id === savedNoteId) ?? null;
    renderNoteCard(ownNote);
  });

  document.getElementById('loc-edit-btn')?.addEventListener('click', () => {
    if (!currentBottle) return;
    openLocationPicker(currentBottle, (updated) => {
      if (currentBottle && updated && currentBottle !== updated && currentBottle.id === updated.id) currentBottle.places = updated.places;
      document.getElementById('loc-value').textContent = locationLabel(updated) || 'Non assegnata';
    });
  });
}

wireStaticControls();
