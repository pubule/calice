import { test, expect } from '@playwright/test';
import { gotoScreen, myCellarId, seedWine, seedBottle, apiPost, runId } from './helpers';

test.describe('Cantina — search and filters', () => {
  let redName: string;
  let whiteName: string;

  test.beforeAll(async ({ request }) => {
    const cellarId = await myCellarId(request);
    redName = `Barolo Search Test ${runId}`;
    whiteName = `Vermentino Search Test ${runId}`;
    const red = await seedWine(request, { name: redName, producer: 'Elio Altare', country: 'Italia', region: 'Piemonte', type: 'rosso' });
    const white = await seedWine(request, { name: whiteName, producer: 'Argiolas', country: 'Italia', region: 'Sardegna', type: 'bianco' });
    await seedBottle(request, cellarId, red.id);
    await seedBottle(request, cellarId, white.id);
  });

  test('search narrows the list and the clear affordance restores it', async ({ page }) => {
    await gotoScreen(page, 'cellar');
    await expect(page.locator('.cellar-row', { hasText: redName })).toBeVisible();
    await expect(page.locator('.cellar-row', { hasText: whiteName })).toBeVisible();

    await page.fill('#cellar-search-input', redName);
    await expect(page.locator('.cellar-row', { hasText: redName })).toBeVisible();
    await expect(page.locator('.cellar-row', { hasText: whiteName })).not.toBeVisible();
    await expect(page.locator('#cellar-results-count')).toHaveText('1 vino · 1 bottiglia');

    await page.fill('#cellar-search-input', 'no wine matches this string at all zzz');
    await expect(page.locator('#cellar-list .empty-note')).toHaveText('Nessun vino trovato con questi filtri.');

    await page.fill('#cellar-search-input', '');
    await expect(page.locator('.cellar-row', { hasText: redName })).toBeVisible();
    await expect(page.locator('.cellar-row', { hasText: whiteName })).toBeVisible();
  });

  test('filter sheet opens, a Tipo chip narrows the list, and the badge reflects active filters', async ({ page }) => {
    await gotoScreen(page, 'cellar');
    await expect(page.locator('#cellar-filter-badge')).not.toHaveClass(/show/);

    await page.click('#cellar-filter-btn');
    await expect(page.locator('#filter-sheet')).toHaveClass(/open/);
    await expect(page.locator('#cellar-chips-type .chip')).toContainText(['Tutti']);

    await page.click('#cellar-chips-type .chip:has-text("Bianco")');
    await expect(page.locator('#cellar-filter-badge')).toHaveClass(/show/);
    await expect(page.locator('#cellar-filter-badge')).toHaveText('1');

    await page.click('#filter-sheet-close');
    await expect(page.locator('#filter-sheet')).not.toHaveClass(/open/);
    await expect(page.locator('.cellar-row', { hasText: whiteName })).toBeVisible();
    await expect(page.locator('.cellar-row', { hasText: redName })).not.toBeVisible();
  });

  test('switching to Desideri hides the owned list and shows the wishlist container', async ({ page }) => {
    await gotoScreen(page, 'cellar');
    await page.click('.segmented button:has-text("Desideri")');
    await expect(page.locator('#cellar-list')).not.toBeVisible();
    await expect(page.locator('#wishlist-list')).toBeVisible();
    await page.click('.segmented button:has-text("La mia cantina")');
    await expect(page.locator('#cellar-list')).toBeVisible();
  });
});

test.describe('Cantina — abbinamenti', () => {
  test('the Abbinamento filter finds the wines whose note lists the chosen dishes', async ({ page, request }) => {
    const cellarId = await myCellarId(request);
    const names = { both: `Abbina Manzo e Formaggi ${runId}`, one: `Abbina Solo Pesce ${runId}`, none: `Abbina Niente ${runId}` };
    for (const [key, foods] of [['both', ['Manzo', 'Formaggi stagionati']], ['one', ['Pesce']], ['none', []]] as const) {
      const wine = await seedWine(request, { name: names[key], producer: 'Abbinamenti', type: 'rosso' });
      const bottle = await seedBottle(request, cellarId, wine.id);
      await apiPost(request, `/api/bottles/${bottle.id}/notes`, { rating: 0, text: '', foodPairings: foods });
    }

    await gotoScreen(page, 'cellar');
    await page.click('#cellar-filter-btn');
    const chip = (label: string) => page.locator('#cellar-chips-food .chip', { hasText: label });
    await chip('Manzo').click();
    await page.click('#filter-sheet-close');
    await expect(page.locator('.cellar-row', { hasText: names.both })).toBeVisible();
    await expect(page.locator('.cellar-row', { hasText: names.one })).not.toBeVisible();
    await expect(page.locator('#cellar-filter-badge')).toHaveText('1');

    // Two dishes: the wine must suit both.
    await page.click('#cellar-filter-btn');
    await chip('Pesce').click();
    await page.click('#filter-sheet-close');
    await expect(page.locator('.cellar-row', { hasText: names.both })).not.toBeVisible();
    await expect(page.locator('.cellar-row', { hasText: names.one })).not.toBeVisible();

    // The search box finds a dish too.
    await page.click('#cellar-filter-btn');
    await chip('Manzo').click();
    await chip('Pesce').click(); // both off
    await page.click('#filter-sheet-close');
    await page.fill('#cellar-search-input', `Abbina ${runId} pesce`.replace(`Abbina ${runId} `, ''));
    await expect(page.locator('.cellar-row', { hasText: names.one })).toBeVisible();
    await expect(page.locator('.cellar-row', { hasText: names.none })).not.toBeVisible();
  });
});

test.describe('Cantina — foglio filtri', () => {
  test('the dishes wrap onto lines instead of scrolling sideways', async ({ page, request }) => {
    const cellarId = await myCellarId(request);
    const wine = await seedWine(request, { name: `Abbina Righe ${runId}`, producer: 'Abbinamenti', type: 'rosso' });
    const bottle = await seedBottle(request, cellarId, wine.id);
    await apiPost(request, `/api/bottles/${bottle.id}/notes`, { rating: 0, text: '', foodPairings: ['Aperitivo', 'Antipasti', 'Crudi di mare', 'Frutti di mare', 'Crostacei', 'Sushi', 'Pesce', 'Pollame', 'Maiale', 'Manzo', 'Agnello', 'Selvaggina'] });
    await gotoScreen(page, 'cellar');
    await page.click('#cellar-filter-btn');
    const row = page.locator('#cellar-chips-food');
    await expect(row.locator('.chip').first()).toBeVisible();
    const { wraps, scrolls, hintFont } = await row.evaluate((el) => ({
      wraps: new Set([...el.children].map((c) => (c as HTMLElement).offsetTop)).size > 1,
      scrolls: el.scrollWidth > el.clientWidth + 1,
      hintFont: getComputedStyle(document.querySelector('#cellar-food-block .chip-hint')!).fontFamily,
    }));
    expect(wraps).toBe(true);
    expect(scrolls).toBe(false);
    expect(hintFont).not.toMatch(/mono/i);
  });
});
