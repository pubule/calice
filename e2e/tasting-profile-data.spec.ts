import { test, expect } from '@playwright/test';
// Plain data, no browser: the module has no DOM access at import time.
import { FLAVOR_CATEGORIES } from '../public/js/tasting-profile.js';

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
