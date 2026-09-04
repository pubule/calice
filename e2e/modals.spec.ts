import { test, expect } from '@playwright/test';
import { gotoScreen } from './helpers';

// The app-wide custom modal (public/js/modal.js) that replaced every native
// alert/confirm/prompt — exercised here via the cellar-rename prompt, since
// any modal call goes through the same shared component.
test.describe('Modale custom', () => {
  test.beforeEach(async ({ page }) => {
    await gotoScreen(page, 'cellar');
    await page.click('#cantina-switch');
    await page.click('#new-cellar-btn');
    await expect(page.locator('#app-modal')).toHaveClass(/open/);
  });

  test('backdrop click dismisses it like Annulla', async ({ page }) => {
    await page.click('#app-modal', { position: { x: 5, y: 5 } });
    await expect(page.locator('#app-modal')).not.toHaveClass(/open/);
  });

  test('Escape dismisses it', async ({ page }) => {
    await page.keyboard.press('Escape');
    await expect(page.locator('#app-modal')).not.toHaveClass(/open/);
  });

  test('Enter submits the input like tapping the confirm button', async ({ page }) => {
    await page.fill('#app-modal-input', `Enter Submit Cellar ${Date.now()}`);
    await page.keyboard.press('Enter');
    await expect(page.locator('#app-modal')).not.toHaveClass(/open/);
    await expect(page.locator('#cellar-sheet')).toHaveClass(/open/);
  });
});
