import { test, expect } from '@playwright/test';

test.describe('Home', () => {
  test('loads with greeting, stat row, and a working navbar', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#view-home')).toHaveClass(/active/);
    await expect(page.locator('#home-greet-name')).not.toHaveText('…');

    const stats = page.locator('#home-stats .stat');
    await expect(stats).toHaveCount(3);
    await expect(stats.nth(0).locator('.lbl')).toHaveText('bottiglie');
    await expect(stats.nth(1).locator('.lbl')).toHaveText('valore');
    await expect(stats.nth(2).locator('.lbl')).toHaveText('da bere');

    // Every navbar destination actually mounts its own view.
    for (const [label, view] of [
      ['Cantina', 'view-cellar'],
      ['Aggiungi', 'view-add'],
      ['Statistiche', 'view-stats'],
      ['Profilo', 'view-profile'],
      ['Home', 'view-home'],
    ] as const) {
      await page.click(`.navbtn:has-text("${label}")`);
      await expect(page.locator(`#${view}`)).toHaveClass(/active/);
      await expect(page.locator(`.navbtn:has-text("${label}")`)).toHaveClass(/active/);
    }
  });
});
