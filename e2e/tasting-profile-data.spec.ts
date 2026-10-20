import { test, expect } from '@playwright/test';
// Plain data, no browser: the module has no DOM access at import time.
import { FLAVOR_CATEGORIES, FOOD_PAIRINGS, composeNoteText, foodIconHtml } from '../public/js/tasting-profile.js';

test('Frutta: ogni aroma in esattamente un gruppetto', () => {
  const frutta = FLAVOR_CATEGORIES.find((c) => c.id === 'frutta')!;
  expect(frutta.groups.map((g) => g.label)).toEqual(['Frutti rossi e neri', 'Agrumi', 'Frutta bianca e gialla', 'Tropicale', 'Secca e cotta']);
  const grouped = frutta.groups.flatMap((g) => g.tags);
  expect(grouped.length).toBe(frutta.tags.length);
  expect(new Set(grouped)).toEqual(new Set(frutta.tags));
});

test('nessun aroma in due famiglie', () => {
  const all = FLAVOR_CATEGORIES.flatMap((c) => c.tags);
  expect(new Set(all).size).toBe(all.length);
});

test('frase della nota: profumo, bocca e abbinamenti legati', () => {
  const taste = { taste_sweetness: 5, taste_acidity: 80, taste_body: 10 };
  expect(composeNoteText({ flavor_tags: ['Crosta di pane', 'Brioche'], ...taste, food_pairings: ['Pesce', 'Crostacei'] }))
    .toBe('Profuma di crosta di pane e brioche. In bocca è secco, fresco e di corpo leggero, e si abbina bene con pesce e crostacei.');
  expect(composeNoteText({ flavor_tags: ['Rosa'], food_pairings: ['Aperitivo'] })).toBe('Profuma di rosa ed è ottimo come aperitivo.');
  expect(composeNoteText({ food_pairings: ['Pesce'] })).toBe('Si abbina bene con pesce.');
  expect(composeNoteText({})).toBe('');
});

test('ogni abbinamento ha la sua icona', () => {
  expect(FOOD_PAIRINGS.filter((f) => !foodIconHtml(f))).toEqual([]);
});
