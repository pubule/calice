import { test, expect } from '@playwright/test';
import { gotoScreen, apiGet, apiPost, seedUser, runId, fillPrompt, dismissAlert, modal } from './helpers';
import type { APIRequestContext } from '@playwright/test';

async function unfollowEveryone(request: APIRequestContext) {
  const follows = await apiGet<{ id: number }[]>(request, '/api/follows');
  for (const f of follows) await request.delete(`/api/follows/${f.id}`);
}

test.describe('Profilo — seguiti', () => {
  test('shows a followed user and unfollow removes them', async ({ page, request }) => {
    const friend = await seedUser(request, `friend-${runId}@test.com`);
    await apiPost(request, `/api/follows/${friend.id}`, {});

    await gotoScreen(page, 'profile');
    const row = page.locator('.follow-row', { hasText: friend.name });
    await expect(row).toBeVisible();

    await row.locator('.follow-btn').click();
    await expect(row).not.toBeVisible();
  });

  test('shows the empty state when following nobody', async ({ page, request }) => {
    await unfollowEveryone(request);
    await gotoScreen(page, 'profile');
    await expect(page.locator('.follow-row')).toHaveCount(0);
    await expect(page.locator('#profile-follows')).toContainText('Non segui ancora nessuno.');
  });

  test('"trova amici" finds a user by exact email and follows them', async ({ page, request }) => {
    const friend = await seedUser(request, `findme-${runId}@test.com`);

    await gotoScreen(page, 'profile');
    await page.click('#find-friends-btn');
    await fillPrompt(page, `findme-${runId}@test.com`);
    await expect(page.locator('.follow-row', { hasText: friend.name })).toBeVisible();
  });

  test('"trova amici" shows an error for an email that matches nobody', async ({ page }) => {
    await gotoScreen(page, 'profile');
    await page.click('#find-friends-btn');
    await fillPrompt(page, `nobody-${runId}@test.com`);
    await expect(page.locator(modal.title)).toHaveText('Trova amici');
    await expect(page.locator(modal.message)).toHaveText('Nessun utente trovato con questa email.');
    await dismissAlert(page);
  });
});

test.describe('Profilo — impostazioni', () => {
  test('"Le mie cantine" opens the Cantina screen', async ({ page }) => {
    await gotoScreen(page, 'profile');
    await page.click('#my-cellars-row');
    await expect(page.locator('#view-cellar')).toHaveClass(/active/);
  });

  test('"Aiuto" shows a help dialog', async ({ page }) => {
    await gotoScreen(page, 'profile');
    await page.click('#help-row');
    await expect(page.locator(modal.title)).toHaveText('Aiuto');
    await expect(page.locator(modal.message)).toContainText('Elementi cantina');
    await dismissAlert(page);
  });

  test('"Esporta CSV" downloads a CSV file', async ({ page }) => {
    await gotoScreen(page, 'profile');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export-csv-row')]);
    expect(download.suggestedFilename()).toMatch(/^calice-cantina-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});

test.describe('Profilo — notifiche', () => {
  test('toggling notifications without permission resets the checkbox instead of crashing', async ({ page }) => {
    await gotoScreen(page, 'profile');
    const toggle = page.locator('#notif-toggle');
    await expect(toggle).not.toBeChecked();

    // No notification permission is granted to this browser context, so the
    // push subscribe attempt rejects and profile.js's catch block must reset
    // the checkbox rather than leaving it claiming a subscription that
    // doesn't exist.
    await toggle.click();
    await expect(toggle).not.toBeChecked({ timeout: 5000 });
  });
});
