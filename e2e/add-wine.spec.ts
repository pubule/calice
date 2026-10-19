import { test, expect, type Page } from '@playwright/test';
import { seedWine, dismissAlert, runId, apiGet, myCellarId } from './helpers';

// "Aggiungi un vino" is a sheet opened by the "+" in the menu (no tab since
// build 148). A search shows the user's cellar, the catalogue and Vivino
// together; a row opens in place with the number of bottles and "Aggiungi".
async function openAdd(page: Page, query: string) {
  if (page.url() === 'about:blank') await page.goto('/');
  await page.click('.nav-add');
  await expect(page.locator('#add-overlay')).toHaveClass(/open/);
  await page.fill('#add-search-input', query);
}

test.describe('Aggiungi vino', () => {
  test('a catalogue result opens in place and adds the chosen number of bottles', async ({ page, request }) => {
    await page.route('**/api/wines/recognize', (route) => route.fulfill({ json: { candidates: [] } }));
    const name = `Local Search Wine ${runId}`;
    const wine = await seedWine(request, { name, producer: 'Ricerca Locale', type: 'rosso' });

    await openAdd(page, name);
    const row = page.locator('#add-results .result-row', { hasText: name });
    await expect(row).toBeVisible();
    await row.click();
    await page.fill('#exp-qty', '3');
    await page.click('[data-confirm]');
    await expect(page.locator('#add-overlay')).not.toHaveClass(/open/);

    const bottles = await apiGet<{ wine_id: number; quantity: number; name: string }[]>(request, `/api/cellars/${await myCellarId(request)}/bottles`);
    expect(bottles.find((b) => b.name === name)).toMatchObject({ wine_id: wine.id, quantity: 3 });
  });

  test('manual add: empty name is rejected, a filled-in form saves a new wine', async ({ page, request }) => {
    await page.route('**/api/wines/recognize', (route) => route.fulfill({ json: { candidates: [] } }));
    await openAdd(page, `zzzmanual${runId}`);
    await page.click('[data-manual]');
    await expect(page.locator('#recognize-overlay')).toHaveClass(/open/);

    await page.fill('#rec-name', '');
    await page.click('#recognize-save');
    await expect(page.locator('#app-modal-message')).toHaveText('Il nome del vino è obbligatorio');
    await dismissAlert(page);

    const name = `Manual Add Wine ${runId}`;
    await page.fill('#rec-name', name);
    await page.fill('#rec-producer', 'Cantina Manuale');
    await page.fill('#rec-region', 'Toscana');
    await page.selectOption('#rec-type', 'rosso');
    await page.fill('#rec-vintage', '2020');
    await page.click('#recognize-save');
    await expect(page.locator('#recognize-overlay')).not.toHaveClass(/open/);

    const bottles = await apiGet<{ name: string; region: string; vintage: number }[]>(request, `/api/cellars/${await myCellarId(request)}/bottles`);
    expect(bottles.find((b) => b.name === name)).toMatchObject({ region: 'Toscana', vintage: 2020 });
  });

  test('a Vivino result (mocked) opens the full sheet with its data', async ({ page }) => {
    await page.route('**/api/wines/recognize', (route) =>
      route.fulfill({
        json: { candidates: [{ title: 'Query Wine Test', snippet: 'Un vino di prova.', sourceUrl: 'https://www.vivino.com/query-wine-test', imageUrl: 'https://example.com/bottle.jpg' }] },
      }),
    );
    await openAdd(page, `zzznotinthecatalog${runId}`);
    const row = page.locator('#add-results .result-row', { hasText: 'Query Wine Test' });
    await expect(row).toBeVisible();
    await row.click();
    await page.click('[data-edit]');
    await expect(page.locator('#recognize-overlay')).toHaveClass(/open/);
    await expect(page.locator('#rec-name')).toHaveValue(/Query Wine Test/);
  });

  test('Vivino is searched even when the catalogue already has the wine', async ({ page, request }) => {
    const name = `Force Web Search Wine ${runId}`;
    await seedWine(request, { name, producer: 'Test', type: 'rosso' });
    let webSearchCalls = 0;
    await page.route('**/api/wines/recognize', (route) => {
      webSearchCalls++;
      return route.fulfill({ json: { candidates: [] } });
    });

    await openAdd(page, name);
    await expect(page.locator('#add-results .result-row', { hasText: name })).toBeVisible();
    await expect(page.locator('#add-results')).toContainText('Nessun altro risultato su Vivino');
    expect(webSearchCalls).toBeGreaterThan(0);
  });
});
