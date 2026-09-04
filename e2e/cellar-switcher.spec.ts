import { test, expect } from '@playwright/test';
import { gotoScreen, fillPrompt, runId } from './helpers';

test.describe('Cantina — cellar switcher', () => {
  test('create a cellar, switch to it, rename it', async ({ page }) => {
    await gotoScreen(page, 'cellar');

    await page.click('#cantina-switch');
    await expect(page.locator('#cellar-sheet')).toHaveClass(/open/);
    await expect(page.locator('#cellar-rows .list-row')).toContainText(['Casa']);

    const newName = `Cantina E2E ${runId}`;
    await page.click('#new-cellar-btn');
    await fillPrompt(page, newName);
    await expect(page.locator('#cellar-sheet')).toHaveClass(/open/); // stays open, new row appended
    const newRow = page.locator('.list-row', { hasText: newName });
    await expect(newRow).toBeVisible();

    await newRow.locator('.lbody').click();
    await expect(page.locator('#cellar-sheet')).not.toHaveClass(/open/);
    await expect(page.locator('#active-cellar-name')).toHaveText(newName);
    // A freshly created cellar has no bottles.
    await expect(page.locator('#cellar-results-count')).toHaveText('0 bottiglie');

    // Rename it back to something we can recognize in later runs.
    const renamed = `${newName} renamed`;
    await page.click('#cantina-switch');
    await page.locator('.list-row', { hasText: newName }).locator('.rename-cellar-btn').click();
    await fillPrompt(page, renamed);
    await expect(page.locator('.list-row', { hasText: renamed })).toBeVisible();
    await expect(page.locator('#active-cellar-name')).toHaveText(renamed);
    await page.click('#cellar-sheet-close');
  });
});
