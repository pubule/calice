import { test, expect } from '@playwright/test';
import { gotoScreen, myCellarId, seedWine, seedBottle, confirmModal, cancelModal, runId } from './helpers';

test.describe('Dettaglio bottiglia', () => {
  let name: string;

  test.beforeAll(async ({ request }) => {
    const cellarId = await myCellarId(request);
    name = `Detail Test Wine ${runId}`;
    const wine = await seedWine(request, {
      name, producer: 'Detail Producer', region: 'Piemonte', type: 'rosso',
      denomination: 'Barolo DOCG', grapeVariety: 'Nebbiolo, Barbera', alcohol: 14.5,
    } as Parameters<typeof seedWine>[1]);
    await seedBottle(request, cellarId, wine.id);
  });

  test('opens with hero info and accepts a tasting note', async ({ page }) => {
    await gotoScreen(page, 'cellar');
    await page.click(`.cellar-row:has-text("${name}")`);
    await expect(page.locator('#detail-overlay')).toHaveClass(/open/);
    await expect(page.locator('#detail-overlay .info .name')).toHaveText(name);

    // "Il vino" opens first, with the wine's data that used to be only in Modifica.
    const facts = page.locator('#detail-facts');
    await expect(facts).toBeVisible();
    await expect(facts.locator('.fact-row', { hasText: 'Denominazione' })).toContainText('Barolo DOCG');
    await expect(facts.locator('.grape-chip')).toHaveText(['Nebbiolo', 'Barbera']);
    await expect(facts.locator('.fact-row', { hasText: 'Gradazione' })).toContainText('14,5% vol');
    await expect(page.locator('#loc-value')).toBeHidden();

    await page.click('#detail-tabs button:has-text("In cantina")');
    await expect(page.locator('#loc-value')).toHaveText('Non assegnata');
    await expect(facts).toBeHidden();

    await page.click('#detail-tabs button:has-text("Sentori e note")');
    await page.click('#note-card button:has-text("Scrivi una nota")');
    await page.locator('#detail-taste [data-tp-tab="testo"]').click();
    await page.fill('#detail-taste .tp-text', 'Ottimo vino, note di frutti rossi.');
    await page.locator('#note-overlay .stars-input span').nth(3).click(); // 4 stars
    await page.click('#note-save');
    await expect(page.locator('#note-card .nc-text')).toHaveText('Ottimo vino, note di frutti rossi.');

    await page.click('#detail-close');
    await expect(page.locator('#detail-overlay')).not.toHaveClass(/open/);

    // Reopening starts again on "Il vino".
    await page.click(`.cellar-row:has-text("${name}")`);
    await expect(page.locator('#detail-tabs button.active')).toHaveText('Il vino');
    await expect(facts).toBeVisible();
  });

  test('Sentori: la card mostra solo i dati presenti, il foglio salva e chiede prima di scartare', async ({ page, request }) => {
    const cellarId = await myCellarId(request);
    const sentoriName = `Sentori Wine ${runId}`;
    const wine = await seedWine(request, { name: sentoriName, producer: 'Sentori', type: 'rosso' });
    await seedBottle(request, cellarId, wine.id);
    await gotoScreen(page, 'cellar');
    await page.click(`.cellar-row:has-text("${sentoriName}")`);
    await page.click('#detail-tabs button:has-text("Sentori e note")');

    // No note yet: only the button.
    const card = page.locator('#note-card');
    await expect(card).toHaveText(/Scrivi una nota/);
    await card.locator('button').click();
    await expect(page.locator('#note-overlay')).toHaveClass(/open/);

    // Aromas only, no stars: the card shows the aromas and nothing else.
    await page.locator('#detail-taste .flavor-chip-panel:not(.hidden) .chip', { hasText: /^Amarena$/ }).click();
    await page.click('#note-save');
    await expect(page.locator('#note-overlay')).not.toHaveClass(/open/);
    await expect(card).toContainText('La tua nota');
    await expect(card.locator('.nc-aromas')).toContainText('Frutta');
    await expect(card.locator('.nc-aromas')).toContainText('Amarena');
    await expect(card.locator('.nc-stars, .nc-text, .nc-taste, .nc-pairings')).toHaveCount(0);

    // Stars and text.
    await card.locator('button:has-text("Modifica la nota")').click();
    await page.locator('#note-overlay .stars-input span').nth(3).click();
    await page.locator('#detail-taste [data-tp-tab="testo"]').click();
    await page.fill('#detail-taste .tp-text', 'Lungo sul finale');
    await page.click('#note-save');
    await expect(card.locator('.nc-stars')).toHaveAttribute('aria-label', 'Il tuo voto: 4 su 5');
    await expect(card.locator('.nc-text')).toHaveText('Lungo sul finale');
    await expect(card.locator('.nc-taste')).toHaveCount(0);

    // A changed taste axis shows up; Azzera + save hides it again.
    await card.locator('button:has-text("Modifica la nota")').click();
    await page.locator('#detail-taste [data-tp-tab="gusto"]').click();
    await page.locator('#detail-taste .taste-slider[data-axis="body"] .taste-track').click({ position: { x: 5, y: 10 } });
    await page.click('#note-save');
    await expect(card.locator('.nc-taste')).toContainText('Corpo');
    await card.locator('button:has-text("Modifica la nota")').click();
    await page.locator('#detail-taste [data-tp-tab="gusto"]').click();
    await page.click('#detail-taste .tp-reset-taste');
    await page.click('#note-save');
    await expect(card.locator('.nc-taste')).toHaveCount(0);

    // Annulla with changes asks first; cancelling the question keeps the sheet.
    await card.locator('button:has-text("Modifica la nota")').click();
    await page.locator('#detail-taste .tp-chosen button', { hasText: 'Amarena' }).click();
    await page.click('#note-cancel');
    await expect(page.locator('#app-modal-title')).toHaveText('Scartare le modifiche?');
    await cancelModal(page);
    await expect(page.locator('#note-overlay')).toHaveClass(/open/);
    await page.click('#note-cancel');
    await confirmModal(page);
    await expect(page.locator('#note-overlay')).not.toHaveClass(/open/);
    await expect(card.locator('.nc-aromas')).toContainText('Amarena'); // nothing saved

    // Annulla without changes closes at once.
    await card.locator('button:has-text("Modifica la nota")').click();
    await page.click('#note-cancel');
    await expect(page.locator('#note-overlay')).not.toHaveClass(/open/);
    await expect(page.locator('#app-modal.open')).toHaveCount(0);
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
