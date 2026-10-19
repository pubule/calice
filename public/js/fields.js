// One definition for every field that appears in more than one place of the
// app (audit of build 148): how a quantity, a price, a vintage or a
// disgorgement month is asked, read and validated. Add flow, review/edit
// sheet and the barcode quick-add all use these, so the same information
// always looks and behaves the same.

export const MAX_QUANTITY = 9999;
export const MAX_PRICE = 100000;

// Whole numbers (vintage, bottles, years): a text field with the numeric
// keypad, never type=number (spinners, "e", and a different feel per screen).
export const WHOLE_NUMBER_ATTRS = 'type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off"';

// "18,50" or "18.5" or "18,50 €" → { value } (null when empty) or { invalid }.
export function parseDecimal(raw) {
  const text = String(raw ?? '').trim().replace(/\s*€$/, '');
  if (!text) return { value: null };
  const v = Number(text.replace(',', '.'));
  return Number.isFinite(v) ? { value: v } : { invalid: true };
}

export const PRICE_ERROR = 'Il prezzo deve essere un numero, per esempio 18 o 18,50.';

// A price: empty is fine (null), otherwise 0 to MAX_PRICE.
export function parsePrice(raw) {
  const r = parseDecimal(raw);
  if (r.invalid || (r.value != null && !(r.value >= 0 && r.value <= MAX_PRICE))) return { invalid: true };
  return { value: r.value };
}

export const VINTAGE_ERROR = "L'annata deve essere un anno, per esempio 2019.";

// A vintage: empty = none (null), otherwise a year from 1900 to next year.
export function parseVintage(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return { value: null };
  const v = Number(text);
  return Number.isInteger(v) && v >= 1900 && v <= new Date().getFullYear() + 1 ? { value: v } : { invalid: true };
}

export function quantityError(min) {
  return min === 0 ? 'Le bottiglie devono essere un numero intero, da 0 in su.' : 'Le bottiglie devono essere un numero intero, almeno 1.';
}

// Bottles: empty = null, otherwise a whole number from min to MAX_QUANTITY.
export function parseQuantity(raw, min = 1) {
  const text = String(raw ?? '').trim();
  if (!text) return { value: null };
  const v = Number(text);
  return Number.isInteger(v) && v >= min && v <= MAX_QUANTITY ? { value: v } : { invalid: true };
}

// "− 3 +": the one control for a number of bottles. The number can also be
// typed. Wire it with wireQuantitySteppers() (once per render).
export function quantityStepperHtml({ id, value, min = 1, label = 'Bottiglie' }) {
  return `<div class="qty-step" role="group" aria-label="${label}" data-min="${min}">
    <button type="button" data-qty-step="-1" aria-label="Una bottiglia in meno">−</button>
    <input id="${id}" class="qty-input" ${WHOLE_NUMBER_ATTRS} maxlength="4" value="${value}" aria-label="${label}">
    <button type="button" data-qty-step="1" aria-label="Una bottiglia in più">+</button>
  </div>`;
}

// Buttons change the number inside [min, MAX_QUANTITY]; `onChange(n)` after
// each press (the typed value is read by the caller when it saves).
export function wireQuantitySteppers(root, onChange) {
  root.querySelectorAll('.qty-step').forEach((group) => {
    if (group.dataset.wired) return;
    group.dataset.wired = '1';
    const input = group.querySelector('.qty-input');
    const min = Number(group.dataset.min) || 0;
    group.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-qty-step]');
      if (!btn) return;
      const current = parseQuantity(input.value, min).value ?? min;
      const next = Math.min(MAX_QUANTITY, Math.max(min, current + Number(btn.dataset.qtyStep)));
      input.value = String(next);
      onChange?.(next, input);
    });
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '');
      const n = parseQuantity(input.value, min).value;
      if (n != null) onChange?.(n, input);
    });
  });
}

// Euros without decimals, for totals ("197 €"): same side of the number as
// every price in the app.
export function eurosText(n) {
  return `${Math.round(Number(n) || 0).toLocaleString('it-IT')} €`;
}

export const DISGORGED_HINT = 'Mese e anno scritti in etichetta. Da qui parte la stima di quando berlo.';

// Disgorgement month field (sparkling wines), YYYY-MM.
export function disgorgedFieldHtml({ id, value = '', hintId }) {
  return `<input id="${id}" class="search" type="month" value="${value}" ${hintId ? `aria-describedby="${hintId}"` : ''}>`;
}

export const parseDisgorged = (raw) => (/^\d{4}-(0[1-9]|1[0-2])$/.test(String(raw ?? '')) ? raw : null);
