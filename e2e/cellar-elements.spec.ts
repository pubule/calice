import { test, expect } from '@playwright/test';
import { gotoScreen, myCellarId, seedWine, seedBottle, confirmModal, cancelModal, runId } from './helpers';

const DELETE_ELEMENT_TITLE = 'Eliminare questo elemento?';

test.describe('Cantina — elementi', () => {
  let bottleName: string;

  test.beforeAll(async ({ request }) => {
    const cellarId = await myCellarId(request);
    bottleName = `Elementi Test Wine ${runId}`;
    const wine = await seedWine(request, { name: bottleName, producer: 'Cantina Test', type: 'rosso' });
    await seedBottle(request, cellarId, wine.id);
  });

  test('create a Scaffale, fill a slot via the reverse picker, open the bottle popup, cancel then confirm delete', async ({ page }) => {
    await gotoScreen(page, 'cellar');
    await page.click('#elements-link');
    await expect(page.locator('#elements-overlay')).toHaveClass(/open/);

    const elName = `Scaffale E2E ${runId}`;
    await page.click('#new-element-btn');
    await expect(page.locator('#elements-title')).toHaveText('Nuovo elemento');
    await page.click('.kind-opt[data-kind="Scaffale"]');
    await page.fill('#new-elem-name', elName);
    await page.fill('#new-elem-tiers', '2');
    await page.fill('#new-elem-cols', '3');
    await page.fill('#new-elem-depth', '1');
    await page.click('#create-element-btn');

    const row = page.locator('.elem-row', { hasText: elName });
    await expect(row).toBeVisible();
    await expect(row.locator('.elem-sub')).toHaveText('Scaffale · 2 livelli × 3 col.');
    await expect(row.locator('.elem-count')).toHaveText('0 bott.');

    await row.click();
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

    // Tapping a filled slot shows the bottle popup, not the picker.
    await filledSlot.click();
    await expect(page.locator('#bottle-popup')).toHaveClass(/show/);
    await expect(page.locator('#bottle-popup .bname')).toHaveText(bottleName);

    // Cancelling the delete confirmation must not delete anything.
    await page.click('#delete-element-btn');
    await expect(page.locator('#app-modal-title')).toHaveText(DELETE_ELEMENT_TITLE);
    await cancelModal(page);
    await expect(page.locator('#elements-title')).toHaveText(elName);

    // Confirming does delete it, and unassigns the bottle inside.
    await page.click('#delete-element-btn');
    await confirmModal(page);
    await expect(page.locator('.elem-row', { hasText: elName })).not.toBeVisible();
  });

  test('kind chips filter the elements list', async ({ page }) => {
    await gotoScreen(page, 'cellar');
    await page.click('#elements-link');

    const boxName = `Scatolone Filter E2E ${runId}`;
    await page.click('#new-element-btn');
    await page.click('.kind-opt[data-kind="Scatolone"]');
    await expect(page.locator('#new-elem-dims')).toBeHidden();
    await page.fill('#new-elem-name', boxName);
    await page.click('#create-element-btn');
    await expect(page.locator('.elem-row', { hasText: boxName })).toBeVisible();

    await page.click('#elements-kind-chips .chip:has-text("Scaffale")');
    await expect(page.locator('.elem-row', { hasText: boxName })).not.toBeVisible();
    await expect(page.locator('#elements-list .empty-note')).toBeVisible();

    await page.click('#elements-kind-chips .chip:has-text("Tutti")');
    await expect(page.locator('.elem-row', { hasText: boxName })).toBeVisible();
  });

  test('Scatolone: "Aggiungi bottiglia" opens the same reverse picker', async ({ page }) => {
    await gotoScreen(page, 'cellar');
    await page.click('#elements-link');
    const boxName = `Scatolone Assign E2E ${runId}`;
    await page.click('#new-element-btn');
    await page.click('.kind-opt[data-kind="Scatolone"]');
    await page.fill('#new-elem-name', boxName);
    await page.click('#create-element-btn');
    await page.click(`.elem-row:has-text("${boxName}")`);

    await expect(page.locator('.box-note')).toBeVisible();
    await page.click('#assign-box-btn');
    await expect(page.locator('#elements-title')).toHaveText('Scegli la bottiglia');
    await page.click(`#pick-bottle-list .elem-row:has-text("${bottleName}")`);
    await expect(page.locator('.box-item', { hasText: bottleName })).toBeVisible();
  });

  test('assigning a location from the bottle detail screen (forward picker)', async ({ page }) => {
    await gotoScreen(page, 'cellar');
    await page.click(`.cellar-row:has-text("${bottleName}")`);
    await expect(page.locator('#detail-overlay')).toHaveClass(/open/);

    await page.click('#loc-edit-btn');
    await expect(page.locator('#elements-overlay')).toHaveClass(/open/);
    await expect(page.locator('#elements-title')).toHaveText('Scegli dove riporla');

    const elName = `Cella E2E ${runId}`;
    await page.click('#new-element-btn');
    await page.click('.kind-opt[data-kind="Cella"]');
    await page.fill('#new-elem-name', elName);
    await page.fill('#new-elem-tiers', '1');
    await page.fill('#new-elem-cols', '2');
    await page.fill('#new-elem-depth', '1');
    await page.click('#create-element-btn');
    await page.click(`.elem-row:has-text("${elName}")`);
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
