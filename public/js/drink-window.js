// When to open a bottle: a drinking window (from/until year) and its best
// years (peak), estimated from the wine's denomination or type and its
// vintage, unless the user set the years themselves in the edit sheet
// (bottles.drink_from / drink_until). Without a vintage the estimate counts
// from the day the wine was added, assuming it was bought ready to drink.
// Used by Home's "Da bere" tab, the wine sheet and the edit sheet.

// [pattern on denomination + name, type it applies to (or any), years from
// the vintage: can drink from, until, best from, best until]. First match wins.
const RULES = [
  [/barolo|barbaresco/, null, 8, 20, 12, 16],
  [/amarone|brunello|taurasi|sagrantino/, null, 6, 20, 10, 15],
  [/bardolino|dolcetto|novello|lambrusco|beaujolais|schiava|grignolino/, 'rosso', 0, 3, 0, 2],
  [/riserva|reserva|gran selezione/, 'rosso', 4, 12, 6, 10],
  [/prosecco|asti|moscato/, null, 0, 2, 0, 1],
  [/franciacorta|trento|champagne|cava|metodo classico|alta langa|oltrepo|blanc de|pas dose|brut|extra brut/, 'bollicine', 0, 4, 1, 3],
  [null, 'bollicine', 0, 3, 0, 2],
  [null, 'bianco', 0, 3, 0, 2],
  [null, 'rosato', 0, 2, 0, 1],
  [null, 'rosso', 2, 8, 3, 6],
];

const fold = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const yearOf = (d) => (d ? Number(String(d).slice(0, 4)) || null : null);

function estimate(b) {
  const text = fold(`${b.denomination ?? ''} ${b.name ?? ''}`);
  const rule = RULES.find(([re, type]) => (!re || re.test(text)) && (!type || type === b.type)) ?? RULES[RULES.length - 1];
  const [, , from, until, peakFrom, peakUntil] = rule;
  if (b.vintage) {
    const v = Number(b.vintage);
    return { from: v + from, until: v + until, peakFrom: v + peakFrom, peakUntil: v + peakUntil, basis: 'vintage' };
  }
  // No vintage: assume it was at the start of its window when added.
  const added = yearOf(b.added_at) ?? new Date().getFullYear();
  return { from: added, until: added + until - from, peakFrom: added + peakFrom - from, peakUntil: added + peakUntil - from, basis: 'added' };
}

export function estimatedWindow(b) {
  return estimate(b);
}

// The window in use: the user's years if set, otherwise the estimate. With
// only the years set by hand, the best years are their middle third.
export function drinkWindow(b) {
  const from = yearOf(b.drink_from);
  const until = yearOf(b.drink_until);
  if (from && until && until >= from) {
    const third = (until - from) / 3;
    return { from, until, peakFrom: Math.round(from + third), peakUntil: Math.round(until - third), basis: 'manual' };
  }
  return estimate(b);
}

// Where today sits: young (not yet), soon (last year of the window),
// past (window over), peak (best years), ready (anything else in the window).
export function drinkStatus(w, now = new Date()) {
  const t = now.getFullYear() + now.getMonth() / 12;
  if (t < w.from) return 'young';
  if (t > w.until + 1) return 'past';
  if (w.until + 1 - t <= 1) return 'soon';
  if (t >= w.peakFrom && t < w.peakUntil + 1) return 'peak';
  return 'ready';
}

export const STATUS_LABEL = { young: 'ancora giovane', soon: 'bevi presto', past: 'da bere subito', peak: 'al meglio', ready: 'pronto' };

// Order for "Da bere": the most urgent first, then by how soon the window
// closes; the young ones last, by how soon they open.
export function drinkOrder(a, b) {
  const rank = { past: 0, soon: 1, peak: 2, ready: 3, young: 4 };
  const sa = drinkStatus(a.window), sb = drinkStatus(b.window);
  if (rank[sa] !== rank[sb]) return rank[sa] - rank[sb];
  return sa === 'young' ? a.window.from - b.window.from : a.window.until - b.window.until;
}

// One line for the wine sheet, e.g. "Ancora giovane · dal 2028, al meglio 2032–2036".
export function drinkSummary(w) {
  const s = drinkStatus(w);
  const best = w.peakFrom === w.peakUntil ? `nel ${w.peakFrom}` : `${w.peakFrom}–${w.peakUntil}`;
  if (s === 'young') return { status: s, title: 'Ancora giovane', text: `dal ${w.from}, al meglio ${best}` };
  if (s === 'past') return { status: s, title: 'Da bere subito', text: `la finestra si è chiusa nel ${w.until}` };
  if (s === 'soon') return { status: s, title: 'Bevi presto', text: `meglio entro il ${w.until}` };
  if (s === 'peak') return { status: s, title: 'Al meglio', text: `fino al ${w.until}` };
  return { status: s, title: 'Pronto', text: `al meglio ${best}, fino al ${w.until}` };
}
