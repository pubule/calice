import { test, expect } from '@playwright/test';
import { gotoScreen, dismissAlert, modal } from './helpers';

// Profilo after build 153-154: a personal app, no follows, invites or
// notifications. What is left: identity, export, backup, help.
test.describe('Profilo — impostazioni', () => {
  test('"Aiuto" shows a help dialog', async ({ page }) => {
    await gotoScreen(page, 'profile');
    await page.click('#help-row');
    await expect(page.locator(modal.title)).toHaveText('Aiuto');
    await expect(page.locator(modal.message)).toContainText('Cantina: crea celle');
    await dismissAlert(page);
  });

  test('"Esporta CSV" downloads a CSV file', async ({ page }) => {
    await gotoScreen(page, 'profile');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export-csv-row')]);
    expect(download.suggestedFilename()).toMatch(/^calice-cantina-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  test('the backup row says when the automatic and the phone copies were made', async ({ page }) => {
    await gotoScreen(page, 'profile');
    await expect(page.locator('#backup-auto')).toContainText('Automatico:');
    await expect(page.locator('#backup-when')).toContainText('Sul telefono:');
  });
});
