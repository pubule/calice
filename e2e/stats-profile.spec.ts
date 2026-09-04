import { test, expect } from '@playwright/test';
import { gotoScreen, myCellarId, seedWine, seedBottle, runId } from './helpers';

test.describe('Statistiche', () => {
  test('renders the summary row and per-type/country/region breakdowns', async ({ page }) => {
    await gotoScreen(page, 'stats');
    const stats = page.locator('#stats-summary .stat');
    await expect(stats).toHaveCount(3);
    await expect(stats.nth(0).locator('.lbl')).toHaveText('bottiglie');
    await expect(stats.nth(1).locator('.lbl')).toHaveText('valore');
    await expect(stats.nth(2).locator('.lbl')).toHaveText('annata media');
  });

  test('summary total and type breakdown reflect seeded bottles', async ({ page, request }) => {
    const cellarId = await myCellarId(request);
    const name = `Stats Rosso ${runId}`;
    const wine = await seedWine(request, { name, producer: 'Stats Test', country: 'Italia', type: 'rosso' });
    await seedBottle(request, cellarId, wine.id, { quantity: 2, price_paid: 15, vintage: 2020 });

    const before = await request.get(`/api/cellars/${cellarId}/bottles`);
    const totalBefore = (await before.json() as { quantity: number }[]).reduce((n, b) => n + Number(b.quantity), 0);

    await gotoScreen(page, 'stats');
    await expect(page.locator('#stats-summary .stat').nth(0).locator('.num')).toHaveText(String(totalBefore));
    await expect(page.locator('#stats-type')).toContainText('Rosso');
    await expect(page.locator('#stats-country')).toContainText('Italia');
  });
});

test.describe('Profilo', () => {
  test('shows identity, cellar count, and can generate an invite link', async ({ page }) => {
    await gotoScreen(page, 'profile');
    await expect(page.locator('#profile-name')).not.toHaveText('…');
    await expect(page.locator('#profile-email')).toContainText('@');
    await expect(page.locator('#profile-cellar-count')).not.toHaveText('0');

    await page.click('#invite-btn');
    await expect(page.locator('#invite-result')).toContainText('/#/invite/');
  });
});
