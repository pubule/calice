import { test, expect } from '@playwright/test';
import { gotoScreen, seedWine, fillPrompt, dismissAlert, runId } from './helpers';

test.describe('Aggiungi vino', () => {
  test('local catalog search finds a seeded wine and adding it prompts for quantity', async ({ page, request }) => {
    const name = `Local Search Wine ${runId}`;
    await seedWine(request, { name, producer: 'Ricerca Locale', type: 'rosso' });

    await gotoScreen(page, 'add');
    await page.fill('#add-search-input', name);
    const row = page.locator('.result-row', { hasText: name });
    await expect(row).toBeVisible();
    await expect(page.locator('#add-results-count')).toHaveText('Risultati (1)');

    await row.locator('.add-btn').click();
    await fillPrompt(page, '3'); // "Aggiungi alla cantina" quantity prompt, prefilled with 1
    await dismissAlert(page); // "Aggiunto alla cantina"

    await gotoScreen(page, 'cellar');
    await expect(page.locator('.cellar-row', { hasText: name })).toContainText('×3');
  });

  test('manual add: empty name is rejected, a filled-in form saves a new wine', async ({ page }) => {
    await gotoScreen(page, 'add');
    await page.click('#manual-add-link');
    await expect(page.locator('#recognize-overlay')).toHaveClass(/open/);

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
    await fillPrompt(page, '1');
    await dismissAlert(page);

    await gotoScreen(page, 'cellar');
    await expect(page.locator('.cellar-row', { hasText: name })).toBeVisible();
  });

  test('a local catalog miss falls back to a (mocked) web search and opens the review sheet on a candidate tap', async ({ page }) => {
    // Mocked — a real call spends a Tavily credit, and this test only cares
    // about our own client-side rendering/wiring, not Tavily's result quality.
    await page.route('**/api/wines/recognize', (route) =>
      route.fulfill({
        json: {
          candidates: [
            { title: 'Query Wine Test | Vivino', snippet: 'Un vino di prova.', sourceUrl: 'https://vivino.com/query-wine-test', imageUrl: 'https://example.com/bottle.jpg' },
          ],
        },
      }),
    );

    const query = `zzznotinthecatalog${runId}`;
    await gotoScreen(page, 'add');
    await page.fill('#add-search-input', query);
    await expect(page.locator('#add-results')).toContainText('Cerco', { timeout: 2000 });
    await expect(page.locator('.result-row', { hasText: 'Query Wine Test' })).toBeVisible({ timeout: 3000 });

    await page.click('.result-row:has-text("Query Wine Test")');
    await expect(page.locator('#recognize-overlay')).toHaveClass(/open/);
    // The typed search text is trusted as the name (same principle as the
    // backend's query-search branch: a candidate lends its photo/source, but
    // never overrides what the user actually typed) — never the candidate's
    // own title, which could belong to a subtly different bottling.
    await expect(page.locator('#rec-name')).toHaveValue(query);
    await expect(page.locator('#recognize-rawtext')).toContainText('vivino.com');
    await page.click('#recognize-close');
  });

  test('"Cerca comunque sul web" forces a (mocked) web search even on a local hit', async ({ page, request }) => {
    const name = `Force Web Search Wine ${runId}`;
    await seedWine(request, { name, producer: 'Test', type: 'rosso' });

    let webSearchCalls = 0;
    await page.route('**/api/wines/recognize', (route) => {
      webSearchCalls++;
      return route.fulfill({ json: { candidates: [] } });
    });

    await gotoScreen(page, 'add');
    await page.fill('#add-search-input', name);
    await expect(page.locator('.result-row', { hasText: name })).toBeVisible();
    await expect(page.locator('#force-web-search-link')).toBeVisible();
    expect(webSearchCalls).toBe(0); // a local hit must not spend a web-search credit on its own

    await page.click('#force-web-search-link');
    await expect(page.locator('#add-results')).toContainText('Nessun risultato sul web', { timeout: 3000 });
    expect(webSearchCalls).toBe(1);
  });
});
