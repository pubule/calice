import { test, expect } from '@playwright/test';
import { myCellarId, seedWine, seedBottle, runId } from './helpers';

test.describe('Home', () => {
  test('"vedi tutte" expands the regions list beyond the 5-item preview', async ({ page, request }) => {
    const cellarId = await myCellarId(request);
    // Six distinct, run-unique regions guarantee the total crosses the
    // 5-item preview threshold regardless of whatever this shared dev D1
    // already accumulated from earlier runs (a country is not a region).
    for (let i = 0; i < 6; i++) {
      const wine = await seedWine(request, { name: `Home Region Test ${runId} ${i}`, region: `Regione ${runId} ${i}`, type: 'rosso' });
      await seedBottle(request, cellarId, wine.id, { quantity: 1 });
    }

    await page.goto('/');
    await expect(page.locator('#view-home')).toHaveClass(/active/);
    await page.click('#home-tabs button[data-tab="regions"]');
    const toggle = page.locator('#home-regions-toggle');
    await expect(toggle).toHaveText('vedi tutte');
    const before = await page.locator('#home-regions .region-row').count();

    await toggle.click();
    await expect(toggle).toHaveText('mostra meno');
    const after = await page.locator('#home-regions .region-row').count();
    expect(after).toBeGreaterThan(before);

    await toggle.click();
    await expect(toggle).toHaveText('vedi tutte');
    await expect(page.locator('#home-regions .region-row')).toHaveCount(before);
  });

  test('alert banner can be dismissed', async ({ page, request }) => {
    const cellarId = await myCellarId(request);
    // A window that closed years ago: the "Da bere presto" banner.
    const wine = await seedWine(request, { name: `Home Late Test ${runId}`, country: 'Italia', type: 'rosso' });
    await seedBottle(request, cellarId, wine.id, { quantity: 1, drinkFrom: '2015-01-01', drinkUntil: '2018-12-31' });

    await page.goto('/');
    await page.waitForSelector('#app-loader', { state: 'detached', timeout: 30000 });
    const banner = page.locator('.alert-banner', { hasText: 'Da bere presto' });
    await expect(banner).toBeVisible();
    await banner.locator('.alert-dismiss').click();
    await expect(banner).not.toBeVisible();
  });

});

test.describe('Home nav', () => {
  test('loads with greeting, stat row, and a working navbar', async ({ page }) => {
    await page.goto('/');
    // Home renders once the start-up loader has preloaded everything.
    await page.waitForSelector('#app-loader', { state: 'detached', timeout: 30000 });
    await expect(page.locator('#view-home')).toHaveClass(/active/);
    await expect(page.locator('#home-greet-name')).not.toHaveText('…');

    const stats = page.locator('#home-stats .stat');
    await expect(stats).toHaveCount(3);
    await expect(stats.nth(0).locator('.lbl')).toHaveText('bottiglie');
    await expect(stats.nth(1).locator('.lbl')).toHaveText('valore');
    await expect(stats.nth(2).locator('.lbl')).toHaveText('da bere');

    // The "+" opens the add sheet over the current screen (not a tab).
    await page.click('.nav-add');
    await expect(page.locator('#add-overlay')).toHaveClass(/open/);
    await page.click('#add-close');
    await expect(page.locator('#add-overlay')).not.toHaveClass(/open/);

    // Every navbar destination actually mounts its own view.
    for (const [label, view] of [
      ['Cantina', 'view-cellar'],
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
