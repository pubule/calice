import { api } from '../api-client.js';
import { escapeHtml } from '../util.js';
import { FLAVOR_CATEGORIES } from '../tasting-profile.js';
import { AROMA_GUIDE, TAG_WINES, TAG_NOTES, WINE_STYLES } from '../data/aroma-guide.js';
import { expectationHtml, wineOptionsHtml, typeOptionsHtml } from '../wine-expectation.js';

// Ruota degli aromi (#/aromi). Two panes:
// - "Aromi": a half dial of the aroma families that turns under the finger (or
//   with the arrows); the family at the top pointer drives the card below —
//   origin, description, every aroma, the wines known for the most of them.
//   Tapping an aroma opens its detail above the card.
// - "Il mio palato": the full wheel with a spike per aroma, as long as how
//   often the user picked it in their own notes (GET /api/me/palate).
// Same vocabulary as the note composer (FLAVOR_CATEGORIES), so every aroma a
// note can record is on the wheel and nothing else is.

const NS = 'http://www.w3.org/2000/svg';
const N = FLAVOR_CATEGORIES.length;
const STEP = 360 / N;

let famIdx = 0;
let rotation = 0;
let selectedTag = null;
let filterType = '';
let filterWine = '';
let pane = 'wheel';
let palate = { notes: 0, tags: {} };
let wired = false;

function svgEl(name, attrs) {
  const e = document.createElementNS(NS, name);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}
// Angles in degrees, clockwise from 12 o'clock, around (150,150).
function pt(r, a) {
  const t = ((a - 90) * Math.PI) / 180;
  return [150 + r * Math.cos(t), 150 + r * Math.sin(t)];
}
function arc(r0, r1, a0, a1) {
  const big = a1 - a0 > 180 ? 1 : 0;
  const [x0, y0] = pt(r1, a0), [x1, y1] = pt(r1, a1), [x2, y2] = pt(r0, a1), [x3, y3] = pt(r0, a0);
  return `M${x0},${y0}A${r1},${r1} 0 ${big} 1 ${x1},${y1}L${x2},${y2}A${r0},${r0} 0 ${big} 0 ${x3},${y3}Z`;
}
const familyOf = (tag) => FLAVOR_CATEGORIES.find((f) => f.tags.includes(tag));

// Wine → its aromas, in wheel order, from TAG_WINES (aroma → wines).
function aromasByWine(tags) {
  const map = new Map();
  for (const t of tags) for (const w of TAG_WINES[t] ?? []) map.set(w, [...(map.get(w) ?? []), t]);
  return map;
}
const ALL_TAGS = FLAVOR_CATEGORIES.flatMap((f) => f.tags);
const WINE_AROMAS = aromasByWine(ALL_TAGS);
const WINE_AROMAS_BY_NAME = (w) => WINE_AROMAS.get(w) ?? [];

// A family's wines: those named for the most of its aromas first (ties keep
// wheel order), each with the aromas of this family it shows.
function familyWines(f, limit = 6) {
  return [...aromasByWine(f.tags)].sort((a, b) => b[1].length - a[1].length).slice(0, limit);
}
function wineRowsHtml(rows) {
  return `<div class="aroma-wines">${rows
    .map(([w, tags]) => `<div><span>${escapeHtml(w)}</span><span>${escapeHtml(tags.join(', ').toLowerCase())}</span></div>`)
    .join('')}</div>`;
}

function timesLabel(n) {
  return n ? `Nelle tue note: ${n} ${n === 1 ? 'volta' : 'volte'}` : 'Non ancora nelle tue note';
}

// ---- Aromi: dial ----

function buildDial() {
  const svg = document.getElementById('aroma-dial');
  svg.innerHTML = '';
  const spin = svgEl('g', { class: 'aroma-spin' });
  FLAVOR_CATEGORIES.forEach((f, i) => {
    const a0 = i * STEP - STEP / 2, a1 = i * STEP + STEP / 2;
    const slice = svgEl('path', { d: arc(70, 148, a0 + 0.6, a1 - 0.6), fill: f.bg, stroke: '#f7f5f0', 'stroke-width': 2 });
    slice.dataset.idx = i;
    spin.appendChild(slice);
    // A few dots along the rim: decoration hinting that each slice holds many aromas.
    for (let k = 0; k < 6; k++) {
      const [x, y] = pt(136, a0 + (STEP * (k + 0.5)) / 6);
      spin.appendChild(svgEl('circle', { cx: x, cy: y, r: 2.2, fill: f.fg, opacity: 0.5, 'pointer-events': 'none' }));
    }
    // How many of the filtered wine's aromas sit in this family (hidden
    // without a wine filter). Rotated with the slice like its label.
    const [bx, by] = pt(132, i * STEP);
    const badge = svgEl('g', { class: 'aroma-badge', 'pointer-events': 'none', transform: `rotate(${i * STEP} ${bx} ${by})` });
    badge.dataset.idx = i;
    badge.appendChild(svgEl('circle', { cx: bx, cy: by, r: 9.5, fill: f.fg }));
    const bt = svgEl('text', { x: bx, y: by + 0.5, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-size': 11, 'font-weight': 700, fill: '#ffffff' });
    badge.appendChild(bt);
    spin.appendChild(badge);
    const [x, y] = pt(104, i * STEP);
    const label = svgEl('text', {
      x, y, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-size': 12, 'font-weight': 600,
      fill: f.fg, transform: `rotate(${i * STEP} ${x} ${y})`, 'pointer-events': 'none',
    });
    label.textContent = f.label;
    spin.appendChild(label);
  });
  svg.appendChild(spin);
  svg.appendChild(svgEl('path', { d: 'M143 3 L157 3 L150 15 Z', fill: '#5b2333' }));
}

function goTo(i) {
  // Shortest way round, so going from the last family to the first turns one
  // slice forward instead of spinning back through all of them.
  const delta = ((((i - famIdx) % N) + N + N / 2) % N) - N / 2;
  famIdx = (((i % N) + N) % N);
  rotation -= delta * STEP;
  selectedTag = null;
  renderWheelPane();
}

function familyCardHtml(f) {
  const guide = AROMA_GUIDE[f.id];
  const wines = familyWines(f);
  const chips = f.tags
    .map((t) => `<div class="chip${t === selectedTag ? ' active' : ''}" data-tag="${escapeHtml(t)}" role="button" tabindex="0" aria-pressed="${t === selectedTag}">${escapeHtml(t)}</div>`)
    .join('');
  return `
    <div class="aroma-card">
      <span class="aroma-pill" style="background:${f.bg};color:${f.fg}">${escapeHtml(guide.origin)}</span>
      <div class="aroma-card-title">${escapeHtml(f.label)}</div>
      <p class="aroma-card-desc">${escapeHtml(guide.desc)}</p>
      <div class="chip-row aroma-chips">${chips}</div>
      ${wines.length ? `<div class="field-label">Dove lo trovi</div>${wineRowsHtml(wines)}` : ''}
    </div>`;
}

function tagCardHtml(tag) {
  const f = familyOf(tag);
  const guide = AROMA_GUIDE[f.id];
  // Each wine with every aroma it is known for, so "Barolo" under Rosa also
  // reads catrame, tabacco, liquirizia… — the aroma in context.
  const wines = (TAG_WINES[tag] ?? []).map((w) => [w, [tag, ...(WINE_AROMAS.get(w) ?? []).filter((t) => t !== tag)].slice(0, 6)]);
  const body = TAG_NOTES[tag]
    ? `<p class="aroma-card-desc">${escapeHtml(TAG_NOTES[tag])}</p>`
    : wines.length && !filterWine
      ? `<div class="field-label">Vini in cui si trova</div>${wineRowsHtml(wines)}`
      : `<p class="aroma-card-desc">${escapeHtml(guide.desc)}</p>`;
  return `
    <div class="aroma-card aroma-tag-card">
      <span class="aroma-pill" style="background:${f.bg};color:${f.fg}">${escapeHtml(f.label)} · ${escapeHtml(guide.origin)}</span>
      <div class="aroma-card-title">${escapeHtml(tag)}</div>
      ${body}
      <div class="aroma-mine">${timesLabel(palate.tags[tag] ?? 0)}</div>
    </div>`;
}

function renderWheelPane() {
  const f = FLAVOR_CATEGORIES[famIdx];
  const spin = document.querySelector('#aroma-dial .aroma-spin');
  if (spin) spin.style.transform = `rotate(${rotation}deg)`;
  const wineTags = filterWine ? WINE_AROMAS_BY_NAME(filterWine) : [];
  const countIn = (i) => wineTags.filter((t) => FLAVOR_CATEGORIES[i].tags.includes(t)).length;
  document.querySelectorAll('#aroma-dial path[data-idx]').forEach((p) => {
    const i = Number(p.dataset.idx);
    if (!filterWine) p.style.opacity = i === famIdx ? '1' : '0.55';
    else p.style.opacity = countIn(i) ? (i === famIdx ? '1' : '0.8') : '0.2';
  });
  document.querySelectorAll('#aroma-dial .aroma-badge').forEach((g) => {
    const n = filterWine ? countIn(Number(g.dataset.idx)) : 0;
    g.style.display = n ? '' : 'none';
    g.querySelector('text').textContent = String(n);
  });
  const label = document.getElementById('aroma-dial-label');
  label.textContent = f.label;
  label.style.color = f.fg;
  const n = countIn(famIdx);
  document.querySelector('.aroma-hint').textContent = filterWine
    ? (n ? `${n} ${n === 1 ? 'aroma tipico' : 'aromi tipici'} di ${filterWine} in questa famiglia` : `Nessun aroma tipico di ${filterWine} qui`)
    : 'Trascina la ruota o usa le frecce';
  // With a wine chosen, "Cosa aspettarti" already lists its aromas family by
  // family, so the family card would only repeat them: the dial highlights
  // the matching group there instead.
  document.getElementById('aroma-card').innerHTML = filterWine
    ? (selectedTag ? tagCardHtml(selectedTag) : '') + `<div class="aroma-card">${expectationHtml(filterWine, { selectedTag, currentFamily: f.id })}</div>`
    : (selectedTag ? tagCardHtml(selectedTag) : '') + familyCardHtml(f);
}

// ---- Il mio palato ----

function renderPalatePane() {
  const svg = document.getElementById('palate-wheel');
  const list = document.getElementById('palate-list');
  svg.innerHTML = '';
  const total = FLAVOR_CATEGORIES.reduce((s, f) => s + f.tags.length, 0);
  const max = Math.max(1, ...Object.values(palate.tags));
  let a = 0;
  FLAVOR_CATEGORIES.forEach((f) => {
    const span = (360 * f.tags.length) / total;
    const step = span / f.tags.length;
    const used = f.tags.some((t) => palate.tags[t]);
    svg.appendChild(svgEl('path', { d: arc(40, 76, a + 0.5, a + span - 0.5), fill: f.bg, opacity: used ? 1 : 0.5, stroke: '#f7f5f0', 'stroke-width': 1.5 }));
    f.tags.forEach((t, i) => {
      const n = palate.tags[t] ?? 0;
      const w = n / max;
      svg.appendChild(svgEl('path', {
        d: arc(80, n ? 108 + 38 * w : 98, a + i * step + 0.3, a + (i + 1) * step - 0.3),
        fill: n ? f.fg : '#e7e2d8', opacity: n ? 0.4 + 0.6 * w : 1,
      }));
    });
    a += span;
  });
  svg.appendChild(svgEl('circle', { cx: 150, cy: 150, r: 36, fill: '#ffffff', stroke: '#e2e0d8' }));
  const count = svgEl('text', { x: 150, y: 148, 'text-anchor': 'middle', 'font-size': 20, 'font-family': 'Newsreader, serif', fill: '#241e1a' });
  count.textContent = String(palate.notes);
  svg.appendChild(count);
  const sub = svgEl('text', { x: 150, y: 165, 'text-anchor': 'middle', 'font-size': 10, fill: '#736a5d' });
  sub.textContent = palate.notes === 1 ? 'nota' : 'note';
  svg.appendChild(sub);

  const ranked = Object.keys(palate.tags).filter(familyOf).sort((x, y) => palate.tags[y] - palate.tags[x]);
  if (!ranked.length) {
    list.innerHTML = `<div class="aroma-card"><p class="aroma-card-desc">Qui compariranno gli aromi che ritrovi più spesso. Quando scrivi una nota di degustazione, scegli gli aromi nel profilo aromatico: ogni scelta allunga il suo spicchio sulla ruota.</p></div>`;
    return;
  }
  const groups = FLAVOR_CATEGORIES.map((f) => [f, ranked.filter((t) => familyOf(t) === f)]).filter(([, ts]) => ts.length);
  list.innerHTML = `
    <div class="aroma-card">
      <div class="field-label">Gli aromi che scrivi di più</div>
      ${groups.map(([f, ts]) => `
        <div class="palate-group">
          <div class="palate-fam" style="color:${f.fg}"><span class="palate-dot" style="background:${f.fg}"></span>${escapeHtml(f.label)}</div>
          <div class="chip-row">${ts.map((t) => `<span class="chip palate-chip">${escapeHtml(t)} · ${palate.tags[t]}</span>`).join('')}</div>
        </div>`).join('')}
    </div>`;
}

function selectPane(next) {
  pane = next;
  document.querySelectorAll('#aroma-tabs button').forEach((b) => {
    const on = b.dataset.pane === next;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  document.getElementById('aroma-pane-wheel').classList.toggle('hidden', next !== 'wheel');
  document.getElementById('aroma-pane-palate').classList.toggle('hidden', next !== 'palate');
  if (next === 'palate') renderPalatePane();
}

function wireStaticControls() {
  document.getElementById('aromas-back-btn')?.addEventListener('click', () => { window.location.hash = '#/home'; });
  document.getElementById('aroma-prev')?.addEventListener('click', () => goTo(famIdx - 1));
  document.getElementById('aroma-next')?.addEventListener('click', () => goTo(famIdx + 1));
  document.querySelectorAll('#aroma-tabs button').forEach((b) => b.addEventListener('click', () => selectPane(b.dataset.pane)));

  // Tap a slice to bring it under the pointer; a horizontal swipe turns the
  // dial one family. touch-action:pan-y on the svg keeps vertical scrolling.
  const dial = document.getElementById('aroma-dial');
  let startX = null;
  dial.addEventListener('pointerdown', (e) => { startX = e.clientX; });
  dial.addEventListener('pointerup', (e) => {
    if (startX == null) return;
    const dx = e.clientX - startX;
    startX = null;
    if (Math.abs(dx) > 24) goTo(famIdx + (dx < 0 ? 1 : -1));
    else if (e.target.dataset?.idx != null) goTo(Number(e.target.dataset.idx));
  });
  dial.addEventListener('pointercancel', () => { startX = null; });

  const typeSel = document.getElementById('aroma-type');
  const wineSel = document.getElementById('aroma-wine');
  typeSel.innerHTML = typeOptionsHtml('Tutti i tipi');
  wineSel.innerHTML = wineOptionsHtml('', 'Tutti i vini');
  typeSel.addEventListener('change', () => {
    filterType = typeSel.value;
    // A type that excludes the chosen wine clears it.
    if (filterWine && filterType && WINE_STYLES[filterWine].type !== filterType) filterWine = '';
    wineSel.innerHTML = wineOptionsHtml(filterType, 'Tutti i vini');
    wineSel.value = filterWine;
    applyWineFilter();
  });
  wineSel.addEventListener('change', () => {
    filterWine = wineSel.value;
    if (filterWine && !filterType) { filterType = WINE_STYLES[filterWine].type; typeSel.value = filterType; wineSel.innerHTML = wineOptionsHtml(filterType, 'Tutti i vini'); wineSel.value = filterWine; }
    applyWineFilter();
  });

  document.getElementById('aroma-card').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-tag]');
    if (!chip) return;
    const tag = chip.dataset.tag;
    selectedTag = selectedTag === tag ? null : tag;
    // A tag picked from the expectation card may belong to another family:
    // turn the dial there so the family card below shows it in context.
    const fi = FLAVOR_CATEGORIES.indexOf(familyOf(tag));
    if (selectedTag && fi !== famIdx) { const keep = selectedTag; goTo(fi); selectedTag = keep; }
    renderWheelPane();
    if (selectedTag) document.querySelector('#aroma-card .aroma-tag-card')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
}

// With a wine chosen, turn the dial to the family holding most of its
// aromas: the answer to "what should I expect" is on screen at once.
function applyWineFilter() {
  selectedTag = null;
  if (filterWine) {
    const tags = WINE_AROMAS_BY_NAME(filterWine);
    let best = famIdx, bestN = -1;
    FLAVOR_CATEGORIES.forEach((f, i) => { const n = tags.filter((t) => f.tags.includes(t)).length; if (n > bestN) { bestN = n; best = i; } });
    if (best !== famIdx) { goTo(best); return; }
  }
  renderWheelPane();
}

export async function mountAromas() {
  if (!wired) {
    buildDial();
    wireStaticControls();
    wired = true;
  }
  selectedTag = null;
  selectPane('wheel');
  renderWheelPane();
  try {
    palate = await api.get('/api/me/palate');
  } catch (err) {
    console.error(err);
    palate = { notes: 0, tags: {} };
  }
  if (pane === 'palate') renderPalatePane();
}
