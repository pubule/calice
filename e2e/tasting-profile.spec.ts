import { test, expect, type Page } from '@playwright/test';
import { runId } from './helpers';

// The shared note module (tasting-profile.js) as hosted inline by the full
// add sheet ("Rivedi e conferma"), opened like a user would: "+" → a search
// with no match → "Aggiungilo a mano".
async function openManualSheet(page: Page) {
  await page.route('**/api/wines/recognize', (route) => route.fulfill({ json: { candidates: [] } }));
  await page.goto('/');
  await page.click('.nav-add');
  await page.fill('#add-search-input', `zzz${runId}${Math.random().toString(36).slice(2, 6)}`);
  await page.click('[data-manual]');
  await expect(page.locator('#recognize-overlay')).toHaveClass(/open/);
  return page.locator('#recognize-taste');
}

const readProfile = (page: Page) => page.evaluate(async () => {
  const m = await import('/js/tasting-profile.js');
  const p = m.readTastingProfile(document.getElementById('recognize-taste'));
  return { ...p, empty: m.isTastingProfileEmpty(p) };
});

test.describe('Modulo della nota (foglio Rivedi e conferma)', () => {
  test('sotto-tab: un pannello alla volta, parte da Aromi', async ({ page }) => {
    const tp = await openManualSheet(page);
    await expect(tp.locator('.tp-tabs [aria-selected="true"]')).toHaveText(/Aromi/);
    await expect(tp.locator('.tp-panel[data-tp-panel="gusto"]')).toBeHidden();
    await tp.locator('[data-tp-tab="gusto"]').click();
    await expect(tp.locator('.tp-panel[data-tp-panel="gusto"]')).toBeVisible();
    await expect(tp.locator('.tp-panel[data-tp-panel="aromi"]')).toBeHidden();
  });

  test('aromi scelti: riga Scelti, contatori, × li toglie', async ({ page }) => {
    const tp = await openManualSheet(page);
    await tp.locator('.flavor-chip-panel:not(.hidden) .chip', { hasText: /^Amarena$/ }).click();
    await expect(tp.locator('.tp-chosen')).toContainText('Amarena');
    await expect(tp.locator('.flavor-card[data-cat="frutta"] .tp-badge')).toHaveText('1');
    await expect(tp.locator('[data-tp-tab="aromi"] .tp-count')).toHaveText('1');
    await tp.locator('.tp-chosen button', { hasText: 'Amarena' }).click();
    await expect(tp.locator('.tp-chosen button')).toHaveCount(0);
    await expect(tp.locator('.flavor-card[data-cat="frutta"] .tp-badge')).toHaveText('');
  });

  test('ricerca su tutte le famiglie', async ({ page }) => {
    const tp = await openManualSheet(page);
    await tp.locator('.flavor-card[data-cat="spezie"]').click();
    await tp.locator('.tp-search').fill('pru');
    await expect(tp.locator('.tp-results .chip')).toHaveText(['Prugna', 'Prugna secca']);
    await tp.locator('.tp-results .chip', { hasText: 'Prugna secca' }).click();
    await expect(tp.locator('.tp-chosen')).toContainText('Prugna secca');
    await tp.locator('.tp-search').fill('');
    await expect(tp.locator('.flavor-chip-panel[data-cat="spezie"]')).toBeVisible();
    expect((await readProfile(page)).flavorTags).toEqual(['Prugna secca']);
  });

  test('Frutta divisa in gruppetti', async ({ page }) => {
    const tp = await openManualSheet(page);
    await expect(tp.locator('.flavor-chip-panel[data-cat="frutta"] .tp-group-label')).toHaveText(['Frutti rossi e neri', 'Agrumi', 'Frutta bianca e gialla', 'Tropicale', 'Secca e cotta']);
  });

  test('gusto: non segnato finché non si tocca, Azzera lo riporta a null', async ({ page }) => {
    const tp = await openManualSheet(page);
    await tp.locator('[data-tp-tab="gusto"]').click();
    const body = tp.locator('.taste-slider[data-axis="body"]');
    await expect(body).toHaveAttribute('data-unset', '');
    await expect(body.locator('.taste-word')).toHaveText('–');
    expect((await readProfile(page)).empty).toBe(true);
    await body.locator('.taste-dot').first().click(); // first dot → 10
    await expect(body).not.toHaveAttribute('data-unset', '');
    await expect(body.locator('.taste-word')).toHaveText('Leggero');
    expect((await readProfile(page)).tasteBody).toBe(10);
    // The chosen dot again leaves the axis unmarked; the fourth is the right side.
    await body.locator('.taste-dot').first().click();
    await expect(body).toHaveAttribute('data-unset', '');
    await body.locator('.taste-dot').nth(3).click();
    await expect(body.locator('.taste-word')).toHaveText('Strutturato');
    expect((await readProfile(page)).tasteBody).toBe(70);
    await expect(tp.locator('[data-tp-tab="gusto"] .tp-count')).toHaveText('1');
    await tp.locator('.tp-reset-taste').click();
    const p = await readProfile(page);
    expect([p.tasteBody, p.empty]).toEqual([null, true]);
  });

  test("nota dall'Assaggio guidato: assi null restano non segnati, testo nel sotto-tab Testo", async ({ page }) => {
    await page.route('**/api/wines/recognize', (route) => route.fulfill({ json: { candidates: [] } }));
    await page.goto('/');
    await page.waitForSelector('.nav-add');
    await page.evaluate(async () => {
      const { openAddSheet } = await import('/js/screens/add.js');
      openAddSheet({ query: '', tasting: { mode: 'cellar', done: () => {}, note: {
        rating: 4, text: "Dall'assaggio", flavorTags: ['Amarena'], foodPairings: [],
        tasteAcidity: null, tasteSweetness: null, tasteTannin: 70, tasteBody: null, tasteAlcohol: null, tasteIntensity: null, tasteFinish: null } } });
    });
    await page.fill('#add-search-input', `zzz${runId}assaggio`);
    await page.click('[data-manual]');
    await expect(page.locator('#recognize-overlay')).toHaveClass(/open/);
    const tp = page.locator('#recognize-taste');
    await expect(tp.locator('.tp-chosen')).toContainText('Amarena');
    await tp.locator('[data-tp-tab="gusto"]').click();
    await expect(tp.locator('.taste-slider[data-axis="body"]')).toHaveAttribute('data-unset', '');
    await expect(tp.locator('.taste-slider[data-axis="tannin"]')).not.toHaveAttribute('data-unset', '');
    await tp.locator('[data-tp-tab="testo"]').click();
    await expect(tp.locator('.tp-text')).toHaveValue("Dall'assaggio");
  });

  test('salvataggio dal foglio manda testo e assi null', async ({ page }) => {
    const tp = await openManualSheet(page);
    await page.fill('#rec-name', `Nota Modulo ${runId}`);
    await page.fill('#rec-producer', 'Cantina Modulo');
    await page.selectOption('#rec-type', 'rosso');
    await tp.locator('[data-tp-tab="testo"]').click();
    await tp.locator('.tp-text').fill('Nota di prova');
    const req = page.waitForRequest((r) => /\/api\/bottles\/\d+\/notes$/.test(r.url()) && r.method() === 'POST');
    await page.click('#recognize-save');
    const body = (await req).postDataJSON();
    expect(body.text).toBe('Nota di prova');
    expect(body.tasteBody).toBeNull();
  });
});
