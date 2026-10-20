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
    await page.click('#note-card .nc-sentence');
    await page.fill('#note-card .nc-edit', 'Ottimo vino, note di frutti rossi.');
    await page.click('#note-card .nc-edit-save');
    await expect(page.locator('#note-card .nc-text')).toHaveText('Ottimo vino, note di frutti rossi.');

    await page.click('#detail-close');
    await expect(page.locator('#detail-overlay')).not.toHaveClass(/open/);

    // Reopening starts again on "Il vino".
    await page.click(`.cellar-row:has-text("${name}")`);
    await expect(page.locator('#detail-tabs button.active')).toHaveText('Il vino');
    await expect(facts).toBeVisible();
  });

  test('Sentori: frase composta finché non la scrivi, righe che aprono il foglio, stelle sulla card', async ({ page, request }) => {
    const cellarId = await myCellarId(request);
    const sentoriName = `Sentori Wine ${runId}`;
    const wine = await seedWine(request, { name: sentoriName, producer: 'Sentori', type: 'rosso' });
    await seedBottle(request, cellarId, wine.id);
    await gotoScreen(page, 'cellar');
    await page.click(`.cellar-row:has-text("${sentoriName}")`);
    await page.click('#detail-tabs button:has-text("Sentori e note")');

    // No note yet: an invitation, and every row offers to add its part.
    const card = page.locator('#note-card');
    const rows = page.locator('#note-rows');
    await expect(card.locator('.nc-text')).toContainText('Nessuna nota');
    await expect(rows.locator('.nc-row[data-tab="aromi"]')).toContainText('+ Aggiungi aromi');

    // A row opens the sheet on that part only: no sub-tabs, no stars, no text.
    await rows.locator('.nc-row[data-tab="aromi"]').click();
    await expect(page.locator('#note-overlay')).toHaveClass(/open/);
    await expect(page.locator('#note-sheet-title')).toHaveText('Aromi');
    await expect(page.locator('#detail-taste .tp-tabs')).toBeHidden();
    await expect(page.locator('#note-overlay .stars-input')).toHaveCount(0);
    await expect(page.locator('#detail-taste .tp-text')).toBeHidden();
    await page.locator('#detail-taste .flavor-chip-panel:not(.hidden) .chip', { hasText: /^Amarena$/ }).click();
    await page.click('#note-save');
    await expect(page.locator('#note-overlay')).not.toHaveClass(/open/);
    await expect(rows.locator('.nc-row[data-tab="aromi"]')).toContainText('Amarena');
    // The sentence is the app's while the user has not written one.
    await expect(card.locator('.nc-text')).toHaveText('Profuma di amarena.');
    await expect(card.locator('.nc-meta')).toContainText('Scritta dall’app');
    await expect(card.locator('.nc-stars')).toHaveAttribute('aria-label', 'Il tuo voto: nessuno');

    // Tapping the sentence edits it in the card, prefilled; saving it unchanged keeps it the app's.
    await card.locator('.nc-sentence').click();
    await expect(card.locator('.nc-edit')).toHaveValue('Profuma di amarena.');
    await card.locator('.nc-edit-save').click();
    await expect(card.locator('.nc-meta')).toContainText('Scritta dall’app');
    // Writing makes it the user's.
    await card.locator('.nc-sentence').click();
    await card.locator('.nc-edit').fill('Lungo sul finale');
    await card.locator('.nc-edit-save').click();
    await expect(card.locator('.nc-text')).toHaveText('Lungo sul finale');
    await expect(card.locator('.nc-meta')).toContainText('Scritta da te');
    // Annulla leaves it as it was.
    await card.locator('.nc-sentence').click();
    await card.locator('.nc-edit').fill('Da buttare');
    await card.locator('.nc-edit-cancel').click();
    await expect(card.locator('.nc-text')).toHaveText('Lungo sul finale');

    // A changed taste axis shows up in its row; Azzera + save empties it again.
    await rows.locator('.nc-row[data-tab="gusto"]').click();
    await expect(page.locator('#note-sheet-title')).toHaveText('Gusto');
    await expect(page.locator('#detail-taste [data-tp-panel="gusto"]')).toBeVisible();
    await expect(page.locator('#detail-taste [data-tp-panel="aromi"]')).toBeHidden();
    await page.locator('#detail-taste .taste-slider[data-axis="body"] .taste-track').click({ position: { x: 5, y: 10 } });
    await page.click('#note-save');
    await expect(rows.locator('.nc-row[data-tab="gusto"]')).toContainText('Leggero');
    await expect(card.locator('.nc-text')).toHaveText('Lungo sul finale'); // the user's text is never rewritten
    await rows.locator('.nc-row[data-tab="gusto"]').click();
    await page.click('#detail-taste .tp-reset-taste');
    await page.click('#note-save');
    await expect(rows.locator('.nc-row[data-tab="gusto"]')).toContainText('+ Aggiungi il gusto');

    // Emptying the text gives the sentence back to the app.
    await card.locator('.nc-sentence').click();
    await card.locator('.nc-edit').fill('');
    await card.locator('.nc-edit-save').click();
    await expect(card.locator('.nc-text')).toHaveText('Profuma di amarena.');

    // Stars on the card save at once; the same star again clears the score;
    // the number takes a score with a comma.
    await card.locator('.nc-star').nth(2).click();
    await expect(card.locator('.nc-stars')).toHaveAttribute('aria-label', 'Il tuo voto: 3 su 5');
    await card.locator('.nc-star').nth(2).click();
    await expect(card.locator('.nc-stars')).toHaveAttribute('aria-label', 'Il tuo voto: nessuno');
    await card.locator('.nc-rate-num').click();
    await page.fill('#app-modal input', '4,5');
    await confirmModal(page);
    await expect(card.locator('.nc-stars')).toHaveAttribute('aria-label', 'Il tuo voto: 4,5 su 5');
    await expect(card.locator('.nc-text')).toHaveText('Profuma di amarena.');

    // Annulla with changes asks first; cancelling the question keeps the sheet.
    await rows.locator('.nc-row[data-tab="aromi"]').click();
    await page.locator('#detail-taste .tp-chosen button', { hasText: 'Amarena' }).click();
    await page.click('#note-cancel');
    await expect(page.locator('#app-modal-title')).toHaveText('Scartare le modifiche?');
    await cancelModal(page);
    await expect(page.locator('#note-overlay')).toHaveClass(/open/);
    await page.click('#note-cancel');
    await confirmModal(page);
    await expect(page.locator('#note-overlay')).not.toHaveClass(/open/);
    await expect(rows.locator('.nc-row[data-tab="aromi"]')).toContainText('Amarena'); // nothing saved

    // Annulla without changes closes at once.
    await rows.locator('.nc-row[data-tab="cibo"]').click();
    await expect(page.locator('#note-sheet-title')).toHaveText('Abbinamenti');
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

    // Elimina sits at the bottom of the sheet's "Il vino" tab (the list row
    // has it behind a swipe).
    await row.click();
    await page.click('#detail-delete-btn');
    await expect(page.locator('#app-modal-title')).toHaveText('Elimina bottiglia');
    await expect(page.locator('#app-modal-message')).toContainText(deleteName);
    await cancelModal(page);
    await expect(page.locator('#detail-overlay')).toHaveClass(/open/); // cancelling must not delete

    await page.click('#detail-delete-btn');
    await confirmModal(page);
    await expect(page.locator('.cellar-row', { hasText: deleteName })).not.toBeVisible();
  });
});
