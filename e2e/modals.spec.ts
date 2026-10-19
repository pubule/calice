import { test, expect } from '@playwright/test';

// The app-wide custom modal (public/js/modal.js) that replaced every native
// alert/confirm/prompt, opened directly: every modal goes through it.
test.describe('Modale custom', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app-loader', { state: 'detached' });
    await page.evaluate(async () => {
      const { promptModal } = await import('/js/modal.js');
      (window as any).__answer = promptModal('Come si chiama?', { title: 'Prova' }).then((v: unknown) => ((window as any).__value = v));
    });
    await expect(page.locator('#app-modal')).toHaveClass(/open/);
  });

  test('backdrop click dismisses it like Annulla', async ({ page }) => {
    await page.click('#app-modal', { position: { x: 5, y: 5 } });
    await expect(page.locator('#app-modal')).not.toHaveClass(/open/);
    expect(await page.evaluate(() => (window as any).__answer)).toBeNull();
  });

  test('Escape dismisses it', async ({ page }) => {
    await page.keyboard.press('Escape');
    await expect(page.locator('#app-modal')).not.toHaveClass(/open/);
    expect(await page.evaluate(() => (window as any).__answer)).toBeNull();
  });

  test('Enter submits the input like tapping the confirm button', async ({ page }) => {
    await page.fill('#app-modal-input', 'Barolo');
    await page.keyboard.press('Enter');
    await expect(page.locator('#app-modal')).not.toHaveClass(/open/);
    expect(await page.evaluate(() => (window as any).__answer)).toBe('Barolo');
  });
});
