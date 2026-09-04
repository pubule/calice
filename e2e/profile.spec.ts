import { test, expect } from '@playwright/test';
import { gotoScreen, apiGet, apiPost, seedUser, runId } from './helpers';
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
