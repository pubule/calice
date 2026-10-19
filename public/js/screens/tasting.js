import { escapeHtml } from '../util.js';
import { confirmModal } from '../modal.js';
import { navigate } from '../router.js';
import { FLAVOR_CATEGORIES, FOOD_PAIRINGS, TASTE_AXES, TASTE_STEPS, toStep, fromStep } from '../tasting-profile.js';
import { openAddSheet } from './add.js';
import { showAfterMount } from './cellar.js';
import { WINE_STYLES } from '../data/aroma-guide.js';
import { expectedTags, expectedTaste, typeOptionsHtml, wineOptionsHtml } from '../wine-expectation.js';

// Assaggio guidato (#/assaggio, optional ?vino=<wheel wine>): pick a wine of
// the aroma wheel — no bottle needed — then three steps, Naso → Bocca →
// Giudizio, each showing what to expect, and a summary of expected vs felt.
// Bocca also asks which aromas come back in the mouth (retronasal), kept
// apart from the nose's only so the summary can say where each was found.
// The last step places it (user's choice, from a mockup): "Aggiungi alla
// cantina" / "Aggiungi ai desideri" open the "+" search, and the tasting
// becomes the note of the wine picked there (nose and mouth aromas in one
// list, pairings from Giudizio); "Non salvare" leaves no trace. A tasting is
// never stored on its own.

const STEPS = ['nose', 'mouth', 'verdict'];
const STEP_TITLE = { start: 'Assaggio guidato', nose: 'Naso', mouth: 'Bocca', verdict: 'Giudizio', summary: 'Riepilogo' };

let state = freshState();
let wired = false;

function freshState(wine = '') {
  return {
    step: 'start', type: wine ? WINE_STYLES[wine]?.type ?? '' : '', wine, label: '',
    felt: new Set(), extraFam: FLAVOR_CATEGORIES[0].id,
    // Aromas found again in the mouth (retronasal): the nose is where every
    // aroma is recognised, the mouth confirms some of them, often more clearly.
    mouth: new Set(),
    // null = slider not touched: never saved, so the expected value shown as
    // a hint can't silently become the user's answer.
    taste: TASTE_AXES.map(() => null), stars: 0, text: '', pairings: new Set(),
  };
}

const body = () => document.getElementById('tasting-body');
// Thumb centre for a stored 0-100 value, on the 1-10 step scale shared with
// the note composer (tasting-profile.js): inset by half the thumb (42px) so it
// never leaves the track; the expected marker uses the same scale to line up.
const pos = (v) => `calc(21px + (100% - 42px) * ${(toStep(v) - 1) / (TASTE_STEPS - 1)})`;
const familyOf = (tag) => FLAVOR_CATEGORIES.find((f) => f.tags.includes(tag));
function starsText(n) {
  return n ? '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n)) : '';
}

// ---- header ----

function headerHtml() {
  const stepIdx = STEPS.indexOf(state.step);
  const title = state.step === 'start' ? STEP_TITLE.start : STEP_TITLE[state.step];
  return `
    <div class="topbar tasting-top">
      <div class="back-btn" id="tasting-back" role="button" tabindex="0" aria-label="Indietro"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg></div>
      <h2 class="screen-title">${escapeHtml(title)}</h2>
      ${stepIdx >= 0 ? `<span class="tasting-stepn">${stepIdx + 1} di 3</span>` : ''}
    </div>
    ${stepIdx >= 0 ? stepperHtml(stepIdx) : ''}
    ${state.step !== 'start' ? `<span class="aroma-pill tasting-wine">${escapeHtml(state.label ? `${state.wine} · ${state.label}` : state.wine)}</span>` : ''}
    ${stepIdx >= 0 ? stepIntroHtml(STEPS[stepIdx]) : ''}`;
}

// The three moments, each with its icon (chosen by the user on a mockup:
// nose = face profile with scents, mouth = lips, verdict = star) and colour,
// in the style of the Home and wheel badges.
const STEP_UI = {
  nose: {
    label: 'Naso', bg: '#f5e9ef', fg: '#8a4a6a',
    what: 'Annusa il bicchiere fermo, poi fallo ruotare e annusa di nuovo: tocca gli aromi che riconosci.',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M16.5 2.5c-.3 1.6-.7 2.8-1.2 3.8l-3.6 5c-.3.4 0 .9.5.9h2.6"/><path d="M14.6 14.4h-1.1"/><path d="M14.8 16.4c-.7 0-1.1.3-1.1.8 0 1.5 1.1 2.6 2.8 2.9"/><path d="M8.6 7.6c-1 .9-1 2.1 0 3"/><path d="M5.8 6c-2 1.8-2 4.4 0 6.2"/></svg>',
  },
  mouth: {
    label: 'Bocca', bg: '#f4e8eb', fg: '#5b2333',
    what: 'Un piccolo sorso, fallo girare in bocca: valuta struttura e sensazioni, poi gli aromi che tornano.',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12c2.3-2.6 4.7-3.6 6.6-2.8.9.4 1.6.6 2.4.6s1.5-.2 2.4-.6C16.3 8.4 18.7 9.4 21 12c-2.6 3.7-5.6 5.5-9 5.5S5.6 15.7 3 12z"/><path d="M3 12c3 1.3 6 1.8 9 1.8s6-.5 9-1.8"/></svg>',
  },
  verdict: {
    label: 'Giudizio', bg: '#f7f0e2', fg: '#8a6a24',
    what: "Com'era nell'insieme? Dai un voto e scrivi due righe.",
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M12 3.8l2.4 5 5.4.7-4 3.7 1 5.4-4.8-2.6-4.8 2.6 1-5.4-4-3.7 5.4-.7z"/></svg>',
  },
};

// Steps already reached can be revisited by tapping them; later ones can't
// be skipped to.
function stepperHtml(current) {
  return `<div class="tasting-stepper">${STEPS.map((id, i) => {
    const ui = STEP_UI[id];
    const cls = i === current ? ' on' : i < current ? ' done' : '';
    const attrs = i < current ? `data-step="${id}" role="button" tabindex="0"` : `aria-disabled="true"`;
    return `<div class="tasting-st${cls}" style="--st-bg:${ui.bg};--st-fg:${ui.fg}" ${attrs}${i === current ? ' aria-current="step"' : ''}>
      <span class="tasting-st-badge" aria-hidden="true">${ui.icon}</span>${escapeHtml(ui.label)}</div>`;
  }).join('')}</div>`;
}

function stepIntroHtml(id) {
  const ui = STEP_UI[id];
  return `<div class="tasting-intro" style="background:${ui.bg}">
    <span class="tasting-intro-badge" style="color:${ui.fg}" aria-hidden="true">${ui.icon}</span>
    <p>${escapeHtml(ui.what)}</p></div>`;
}

// ---- start ----

function startHtml() {
  const n = state.wine ? expectedTags(state.wine).length : 0;
  return `
    <p class="tasting-lede">Scegli cosa stai bevendo: l'app ti guida passo passo e alla fine confronta quello che hai sentito con quello che ci si aspetta da quel vino. Poi lo metti in cantina o nei desideri, e l'assaggio diventa la sua nota.</p>
    <div class="aroma-card">
      <div class="field-label">Cosa assaggi</div>
      <select id="tasting-type" class="search" aria-label="Tipo di vino">${typeOptionsHtml('Tutti i tipi')}</select>
      <select id="tasting-wine" class="search" aria-label="Vino">${wineOptionsHtml(state.type, 'Scegli il vino')}</select>
      <input id="tasting-label" class="search" type="text" maxlength="200" placeholder="Etichetta (facoltativa), es. Cannubi 2019 Brezza" aria-label="Etichetta" value="${escapeHtml(state.label)}">
      ${state.wine ? `<p class="aroma-card-desc">${n} aromi attesi e il gusto tipico di un ${escapeHtml(state.wine)} ti accompagneranno nei tre passi.</p>` : ''}
      <button type="button" class="primary-btn" id="tasting-start" ${state.wine ? '' : 'disabled'}>Inizia l'assaggio</button>
    </div>`;
}

// ---- 1. nose ----

function chipHtml(tag, expected) {
  const on = state.felt.has(tag);
  return `<div class="chip${expected ? ' expected' : ''}${on ? ' active' : ''}" data-felt="${escapeHtml(tag)}" role="button" tabindex="0" aria-pressed="${on}">${on ? '✓ ' : ''}${escapeHtml(tag)}</div>`;
}

function noseHtml() {
  const exp = expectedTags(state.wine);
  const groups = FLAVOR_CATEGORIES.map((f) => [f, exp.filter((t) => f.tags.includes(t))]).filter(([, ts]) => ts.length);
  const fam = FLAVOR_CATEGORIES.find((f) => f.id === state.extraFam);
  const extras = [...state.felt].filter((t) => !exp.includes(t));
  return `
    <div class="aroma-card">
      <div class="field-label">Aromi attesi in un ${escapeHtml(state.wine)}</div>
      <p class="aroma-card-desc">Non devi trovarli tutti.</p>
      ${groups.map(([f, ts]) => `<div class="expect-group"><span class="expect-fam" style="color:${f.fg}">${escapeHtml(f.label)}</span><div class="chip-row">${ts.map((t) => chipHtml(t, true)).join('')}</div></div>`).join('')}
    </div>
    <div class="aroma-card">
      <div class="field-label">Senti altro?</div>
      <div class="chip-row">${FLAVOR_CATEGORIES.map((f) => `<div class="chip${f.id === state.extraFam ? ' active' : ''}" data-fam="${f.id}" role="button" tabindex="0" aria-pressed="${f.id === state.extraFam}">${escapeHtml(f.label)}</div>`).join('')}</div>
      <div class="chip-row">${fam.tags.filter((t) => !exp.includes(t)).map((t) => chipHtml(t, false)).join('')}</div>
      ${extras.length ? `<p class="aroma-card-desc">In più: <b>${extras.map(escapeHtml).join(', ')}</b></p>` : ''}
    </div>
    <div class="tasting-foot"><button type="button" class="primary-btn" data-step="mouth">Avanti · Bocca</button></div>`;
}

// ---- 2. mouth ----

function mouthHtml() {
  const exp = expectedTaste(state.wine);
  return `
    <div class="tasting-legend"><span><i class="lg-exp"></i>atteso</span><span><i class="lg-you"></i>il tuo assaggio</span></div>
    <div class="aroma-card tasting-sliders">
      ${TASTE_AXES.map((axis, i) => {
        const v = state.taste[i];
        const shown = v ?? exp[i] ?? 50;
        return `<div class="gs" data-axis="${i}">
          <div class="gs-labels"><span class="${v != null && v < 40 ? 'dom' : ''}">${escapeHtml(axis.left)}</span><span class="gs-name">${escapeHtml(axis.name)}</span><span class="${v != null && v > 60 ? 'dom' : ''}">${escapeHtml(axis.right)}</span></div>
          <div class="gs-track${v == null ? ' untouched' : ''}" role="slider" tabindex="0" aria-label="${escapeHtml(axis.name)}" aria-valuemin="1" aria-valuemax="10" aria-valuenow="${toStep(shown)}" aria-valuetext="${v == null ? 'non valutato' : `${toStep(shown)} su 10`}">
            ${exp[i] == null ? '' : `<span class="gs-exp" style="left:${pos(exp[i])}"></span>`}
            <span class="gs-thumb" style="left:${pos(shown)}">${v == null ? '' : toStep(v)}</span>
          </div>
        </div>`;
      }).join('')}
      <p class="tasting-hint">Un cursore grigio non è ancora valutato: se non lo tocchi non viene salvato.</p>
    </div>
    <div class="aroma-card">
      <div class="field-label">Aromi in bocca</div>
      <p class="aroma-card-desc">Dopo aver deglutito gli aromi risalgono al naso da dietro: quali ritrovi? Spesso il frutto è più netto qui che al naso.</p>
      <div class="chip-row">${mouthCandidates().map((t) => { const on = state.mouth.has(t); const exp = expectedTags(state.wine).includes(t);
        return `<div class="chip${exp ? ' expected' : ''}${on ? ' active' : ''}" data-mouth="${escapeHtml(t)}" role="button" tabindex="0" aria-pressed="${on}">${on ? '✓ ' : ''}${escapeHtml(t)}</div>`; }).join('')}</div>
    </div>
    <div class="tasting-foot"><button type="button" class="primary-btn" data-step="verdict">Avanti · Giudizio</button></div>`;
}

// What the nose found first, then the rest of what's expected for the wine.
function mouthCandidates() {
  const exp = expectedTags(state.wine);
  return [...new Set([...state.felt, ...exp, ...state.mouth])];
}

function wireSliders() {
  body().querySelectorAll('.gs').forEach((gs) => {
    const i = Number(gs.dataset.axis);
    const track = gs.querySelector('.gs-track');
    const set = (step) => {
      state.taste[i] = fromStep(step);
      const thumb = track.querySelector('.gs-thumb');
      track.classList.remove('untouched');
      thumb.style.left = pos(state.taste[i]);
      thumb.textContent = String(toStep(state.taste[i]));
      track.setAttribute('aria-valuenow', String(toStep(state.taste[i])));
      track.setAttribute('aria-valuetext', `${toStep(state.taste[i])} su 10`);
      const [l, , r] = gs.querySelectorAll('.gs-labels span');
      l.classList.toggle('dom', state.taste[i] < 40);
      r.classList.toggle('dom', state.taste[i] > 60);
    };
    const fromX = (x) => { const rect = track.getBoundingClientRect(); set(1 + ((x - rect.left - 21) / (rect.width - 42)) * (TASTE_STEPS - 1)); };
    track.addEventListener('pointerdown', (e) => {
      track.setPointerCapture(e.pointerId);
      fromX(e.clientX);
      const move = (ev) => fromX(ev.clientX);
      track.addEventListener('pointermove', move);
      const end = () => track.removeEventListener('pointermove', move);
      track.addEventListener('pointerup', end, { once: true });
      track.addEventListener('pointercancel', end, { once: true });
    });
    track.addEventListener('keydown', (e) => {
      const delta = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
      if (delta == null) return;
      e.preventDefault();
      set(toStep(state.taste[i] ?? expectedTaste(state.wine)[i] ?? 50) + delta);
    });
  });
}

// ---- 3. verdict ----

function verdictHtml() {
  return `
    <div class="aroma-card add-note">
      <div class="field-label">Voto</div>
      <div class="stars-input" id="tasting-stars">${[1, 2, 3, 4, 5].map((n) => `<span class="${n <= state.stars ? 'on' : ''}" data-star="${n}" role="button" tabindex="0" aria-label="${n} ${n === 1 ? 'stella' : 'stelle'}">★</span>`).join('')}</div>
      <div class="field-label">La tua nota</div>
      <textarea id="tasting-text" maxlength="2000" placeholder="Com'era? Con cosa l'hai bevuto?" aria-label="La tua nota">${escapeHtml(state.text)}</textarea>
    </div>
    <div class="aroma-card">
      <div class="field-label">Abbinamenti</div>
      <p class="aroma-card-desc">Facoltativi: con cosa lo berresti.</p>
      <div class="chip-row">${FOOD_PAIRINGS.map((t) => { const on = state.pairings.has(t);
        return `<div class="chip${on ? ' active' : ''}" data-pairing="${escapeHtml(t)}" role="button" tabindex="0" aria-pressed="${on}">${escapeHtml(t)}</div>`; }).join('')}</div>
    </div>
    <div class="tasting-foot"><button type="button" class="primary-btn" data-step="summary">Vedi il riepilogo</button></div>`;
}

// ---- summary, then where the tasting goes ----

function comparison(wine, felt, taste) {
  const exp = expectedTags(wine);
  const expTaste = expectedTaste(wine);
  const found = exp.filter((t) => felt.includes(t));
  const extra = felt.filter((t) => !exp.includes(t));
  const rows = TASTE_AXES.map((axis, i) => {
    const v = taste[i];
    if (v == null) return [axis.name, 'non valutato', false];
    if (expTaste[i] == null) return [axis.name, v < 40 ? axis.left : v > 60 ? axis.right : 'equilibrato', false];
    const d = v - expTaste[i];
    if (Math.abs(d) < 15) return [axis.name, 'come previsto', false];
    return [axis.name, `più ${(d > 0 ? axis.right : axis.left).toLowerCase()} del previsto`, true];
  });
  return { exp, found, extra, rows };
}

function whereRows(felt, mouth) {
  return [...new Set([...felt, ...mouth])].map((t) => {
    const n = felt.includes(t), m = mouth.includes(t);
    return [t, n && m ? 'al naso e in bocca' : n ? 'solo al naso' : 'solo in bocca'];
  });
}

function summaryHtml({ wine, felt, mouth, taste, stars, text, pairings }) {
  const { exp, found, extra, rows } = comparison(wine, felt, taste);
  const where = mouth.length ? whereRows(felt, mouth) : [];
  return `
    <div class="aroma-card">
      <div class="field-label">Naso</div>
      <div class="tasting-score"><b>${found.length} di ${exp.length}</b><span>aromi attesi ritrovati</span></div>
      ${found.length ? `<div class="chip-row">${found.map((t) => `<span class="chip active">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
      ${extra.length ? `<p class="aroma-card-desc">Hai sentito anche <b>${extra.map(escapeHtml).join(', ')}</b>: non è tipico di un ${escapeHtml(wine)}, vale la pena annotarlo.</p>` : ''}
    </div>
    <div class="aroma-card">
      <div class="field-label">Bocca</div>
      ${where.length ? `<div class="aroma-wines tasting-where">${where.map(([t, w]) => `<div><span>${escapeHtml(t)}</span><span>${escapeHtml(w)}</span></div>`).join('')}</div>` : ''}
      <div class="aroma-wines tasting-diff">${rows.map(([n, t, off]) => `<div class="${off ? 'off' : ''}"><span>${escapeHtml(n)}</span><span>${escapeHtml(t)}</span></div>`).join('')}</div>
    </div>
    <div class="aroma-card">
      <div class="field-label">Giudizio</div>
      <span class="tasting-stars big" aria-label="${stars} stelle">${stars ? starsText(stars) : 'Senza voto'}</span>
      ${text ? `<p class="aroma-card-desc">${escapeHtml(text)}</p>` : ''}
      ${pairings.length ? `<div class="chip-row">${pairings.map((t) => `<span class="chip">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
    </div>
    <div class="tasting-place">
      <h3 class="tasting-place-title">Dove lo metto?</h3>
      <p class="aroma-card-desc">L'assaggio diventa la nota del vino che scegli.</p>
      <button type="button" class="primary-btn" data-place="cellar">Aggiungi alla cantina</button>
      <button type="button" class="secondary-btn" data-place="wish">Aggiungi ai desideri</button>
      <button type="button" class="tasting-discard" id="tasting-discard">Non salvare</button>
    </div>`;
}

// ---- render & navigation ----

function render() {
  let html = headerHtml();
  if (state.step === 'start') html += startHtml();
  else if (state.step === 'nose') html += noseHtml();
  else if (state.step === 'mouth') html += mouthHtml();
  else if (state.step === 'verdict') html += verdictHtml();
  else if (state.step === 'summary') html += summaryHtml({ wine: state.wine, felt: [...state.felt], mouth: [...state.mouth], taste: state.taste, stars: state.stars, text: state.text, pairings: [...state.pairings] });
  body().innerHTML = html;
  if (state.step === 'start') {
    document.getElementById('tasting-type').value = state.type;
    document.getElementById('tasting-wine').value = state.wine;
  }
  if (state.step === 'mouth') wireSliders();
}

function goStep(step) {
  state.step = step;
  render();
  document.getElementById('view-tasting').scrollTop = 0;
}

function back() {
  const order = ['start', ...STEPS, 'summary'];
  const i = order.indexOf(state.step);
  if (i <= 0) { window.location.hash = '#/home'; return; }
  goStep(order[i - 1]);
}

// The tasting as a note body (what POST /api/bottles/:id/notes takes): nose
// and mouth aromas in one list, untouched sliders left out.
function noteBody() {
  const note = { rating: state.stars, text: state.text.trim(), flavorTags: [...new Set([...state.felt, ...state.mouth])], foodPairings: [...state.pairings] };
  TASTE_AXES.forEach((axis, i) => { note[axis.key] = state.taste[i]; });
  return note;
}

// The "+" search opens with what was tasted already typed; the tasting goes
// on the wine picked there, and the user lands where it went.
function place(mode) {
  openAddSheet({
    query: state.label || state.wine,
    tasting: {
      note: noteBody(),
      mode,
      done: ({ kind, bottle }) => {
        state = freshState();
        showAfterMount(kind === 'wish' ? { wishlist: true } : { bottleId: bottle?.id });
        navigate('#/cellar');
      },
    },
  });
}

async function discard() {
  const ok = await confirmModal("L'assaggio non verrà salvato da nessuna parte.", { title: 'Chiudere senza salvare?', confirmLabel: 'Non salvare', danger: true });
  if (!ok) return;
  state = freshState();
  goStep('start');
}

function wire() {
  const root = body();
  root.addEventListener('click', (e) => {
    if (e.target.closest('#tasting-back')) return back();
    if (e.target.closest('#tasting-start')) {
      state.label = document.getElementById('tasting-label').value.trim();
      return goStep('nose');
    }
    const stepBtn = e.target.closest('[data-step]');
    if (stepBtn) {
      if (state.step === 'verdict') state.text = document.getElementById('tasting-text').value;
      return goStep(stepBtn.dataset.step);
    }
    const placeBtn = e.target.closest('[data-place]');
    if (placeBtn) return place(placeBtn.dataset.place);
    if (e.target.closest('#tasting-discard')) return discard();
    const pairing = e.target.closest('[data-pairing]');
    if (pairing) {
      const tag = pairing.dataset.pairing;
      if (state.pairings.has(tag)) state.pairings.delete(tag); else state.pairings.add(tag);
      state.text = document.getElementById('tasting-text').value;
      return keepScroll(render);
    }
    const felt = e.target.closest('[data-felt]');
    if (felt) {
      const tag = felt.dataset.felt;
      if (state.felt.has(tag)) state.felt.delete(tag); else state.felt.add(tag);
      return keepScroll(render);
    }
    const mouth = e.target.closest('[data-mouth]');
    if (mouth) {
      const tag = mouth.dataset.mouth;
      if (state.mouth.has(tag)) state.mouth.delete(tag); else state.mouth.add(tag);
      return keepScroll(render);
    }
    const fam = e.target.closest('[data-fam]');
    if (fam) { state.extraFam = fam.dataset.fam; return keepScroll(render); }
    const star = e.target.closest('[data-star]');
    if (star) {
      const n = Number(star.dataset.star);
      state.stars = state.stars === n ? 0 : n;
      state.text = document.getElementById('tasting-text').value;
      return keepScroll(render);
    }
  });
  root.addEventListener('change', (e) => {
    if (e.target.id === 'tasting-type') {
      state.type = e.target.value;
      if (state.wine && state.type && WINE_STYLES[state.wine].type !== state.type) state.wine = '';
      state.label = document.getElementById('tasting-label').value;
      render();
    } else if (e.target.id === 'tasting-wine') {
      state.wine = e.target.value;
      if (state.wine && !state.type) state.type = WINE_STYLES[state.wine].type;
      state.label = document.getElementById('tasting-label').value;
      render();
    }
  });
  root.addEventListener('input', (e) => { if (e.target.id === 'tasting-text') state.text = e.target.value; });
}

function keepScroll(fn) {
  const view = document.getElementById('view-tasting');
  const y = view.scrollTop;
  fn();
  view.scrollTop = y;
}

export function mountTasting(search) {
  if (!wired) { wire(); wired = true; }
  const wine = search?.get('vino');
  // Coming from the wheel with a wine starts a fresh tasting of it; a plain
  // visit resumes whatever was in progress (leaving mid-way loses nothing).
  if (wine && WINE_STYLES[wine]) state = freshState(wine);
  render();
}
