import { test, expect } from '@playwright/test';
import { gotoScreen, myCellarId, seedWine, seedBottle, confirmModal, cancelModal, runId } from './helpers';

const DELETE_ELEMENT_TITLE = 'Eliminare questo elemento?';

// Elements live in the "Cantina" tab (view-places): one card per element, and
// "Nuovo elemento" opens the two-step form (kind, then name and sizes).
test.describe('Cantina — elementi', () => {
  let bottleName: string;

  test.beforeAll(async ({ request }) => {
    const cellarId = await myCellarId(request);
    bottleName = `Elementi Test Wine ${runId}`;
    const wine = await seedWine(request, { name: bottleName, producer: 'Cantina Test', type: 'rosso' });
    // Several bottles: each test places one, and a bottle has one spot.
    await seedBottle(request, cellarId, wine.id, { quantity: 6 });
  });

  test('create a Scaffale, fill a slot via the reverse picker, open the bottle popup, cancel then confirm delete', async ({ page }) => {
    await gotoScreen(page, 'places');
    await page.click('#places-new-btn');
    await expect(page.locator('#elements-overlay')).toHaveClass(/open/);
    await expect(page.locator('#elements-title')).toHaveText('Nuovo elemento');

    const elName = `Scaffale E2E ${runId}`;
    await page.click('.kind-opt[data-kind="Scaffale"]');
    await expect(page.locator('#elements-title')).toHaveText('Nuovo: Scaffale');
    await page.fill('#new-elem-name', elName);
    await page.fill('#new-elem-tiers', '2');
    await page.fill('#new-elem-cols', '3');
    await expect(page.locator('#dims-preview')).toContainText('6 posti');
    await page.click('#create-element-btn');

    // Straight into the new element.
    await expect(page.locator('#elements-title')).toHaveText(elName);
    const stat = page.locator('.elem-stats .stat b');
    await expect(stat.nth(0)).toHaveText('6'); // capacità: 2 × 3 × 1
    await expect(stat.nth(1)).toHaveText('0'); // occupati

    // Browsing (no picker in flight): tapping an empty slot must ask which
    // bottle to place there instead of silently doing nothing.
    await page.click('.slot-circle[data-t="1"][data-c="0"][data-d="1"]');
    await expect(page.locator('#elements-title')).toHaveText('Scegli la bottiglia');
    await expect(page.locator('body')).toContainText('Livello 1 · A.1');
    await page.click(`#pick-bottle-list .elem-row:has-text("${bottleName}")`);

    // Back at the element detail, the slot is now filled and the count moved.
    await expect(page.locator('#elements-title')).toHaveText(elName);
    await expect(stat.nth(1)).toHaveText('1');
    const filledSlot = page.locator('.slot-circle.filled[data-t="1"][data-c="0"][data-d="1"]');
    await expect(filledSlot).toBeVisible();

    // Tapping a filled slot opens its card (Apri / Stappa / Sposta / Libera), not the picker.
    await filledSlot.click();
    await expect(page.locator('#slot-card')).toBeVisible();
    await expect(page.locator('#slot-card .elem-name')).toHaveText(bottleName);

    // Back closes the overlay: the card in the Cantina tab shows the element.
    await page.click('#elements-back-btn');
    await expect(page.locator('#elements-overlay')).not.toHaveClass(/open/);
    const card = page.locator('.place-card', { hasText: elName });
    await expect(card.locator('.place-sub')).toHaveText('Scaffale · 2 livelli × 3');
    await expect(card.locator('.place-count b')).toHaveText('1/6');
    await card.click();
    await expect(page.locator('#elements-title')).toHaveText(elName);

    // Cancelling the delete confirmation must not delete anything.
    await page.click('#delete-element-btn');
    await expect(page.locator('#app-modal-title')).toHaveText(DELETE_ELEMENT_TITLE);
    await cancelModal(page);
    await expect(page.locator('#elements-title')).toHaveText(elName);

    // Confirming does delete it, unassigns the bottle inside and closes the overlay.
    await page.click('#delete-element-btn');
    await confirmModal(page);
    await expect(page.locator('#elements-overlay')).not.toHaveClass(/open/);
    await expect(page.locator('.place-card', { hasText: elName })).not.toBeVisible();
  });

  test('"senza posto: sistemale" opens Vini filtered on bottles without a place', async ({ page }) => {
    await gotoScreen(page, 'places');
    await page.click('#places-unplaced');
    await expect(page.locator('#view-cellar')).toHaveClass(/active/);
    await expect(page.locator('#cellar-filter-badge')).toHaveText('1');
    await expect(page.locator('#cellar-sel-place')).toHaveValue('none');
    await expect(page.locator('.cellar-row', { hasText: bottleName })).toBeVisible();
  });

  test('Scatolone: no sizes, and "Aggiungi bottiglia" opens the same reverse picker', async ({ page, request }) => {
    // A second wine without a place, so the picker offers a search.
    const other = await seedWine(request, { name: `Altro Vino E2E ${runId}`, producer: 'Cantina Test', type: 'bianco' });
    await seedBottle(request, await myCellarId(request), other.id, { quantity: 1 });
    await gotoScreen(page, 'places');
    const boxName = `Scatolone Assign E2E ${runId}`;
    await page.click('#places-new-btn');
    await page.click('.kind-opt[data-kind="Scatolone"]');
    await expect(page.locator('.dims-card')).toHaveCount(0);
    await page.fill('#new-elem-name', boxName);
    await page.click('#create-element-btn');

    await expect(page.locator('.box-note')).toBeVisible();
    await page.click('#assign-box-btn');
    await expect(page.locator('#elements-title')).toHaveText('Scegli la bottiglia');
    // The search narrows the list (the dev database keeps wines of earlier runs).
    const rows = page.locator('#pick-bottle-list .elem-row');
    await page.fill('#pick-bottle-search', 'nessun vino si chiama così');
    await expect(rows.filter({ visible: true })).toHaveCount(0);
    await expect(page.locator('#pick-bottle-none')).toBeVisible();
    await page.fill('#pick-bottle-search', bottleName.toLowerCase());
    await expect(rows.filter({ visible: true })).toHaveCount(1);
    // The same Filtri sheet as Vini: Tipo "bianco" hides the red wine.
    await page.fill('#pick-bottle-search', 'E2E');
    await page.click('#pick-filter-btn');
    await expect(page.locator('#filter-sheet')).toHaveClass(/open/);
    await page.selectOption('#cellar-sel-type', 'bianco');
    await page.click('#filter-sheet-close');
    await expect(page.locator('#pick-filter-badge')).toHaveText('1');
    await expect(rows.filter({ hasText: bottleName, visible: true })).toHaveCount(0);
    await expect(rows.filter({ hasText: `Altro Vino E2E ${runId}`, visible: true })).toHaveCount(1);
    await page.click('#pick-filter-btn');
    await page.selectOption('#cellar-sel-type', '');
    await page.click('#filter-sheet-close');
    await page.fill('#pick-bottle-search', bottleName.toLowerCase());
    await page.click(`#pick-bottle-list .elem-row:has-text("${bottleName}")`);
    await expect(page.locator('.box-item', { hasText: bottleName })).toBeVisible();
  });

  test('create a Rack with the steppers and fill a slot via the reverse picker', async ({ page }) => {
    await gotoScreen(page, 'places');
    const elName = `Rack E2E ${runId}`;
    await page.click('#places-new-btn');
    await page.click('.kind-opt[data-kind="Rack"]');
    await page.fill('#new-elem-name', elName);
    // Defaults 3 × 5: two presses down on levels, three on bottles per level.
    for (let i = 0; i < 2; i++) await page.click('[aria-label="Un livello in meno"]');
    for (let i = 0; i < 3; i++) await page.click('[aria-label="Una bottiglia in meno per livello"]');
    await page.click('.dims-depth button[data-depth="2"]');
    await expect(page.locator('#dims-preview')).toContainText('4 posti');
    await page.click('#create-element-btn');

    await expect(page.locator('#elements-title')).toHaveText(elName);
    await expect(page.locator('.elem-stats .stat b').nth(0)).toHaveText('4'); // 1 × 2 × 2
    await page.click('.slot-circle[data-t="1"][data-c="0"][data-d="1"]');
    await expect(page.locator('#elements-title')).toHaveText('Scegli la bottiglia');
    await page.click(`#pick-bottle-list .elem-row:has-text("${bottleName}")`);
    await expect(page.locator('.slot-circle.filled[data-t="1"][data-c="0"][data-d="1"]')).toBeVisible();
  });

  test('assigning a location from the bottle detail screen (forward picker)', async ({ page }) => {
    await gotoScreen(page, 'cellar');
    await page.click(`.cellar-row:has-text("${bottleName}")`);
    await expect(page.locator('#detail-overlay')).toHaveClass(/open/);

    await page.click('#detail-tabs button:has-text("In cantina")');
    await page.click('#loc-edit-btn');
    await expect(page.locator('#elements-overlay')).toHaveClass(/open/);
    await expect(page.locator('#elements-title')).toHaveText('Scegli dove riporla');

    const elName = `Cella E2E ${runId}`;
    await page.click('#new-element-btn');
    await page.click('.kind-opt[data-kind="Cella"]');
    await page.fill('#new-elem-name', elName);
    await page.fill('#new-elem-tiers', '1');
    await page.fill('#new-elem-cols', '2');
    await page.click('#create-element-btn');
    await expect(page.locator('.elements-view')).toContainText(bottleName);

    await page.click('.slot-circle[data-t="1"][data-c="0"][data-d="1"]');

    // Picking a slot in forward-picker mode closes the elements overlay and
    // returns straight to the bottle detail screen underneath.
    await expect(page.locator('#elements-overlay')).not.toHaveClass(/open/);
    await expect(page.locator('#detail-overlay')).toHaveClass(/open/);
    await expect(page.locator('#loc-value')).toContainText(elName);
    await page.click('#detail-close');
  });
});
