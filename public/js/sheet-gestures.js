// Gesti dei fogli (bottom sheet): tocco sullo sfondo, maniglia e
// trascinamento verso il basso per chiuderli.
//
// I fogli sono markup statico che resta nel DOM per tutta la vita
// dell'app, quindi tutto viene cablato UNA volta all'avvio. La chiusura non
// è reimplementata qui: si chiama `.click()` sul controllo di chiusura già
// esistente di ogni foglio, così gira la sua pulizia (es. l'overlay Elementi
// azzera il suo stato in closeElementsOverlay()).
//
// Le finestre di modal.js (#app-modal) restano fuori di proposito: sono
// alert/conferme, non fogli.

// overlay -> controllo di chiusura esistente
const SHEETS = [
  ['detail-overlay', 'detail-close'],
  ['compare-overlay', 'compare-close'],
  ['add-overlay', 'add-close'],
  ['recognize-overlay', 'recognize-close'],
  ['filter-sheet', 'filter-sheet-close'],
  ['cellar-sheet', 'cellar-sheet-close'],
  ['elements-overlay', 'elements-close'],
  ['explore-country-sheet', 'explore-country-sheet-close'],
];

const SHEET_SELECTOR = '.detail-sheet, .compare-sheet';
const HEADER_SELECTOR = '.sheet-grabber, .compare-head, .topbar, .detail-hero';
const NO_DRAG_SELECTOR = '.taste-track, input, textarea, select, [contenteditable="true"]';

const HYSTERESIS_CONTENT = 10; // px prima di iniziare dal contenuto
const HYSTERESIS_HEADER = 6; // px prima di iniziare da maniglia/header
const DISMISS_FRACTION = 0.4; // proiezione oltre il 40% dell'altezza
const DISMISS_VELOCITY = 0.5; // px/ms verso il basso
const DECELERATION = 0.998; // stessa costante di UIScrollView.decelerationRate
const VELOCITY_WINDOW = 100; // ms di storico per la velocità
const STALE_MS = 80; // ultimo campione più vecchio di così = dito fermo
const BACKDROP_ALPHA = 0.4; // = rgba(20,15,12,.4) di .detail-overlay/.compare-overlay

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Rubber band di Apple: oltre il bordo il movimento si smorza fino a un massimo.
function rubberBand(overshoot, dimension) {
  const c = 0.55;
  const o = Math.abs(overshoot);
  return -((o * dimension * c) / (dimension + c * o));
}

function injectGrabber(sheet) {
  if (sheet.querySelector(':scope > .sheet-grabber')) return;
  const g = document.createElement('div');
  g.className = 'sheet-grabber';
  g.setAttribute('aria-hidden', 'true');
  g.appendChild(document.createElement('span'));
  sheet.insertBefore(g, sheet.firstChild);
}

// Vero se tra `target` e il foglio c'è un sottoscroller verticale già
// scrollato, che quindi deve tenersi il gesto. Le righe scorrevoli in
// orizzontale (chip, gallery) NON sono escluse qui: cedono il gesto solo se
// il movimento è a dominante orizzontale (vedi pointermove/touchmove), così
// un trascinamento verticale su una gallery larga come lo schermo chiude
// comunque il foglio.
function ownsScroll(target, sheet) {
  for (let el = target; el && el !== sheet; el = el.parentElement) {
    const cs = getComputedStyle(el);
    if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1 && el.scrollTop > 0) return true;
  }
  return false;
}

function wireSheet(overlayId, closeId) {
  const overlay = document.getElementById(overlayId);
  const closeBtn = document.getElementById(closeId);
  const sheet = overlay?.querySelector(SHEET_SELECTOR);
  if (!overlay || !closeBtn || !sheet) return;

  injectGrabber(sheet);

  const dismiss = () => closeBtn.click();
  let busy = false; // animazione di chiusura/rientro in corso

  // ---- tocco sullo sfondo ----
  // Conta solo se pressione E rilascio avvengono sullo sfondo: un trascinamento
  // iniziato dentro il foglio e finito fuori produce un click con target
  // l'overlay, e non deve chiudere.
  let downOnBackdrop = false;
  overlay.addEventListener('pointerdown', (e) => {
    downOnBackdrop = e.target === overlay;
  });
  overlay.addEventListener('click', (e) => {
    if (e.target !== overlay || !downOnBackdrop) return;
    downOnBackdrop = false;
    if (overlay.classList.contains('open') && !busy) dismiss();
  });

  // ---- trascinamento ----
  let pointerId = null;
  let tracking = false; // pointerdown idoneo, gesto non ancora deciso
  let dragging = false;
  let fromHeader = false;
  let startX = 0;
  let startY = 0;
  let originY = 0; // Y del dito quando il trascinamento è davvero iniziato
  let samples = [];
  let sheetHeight = 0;
  let suppressClick = false;

  const setBackdrop = (dy) => {
    const p = Math.min(1, Math.max(0, dy / sheetHeight));
    overlay.style.background = `rgba(20,15,12,${(BACKDROP_ALPHA * (1 - p)).toFixed(3)})`;
  };
  const resetInline = () => {
    sheet.style.transition = '';
    sheet.style.transform = '';
    sheet.style.opacity = '';
    overlay.style.background = '';
  };

  function endGestureState() {
    tracking = false;
    dragging = false;
    pointerId = null;
    samples = [];
  }

  sheet.addEventListener('pointerdown', (e) => {
    if (busy || !overlay.classList.contains('open')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (pointerId !== null) return;
    const t = e.target;
    if (t.closest(NO_DRAG_SELECTOR)) return;
    fromHeader = !!t.closest(HEADER_SELECTOR);
    if (!fromHeader) {
      // Dal contenuto si parte solo con il foglio in cima, e senza
      // sottoscroller che reclamino il gesto.
      if (sheet.scrollTop > 0) return;
      if (ownsScroll(t, sheet)) return;
    }
    pointerId = e.pointerId;
    tracking = true;
    dragging = false;
    startX = e.clientX;
    startY = e.clientY;
    samples = [{ t: e.timeStamp, y: e.clientY }];
  });

  function beginDrag(e) {
    dragging = true;
    sheetHeight = sheet.offsetHeight || 1;
    originY = e.clientY; // niente salto: il foglio parte da dove si trova il dito
    sheet.style.transition = 'none';
    if (e.pointerType !== 'touch') { try { sheet.setPointerCapture(e.pointerId); } catch {} }
  }

  sheet.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointerId) return;
    const rawDy = e.clientY - startY;
    const rawDx = e.clientX - startX;

    if (tracking && !dragging) {
      const hyst = fromHeader ? HYSTERESIS_HEADER : HYSTERESIS_CONTENT;
      if (Math.abs(rawDx) > hyst && Math.abs(rawDx) > Math.abs(rawDy)) {
        tracking = false; // gesto orizzontale: non è nostro
        return;
      }
      if (rawDy < 0 && !fromHeader) {
        tracking = false; // verso l'alto dal contenuto = scroll nativo
        return;
      }
      if (rawDy <= hyst) return;
      beginDrag(e);
    }
    if (!dragging) return;

    samples.push({ t: e.timeStamp, y: e.clientY });
    while (samples.length > 2 && e.timeStamp - samples[0].t > VELOCITY_WINDOW * 2) samples.shift();

    const dy = e.clientY - originY;
    const shown = dy >= 0 ? dy : rubberBand(dy, sheetHeight);
    sheet.style.transform = `translateY(${shown}px)`;
    setBackdrop(shown);
  });

  // Su touch il browser vuole decidere subito se scrollare: se il foglio è in
  // cima e il dito scende, reclamiamo il gesto prima che parta lo scroll
  // nativo (e il rimbalzo di iOS). Listener non passivo apposta.
  sheet.addEventListener(
    'touchmove',
    (e) => {
      if (!e.cancelable) return;
      if (dragging) {
        e.preventDefault();
        return;
      }
      if (!tracking) return;
      const touch = e.touches[0];
      if (!touch) return;
      const dy = touch.clientY - startY;
      const dx = touch.clientX - startX;
      if (dy > 0 && dy > Math.abs(dx) && (fromHeader || sheet.scrollTop <= 0)) e.preventDefault();
    },
    { passive: false },
  );

  function release(e, cancelled) {
    if (e.pointerId !== pointerId) return;
    const wasDragging = dragging;
    const dy = e.clientY - originY;
    const samplesCopy = samples;
    endGestureState();
    try { sheet.releasePointerCapture(e.pointerId); } catch {}
    if (!wasDragging) return;

    // Il click sintetico che segue un trascinamento non deve attivare i bottoni.
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);

    // Velocità sugli ultimi ~100 ms. Se l'ultimo campione è vecchio (il dito
    // si è fermato prima di staccarsi) non c'è slancio: v = 0.
    const now = e.timeStamp;
    const recent = samplesCopy.filter((s) => now - s.t <= VELOCITY_WINDOW);
    let v = 0; // px/ms
    if (recent.length >= 2) {
      const first = recent[0];
      const last = recent[recent.length - 1];
      if (now - last.t <= STALE_MS && last.t > first.t) v = (last.y - first.y) / (last.t - first.t);
    }
    const current = Math.max(0, dy);
    // Proiezione di dove arriverebbe con l'inerzia: (v_px_s/1000) * 0.998/(1-0.998),
    // cioè v in px/ms per 499.
    const projected = current + v * (DECELERATION / (1 - DECELERATION));
    const shouldDismiss =
      !cancelled && dy > 0 && (projected > sheetHeight * DISMISS_FRACTION || v > DISMISS_VELOCITY);

    finish(shouldDismiss);
  }

  function finish(shouldDismiss) {
    busy = true;
    if (reducedMotion()) {
      finishReduced(shouldDismiss);
      return;
    }
    // Transizione CSS originale riattivata: parte dalla posizione corrente.
    sheet.style.transition = '';
    if (shouldDismiss) {
      // Lo sfondo resta al valore attenuato: a sfumarlo del tutto pensa
      // l'opacity dell'overlay, quando .open viene tolta.
      dismiss(); // toglie .open (e fa girare la pulizia del foglio)
      // Forza uno style recalc con l'inline ancora attivo, poi lo toglie:
      // transform passa da translateY(dy) a quello di classe (100%).
      void sheet.offsetHeight;
      sheet.style.transform = '';
    } else {
      void sheet.offsetHeight;
      sheet.style.transform = '';
      overlay.style.transition = 'background .32s ease';
      overlay.style.background = '';
    }
    const done = () => {
      sheet.removeEventListener('transitionend', onEnd);
      clearTimeout(timer);
      overlay.style.transition = '';
      resetInline();
      busy = false;
    };
    const onEnd = (ev) => {
      if (ev.target === sheet && ev.propertyName === 'transform') done();
    };
    sheet.addEventListener('transitionend', onEnd);
    const timer = setTimeout(done, 500); // rete di sicurezza (es. nessuna transizione)
  }

  function finishReduced(shouldDismiss) {
    // Niente movimento: breve cambio di opacità.
    sheet.style.transition = 'opacity .15s ease';
    if (shouldDismiss) {
      sheet.style.opacity = '0';
      setTimeout(() => {
        sheet.style.transition = 'none';
        sheet.style.transform = '';
        overlay.style.background = '';
        dismiss();
        void sheet.offsetHeight;
        resetInline();
        busy = false;
      }, 160);
    } else {
      sheet.style.transition = 'none';
      sheet.style.transform = '';
      sheet.style.opacity = '0.6';
      overlay.style.background = '';
      void sheet.offsetHeight;
      sheet.style.transition = 'opacity .15s ease';
      sheet.style.opacity = '1';
      setTimeout(() => {
        resetInline();
        busy = false;
      }, 160);
    }
  }

  sheet.addEventListener('pointerup', (e) => release(e, false));
  sheet.addEventListener('pointercancel', (e) => release(e, true));
  sheet.addEventListener('lostpointercapture', (e) => {
    if (e.pointerId === pointerId && dragging) release(e, true);
  });
  sheet.addEventListener(
    'click',
    (e) => {
      if (suppressClick && e.isTrusted) {
        e.stopPropagation();
        e.preventDefault();
      }
    },
    true,
  );
}

export function initSheetGestures() {
  SHEETS.forEach(([overlayId, closeId]) => wireSheet(overlayId, closeId));
}

initSheetGestures();
