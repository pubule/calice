import { test, expect } from '@playwright/test';
import { gotoScreen } from './helpers';

test.describe('Statistiche', () => {
  test('renders the summary row and per-type/country/region breakdowns', async ({ page }) => {
    await gotoScreen(page, 'stats');
    const stats = page.locator('#stats-summary .stat');
    await expect(stats).toHaveCount(3);
    await expect(stats.nth(0).locator('.lbl')).toHaveText('bottiglie');
    await expect(stats.nth(1).locator('.lbl')).toHaveText('valore');
    await expect(stats.nth(2).locator('.lbl')).toHaveText('annata media');
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
