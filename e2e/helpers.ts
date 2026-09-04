import type { Page, APIRequestContext } from '@playwright/test';

// All requests in this suite run as the single fixed dev user
// (CALICE_DEV_EMAIL=e2e@test.com, set in playwright.config.ts's webServer
// command) — no login flow exists in this app (Cloudflare Access owns
// auth in production; the dev-email header/var bypass stands in for it
// locally, same mechanism the worker's own vitest suite uses).

export async function gotoScreen(page: Page, view: 'home' | 'cellar' | 'add' | 'stats' | 'profile') {
  const label = { home: 'Home', cellar: 'Cantina', add: 'Aggiungi', stats: 'Statistiche', profile: 'Profilo' }[view];
  // First navigation of a test needs a real page load; subsequent screen
  // switches go through the navbar like a real user would.
  if (page.url() === 'about:blank') await page.goto('/');
  await page.click(`.navbtn:has-text("${label}")`);
  await page.waitForSelector(`#view-${view}.active`);
}

export async function apiPost<T>(request: APIRequestContext, url: string, data: unknown): Promise<T> {
  const res = await request.post(url, { data });
  if (!res.ok()) throw new Error(`POST ${url} failed: ${res.status()} ${await res.text()}`);
  return res.json();
}

export async function apiGet<T>(request: APIRequestContext, url: string): Promise<T> {
  const res = await request.get(url);
  if (!res.ok()) throw new Error(`GET ${url} failed: ${res.status()} ${await res.text()}`);
  return res.json();
}

// Impersonates a second user via the X-Calice-Dev-Email header override
// (worker/src/lib/session.ts) so tests can exercise follow/unfollow against
// a real user row, without a login flow to drive in this app.
export async function seedUser(request: APIRequestContext, email: string): Promise<{ id: number; name: string }> {
  const res = await request.get('/api/auth/me', { headers: { 'X-Calice-Dev-Email': email } });
  if (!res.ok()) throw new Error(`seedUser ${email} failed: ${res.status()} ${await res.text()}`);
  return res.json();
}

export type Wine = { id: number; name: string; producer: string; country: string; region?: string; type: string };
export type Bottle = { id: number; wine_id: number; cellar_id: number };

// A run-unique suffix keeps repeated `npm run test:e2e` runs from colliding
// with wines/cellars/elements created by a previous run in the same
// (persistent, file-backed) local D1 — this suite never wipes that database
// between runs, it just never reuses a name.
export const runId = Date.now().toString(36);

export async function myCellarId(request: APIRequestContext): Promise<number> {
  const cellars = await apiGet<{ id: number }[]>(request, '/api/cellars');
  return cellars[0].id;
}

export async function seedWine(request: APIRequestContext, overrides: Partial<Wine> & { name: string }): Promise<Wine> {
  return apiPost<Wine>(request, '/api/wines', {
    producer: 'Test Producer',
    country: 'Italia',
    type: 'rosso',
    ...overrides,
  });
}

export async function seedBottle(request: APIRequestContext, cellarId: number, wineId: number, extra: Record<string, unknown> = {}): Promise<Bottle> {
  return apiPost<Bottle>(request, `/api/cellars/${cellarId}/bottles`, { wineId, quantity: 1, ...extra });
}

// Custom modal (public/js/modal.js) — replaces every native alert/confirm/prompt
// in the app, so every test interacts with these selectors instead of
// page.on('dialog').
export const modal = {
  root: '#app-modal.open',
  title: '#app-modal-title',
  message: '#app-modal-message',
  input: '#app-modal-input',
  confirmBtn: '#app-modal-confirm',
  cancelBtn: '#app-modal-cancel',
};

export async function fillPrompt(page: Page, value: string) {
  await page.waitForSelector(modal.root);
  await page.fill(modal.input, value);
  await page.click(modal.confirmBtn);
}

export async function confirmModal(page: Page) {
  await page.waitForSelector(modal.root);
  await page.click(modal.confirmBtn);
}

export async function cancelModal(page: Page) {
  await page.waitForSelector(modal.root);
  await page.click(modal.cancelBtn);
}

export async function dismissAlert(page: Page) {
  await page.waitForSelector(modal.root);
  await page.click(modal.confirmBtn);
}
