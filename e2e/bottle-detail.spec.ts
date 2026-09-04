import { test, expect } from '@playwright/test';
import { gotoScreen, myCellarId, seedWine, seedBottle, confirmModal, cancelModal, runId } from './helpers';

test.describe('Dettaglio bottiglia', () => {
  let name: string;

  test.beforeAll(async ({ request }) => {
    const cellarId = await myCellarId(request);
    name = `Detail Test Wine ${runId}`;
    const wine = await seedWine(request, { name, producer: 'Detail Producer', region: 'Piemonte', type: 'rosso' });
    await seedBottle(request, cellarId, wine.id);
  });

  test('opens with hero info and accepts a tasting note', async ({ page }) => {
    await gotoScreen(page, 'cellar');
    await page.click(`.cellar-row:has-text("${name}")`);
    await expect(page.locator('#detail-overlay')).toHaveClass(/open/);
    await expect(page.locator('#detail-overlay .info .name')).toHaveText(name);
    await expect(page.locator('#loc-value')).toHaveText('Non assegnata');

    await page.click('.rev-tab:has-text("Le tue note")');
    await page.fill('#note-text', 'Ottimo vino, note di frutti rossi.');
    await page.locator('.stars-input span').nth(3).click(); // 4 stars
    await page.click('#note-submit');
    await expect(page.locator('#notes-mine')).toContainText('Ottimo vino, note di frutti rossi.');

    await page.click('#detail-close');
    await expect(page.locator('#detail-overlay')).not.toHaveClass(/open/);
  });

  test('deleting a bottle asks for confirmation and only deletes when confirmed', async ({ page, request }) => {
    const cellarId = await myCellarId(request);
    const deleteName = `Delete Confirm Wine ${runId}`;
    const wine = await seedWine(request, { name: deleteName, producer: 'Test', type: 'rosso' });
    await seedBottle(request, cellarId, wine.id);

    await gotoScreen(page, 'cellar');
    const row = page.locator('.cellar-row', { hasText: deleteName });
    await expect(row).toBeVisible();

    await row.locator('.delete-btn').click();
    await expect(page.locator('#app-modal-title')).toHaveText('Elimina bottiglia');
    await expect(page.locator('#app-modal-message')).toContainText(deleteName);
    await cancelModal(page);
    await expect(row).toBeVisible(); // cancelling must not delete

    await row.locator('.delete-btn').click();
    await confirmModal(page);
    await expect(page.locator('.cellar-row', { hasText: deleteName })).not.toBeVisible();
  });
});
