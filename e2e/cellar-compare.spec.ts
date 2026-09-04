import { test, expect } from '@playwright/test';
import { gotoScreen, myCellarId, seedWine, seedBottle, runId } from './helpers';

test.describe('Cantina — confronta due vini', () => {
  let nameA: string;
  let nameB: string;

  test.beforeAll(async ({ request }) => {
    const cellarId = await myCellarId(request);
    nameA = `Compare Wine A ${runId}`;
    nameB = `Compare Wine B ${runId}`;
    const a = await seedWine(request, { name: nameA, producer: 'Confronto A', type: 'rosso' });
    const b = await seedWine(request, { name: nameB, producer: 'Confronto B', type: 'bianco' });
    await seedBottle(request, cellarId, a.id, { pricePaid: 20 });
    await seedBottle(request, cellarId, b.id, { pricePaid: 15 });
  });

  test('selecting two bottles and confronting shows both side by side', async ({ page }) => {
    await gotoScreen(page, 'cellar');
    await page.click('#compare-open');
    await expect(page.locator('#cellar-list')).toHaveClass(/selecting/);
    await expect(page.locator('#compare-bar')).toHaveClass(/show/);
    await expect(page.locator('#compare-go')).toBeDisabled();

    await page.locator('.cellar-row', { hasText: nameA }).click();
    await expect(page.locator('#compare-count')).toHaveText('1/2 selezionati');
    await page.locator('.cellar-row', { hasText: nameB }).click();
    await expect(page.locator('#compare-count')).toHaveText('2/2 selezionati');
    await expect(page.locator('#compare-go')).toBeEnabled();

    await page.click('#compare-go');
    await expect(page.locator('#compare-overlay')).toHaveClass(/open/);
    const names = page.locator('#compare-overlay .cname');
    await expect(names.nth(0)).toHaveText(nameA);
    await expect(names.nth(1)).toHaveText(nameB);

    await page.click('#compare-close');
    await expect(page.locator('#compare-overlay')).not.toHaveClass(/open/);
    // Comparing exits selection mode on its own.
    await expect(page.locator('#cellar-list')).not.toHaveClass(/selecting/);
  });

  test('Annulla exits selection mode without opening the comparison', async ({ page }) => {
    await gotoScreen(page, 'cellar');
    await page.click('#compare-open');
    await page.locator('.cellar-row', { hasText: nameA }).click();
    await page.click('#compare-cancel');
    await expect(page.locator('#cellar-list')).not.toHaveClass(/selecting/);
    await expect(page.locator('#compare-bar')).not.toHaveClass(/show/);
  });
});
