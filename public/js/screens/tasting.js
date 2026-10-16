import { api } from '../api-client.js';
import { escapeHtml } from '../util.js';
import { confirmModal, alertModal } from '../modal.js';
import { showToast } from '../toast.js';
import { FLAVOR_CATEGORIES, TASTE_AXES, TASTE_STEPS, toStep, fromStep } from '../tasting-profile.js';
import { WINE_STYLES } from '../data/aroma-guide.js';
import { expectedTags, expectedTaste, typeOptionsHtml, wineOptionsHtml } from '../wine-expectation.js';

// Assaggio guidato (#/assaggio, optional ?vino=<wheel wine>): pick a wine of
// the aroma wheel — no bottle needed — then three steps, Naso → Bocca →
// Giudizio, each showing what to expect, and a summary of expected vs felt.
// Bocca also asks which aromas come back in the mouth (retronasal), stored
// apart from the nose's so the summary can say where each was found.
// Saved to /api/tastings (not to a bottle), listed on the start screen, and
// counted in Il mio palato. Chosen by the user from a mockup: steps as in the
// wheel's "Assaggia" idea, but as its own Home section with any wine.

const STEPS = ['nose', 'mouth', 'verdict'];
const STEP_TITLE = { start: 'Assaggio guidato', nose: 'Naso', mouth: 'Bocca', verdict: 'Giudizio', summary: 'Riepilogo', past: 'Assaggio' };

let state = freshState();
let history = [];
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
    taste: TASTE_AXES.map(() => null), stars: 0, text: '', past: null,
  };
}

const body = () => document.getElementById('tasting-body');
// Thumb centre for a stored 0-100 value, on the 1-10 step scale shared with
// the note composer (tasting-profile.js): inset by half the thumb (42px) so it
// never leaves the track; the expected marker uses the same scale to line up.
const pos = (v) => `calc(21px + (100% - 42px) * ${(toStep(v) - 1) / (TASTE_STEPS - 1)})`;
const familyOf = (tag) => FLAVOR_CATEGORIES.find((f) => f.tags.includes(tag));
function formatDate(iso) {
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
}
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
    ${stepIdx >= 0 ? `<div class="tasting-bar" aria-hidden="true">${STEPS.map((_, i) => `<span class="${i <= stepIdx ? 'on' : ''}"></span>`).join('')}</div>` : ''}
    ${state.step !== 'start' && state.step !== 'past' ? `<span class="aroma-pill tasting-wine">${escapeHtml(state.label ? `${state.wine} · ${state.label}` : state.wine)}</span>` : ''}`;
}

// ---- start ----

function startHtml() {
  const n = state.wine ? expectedTags(state.wine).length : 0;
  return `
    <p class="tasting-lede">Scegli cosa stai bevendo: l'app ti guida passo passo e alla fine confronta quello che hai sentito con quello che ci si aspetta da quel vino. Non serve averlo in cantina.</p>
    <div class="aroma-card">
      <div class="field-label">Cosa assaggi</div>
      <select id="tasting-type" class="search" aria-label="Tipo di vino">${typeOptionsHtml('Tutti i tipi')}</select>
      <select id="tasting-wine" class="search" aria-label="Vino">${wineOptionsHtml(state.type, 'Scegli il vino')}</select>
      <input id="tasting-label" class="search" type="text" maxlength="200" placeholder="Etichetta (facoltativa), es. Cannubi 2019 Brezza" aria-label="Etichetta" value="${escapeHtml(state.label)}">
      ${state.wine ? `<p class="aroma-card-desc">${n} aromi attesi e il gusto tipico di un ${escapeHtml(state.wine)} ti accompagneranno nei tre passi.</p>` : ''}
      <button type="button" class="primary-btn" id="tasting-start" ${state.wine ? '' : 'disabled'}>Inizia l'assaggio</button>
    </div>
    <div class="section-head"><h3>Le tue degustazioni</h3></div>
    <div id="tasting-history">${historyHtml()}</div>`;
}

function historyHtml() {
  if (!history.length) return '<p class="tasting-empty">Qui troverai gli assaggi che salvi.</p>';
  return `<div class="tasting-list">${history.map((t) => {
    const exp = expectedTags(t.style);
    const found = t.flavor_tags.filter((x) => exp.includes(x)).length;
    return `<div class="list-row tasting-row" data-past="${t.id}" role="button" tabindex="0">
      <div class="lbody"><div class="lname">${escapeHtml(t.label ? `${t.style} · ${t.label}` : t.style)}</div>
      <div class="lsub">${escapeHtml(formatDate(t.created_at))}${exp.length ? ` · ${found} di ${exp.length} aromi attesi` : ''}</div></div>
      <span class="tasting-stars" aria-label="${t.rating} stelle">${starsText(t.rating)}</span>
    </div>`;
  }).join('')}</div>`;
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
      <p class="aroma-card-desc">Annusa e tocca quelli che senti davvero: non devi trovarli tutti.</p>
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
    <div class="tasting-foot"><button type="button" class="primary-btn" data-step="summary">Vedi il riepilogo</button></div>`;
}

// ---- summary (also used read-only for a past tasting) ----

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

function summaryHtml({ wine, label, felt, mouth, taste, stars, text }, readOnly) {
  const { exp, found, extra, rows } = comparison(wine, felt, taste);
  const where = mouth.length ? whereRows(felt, mouth) : [];
  return `
    ${readOnly ? `<span class="aroma-pill tasting-wine">${escapeHtml(label ? `${wine} · ${label}` : wine)}</span>` : ''}
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
    </div>
    <div class="tasting-foot">${readOnly
      ? `<button type="button" class="primary-btn tasting-delete" id="tasting-delete">Elimina questo assaggio</button>`
      : `<button type="button" class="primary-btn" id="tasting-save">Salva l'assaggio</button>`}</div>`;
}

// ---- render & navigation ----

function render() {
  let html = headerHtml();
  if (state.step === 'start') html += startHtml();
  else if (state.step === 'nose') html += noseHtml();
  else if (state.step === 'mouth') html += mouthHtml();
  else if (state.step === 'verdict') html += verdictHtml();
  else if (state.step === 'summary') html += summaryHtml({ wine: state.wine, label: state.label, felt: [...state.felt], mouth: [...state.mouth], taste: state.taste, stars: state.stars, text: state.text }, false);
  else if (state.step === 'past') {
    const t = state.past;
    html += summaryHtml({
      wine: t.style, label: t.label, felt: t.flavor_tags, mouth: t.mouth_tags ?? [],
      taste: TASTE_AXES.map((a) => t[`taste_${a.id}`] ?? null), stars: t.rating, text: t.text,
    }, true);
  }
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
  if (state.step === 'past') return goStep('start');
  const i = order.indexOf(state.step);
  if (i <= 0) { window.location.hash = '#/home'; return; }
  goStep(order[i - 1]);
}

async function save() {
  const btn = document.getElementById('tasting-save');
  btn.disabled = true;
  const payload = { style: state.wine, label: state.label || null, rating: state.stars, text: state.text, flavorTags: [...state.felt], mouthTags: [...state.mouth] };
  TASTE_AXES.forEach((axis, i) => { payload[`taste${axis.id[0].toUpperCase()}${axis.id.slice(1)}`] = state.taste[i]; });
  try {
    const saved = await api.post('/api/tastings', payload);
    history = [saved, ...history];
    state = freshState();
    goStep('start');
    showToast('Assaggio salvato');
  } catch (err) {
    console.error(err);
    btn.disabled = false;
    await alertModal("Non è stato possibile salvare l'assaggio. Riprova.");
  }
}

async function removePast() {
  const t = state.past;
  if (!(await confirmModal('Eliminare questo assaggio?', { confirmLabel: 'Elimina', danger: true }))) return;
  try {
    await api.del(`/api/tastings/${t.id}`);
    history = history.filter((x) => x.id !== t.id);
    state = freshState();
    goStep('start');
    showToast('Assaggio eliminato');
  } catch (err) {
    console.error(err);
    await alertModal("Non è stato possibile eliminare l'assaggio. Riprova.");
  }
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
    if (e.target.closest('#tasting-save')) return save();
    if (e.target.closest('#tasting-delete')) return removePast();
    const past = e.target.closest('[data-past]');
    if (past) { state.past = history.find((t) => t.id === Number(past.dataset.past)); return goStep('past'); }
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

export async function mountTasting(search) {
  if (!wired) { wire(); wired = true; }
  const wine = search?.get('vino');
  // Coming from the wheel with a wine starts a fresh tasting of it; a plain
  // visit resumes whatever was in progress (leaving mid-way loses nothing).
  if (wine && WINE_STYLES[wine]) state = freshState(wine);
  else if (state.step === 'past') state = freshState();
  render();
  try {
    history = await api.get('/api/tastings');
  } catch (err) {
    console.error(err);
    history = [];
  }
  if (state.step === 'start') document.getElementById('tasting-history').innerHTML = historyHtml();
}
