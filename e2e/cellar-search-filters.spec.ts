import { test, expect } from '@playwright/test';
import { gotoScreen, myCellarId, seedWine, seedBottle, runId } from './helpers';

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
    await expect(page.locator('#cellar-results-count')).toHaveText('1 bottiglia');

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
