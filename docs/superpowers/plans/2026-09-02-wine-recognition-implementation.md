# Wine Recognition (Photo/Barcode) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dead "Scansiona etichetta" tile and the dead-end barcode-miss with a real photo/barcode recognition flow that pre-fills an editable review form, backed by Cloudflare Workers AI (label OCR), Open Food Facts (barcode fallback), and Wikidata (grape variety/denomination enrichment) — all best-effort, all human-confirmed before saving.

**Architecture:** One new endpoint, `POST /api/wines/recognize`, orchestrates every external lookup server-side and returns a suggestion object (never saves anything). The frontend opens one review sheet — shared by the label-photo scan, the barcode-miss fallback, and manual add — pre-filled from that suggestion; saving still goes through the existing, unmodified `POST /api/wines`.

**Tech Stack:** Hono (existing), Cloudflare Workers AI (new binding), Open Food Facts REST API (unauthenticated), Wikidata `wbsearchentities`/`wbgetentities` REST API (unauthenticated). No new npm dependencies, no new frontend framework.

**Spec:** `docs/superpowers/specs/2026-09-02-wine-recognition-design.md`

## Global Constraints

- Nothing external is ever trusted blindly: every field the frontend shows is editable, and saving is always the human clicking "Salva" — no auto-save path exists anywhere in this plan.
- Every external call (Open Food Facts, Wikidata, Workers AI) is wrapped so its failure — timeout, network error, non-200, malformed body, binding not enabled on the account — degrades to "that field stays empty," never a 500 and never an unhandled exception.
- `POST /api/wines/recognize` requires `requireAuth` like every other route (`worker/src/lib/session.ts`, unchanged).
- No new npm dependencies. Timeouts use the platform `AbortController`/`fetch`, not a library.
- Match existing code style exactly: `worker/src/lib/access.ts`'s injectable-dependency pattern (a real implementation as the default parameter, a fake one injected in tests) is the model for every new lib function in this plan. `worker/src/cron.ts`'s `runNotificationScan(env, sendFn?)` is the model for the recognize route's own `buildSuggestion(env, body, deps?)` split between orchestration logic (directly unit-testable) and the thin Hono handler.
- Frontend: reuse existing CSS classes (`.compare-overlay`/`.compare-sheet`/`.compare-head`/`.search`/`.action`) — no new CSS rules needed for this feature's UI chrome. DOM writes use `.value`/`.textContent`/`.src` property assignment (never `innerHTML`) — consistent with the rest of `public/js/`, and inherently safe against the injection concerns `escapeHtml()` exists for elsewhere in this codebase.
- This project has no automated frontend test harness (`public/js/` — confirmed absent, matches every prior frontend task in this repo's history). The frontend task's "test" step is manual verification against a running `wrangler dev` instance, not an automated suite.

---

### Task 1: Wine schema — grape variety, denomination, image URL

**Files:**
- Create: `worker/migrations/0003_wine_recognition_fields.sql`
- Modify: `worker/src/routes/wines.ts`
- Test: `worker/test/wines.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `wines.grape_variety`, `wines.denomination`, `wines.image_url` columns (all nullable TEXT). `POST /api/wines` accepts optional `grapeVariety`, `denomination`, `imageUrl` in its body and returns them on the created row. Every later task that builds a "suggestion" object uses exactly these three field names (`grapeVariety`, `denomination`, `imageUrl`) in its JSON shape, matching this route's contract.

- [ ] **Step 1: Write the migration**

```sql
ALTER TABLE wines ADD COLUMN grape_variety TEXT;
ALTER TABLE wines ADD COLUMN denomination TEXT;
ALTER TABLE wines ADD COLUMN image_url TEXT;
```

- [ ] **Step 2: Write the failing test**

Add to `worker/test/wines.test.ts`, inside the existing `describe('POST /api/wines', ...)` block:

```ts
  it('accepts and returns grapeVariety, denomination, and imageUrl', async () => {
    const auth = signup('c5@b.com');
    const res = await app.request(
      '/api/wines',
      {
        method: 'POST',
        body: JSON.stringify({
          name: 'Barolo Riserva', producer: 'Zio Carlo', country: 'Italia', type: 'rosso',
          grapeVariety: 'Nebbiolo', denomination: 'Barolo DOCG', imageUrl: 'https://example.com/label.jpg',
        }),
        headers: { ...auth, 'content-type': 'application/json' },
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ grape_variety: string; denomination: string; image_url: string }>();
    expect(body.grape_variety).toBe('Nebbiolo');
    expect(body.denomination).toBe('Barolo DOCG');
    expect(body.image_url).toBe('https://example.com/label.jpg');
  });

  it('creates a wine with none of the optional recognition fields, same as before', async () => {
    const auth = signup('c6@b.com');
    const res = await app.request(
      '/api/wines',
      { method: 'POST', body: JSON.stringify({ name: 'Vino semplice', producer: 'Zio Carlo', country: 'Italia', type: 'rosso' }), headers: { ...auth, 'content-type': 'application/json' } },
      env,
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ grape_variety: string | null }>();
    expect(body.grape_variety).toBeNull();
  });
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd worker && npm test -- wines.test.ts`
Expected: FAIL — `POST /api/wines` doesn't accept or store these fields yet (the new columns don't exist either, so this would error before the route logic even runs).

- [ ] **Step 4: Update `wines.ts`'s POST route**

In `worker/src/routes/wines.ts`, change the body type, the insert, and the bind call:

```ts
wineRoutes.post('/', async (c) => {
  const body = await c.req.json<{
    name: string; producer: string; region?: string; country: string; type: string; vintage?: number; barcode?: string;
    grapeVariety?: string; denomination?: string; imageUrl?: string;
  }>();

  if (!isNonEmptyShortString(body.name)) return c.json({ error: 'name is required (1-200 chars)' }, 400);
  if (!isNonEmptyShortString(body.producer)) return c.json({ error: 'producer is required (1-200 chars)' }, 400);
  if (!isNonEmptyShortString(body.country)) return c.json({ error: 'country is required (1-200 chars)' }, 400);
  const type = typeof body.type === 'string' ? body.type.trim().toLowerCase() : body.type;
  if (!WINE_TYPES.includes(type)) return c.json({ error: `type must be one of ${WINE_TYPES.join(', ')}` }, 400);
  if (body.vintage != null && (!Number.isInteger(body.vintage) || body.vintage < 1900 || body.vintage > 2100)) {
    return c.json({ error: 'vintage must be an integer between 1900 and 2100' }, 400);
  }

  const wine = await c.env.DB
    .prepare(
      `insert into wines (name, producer, region, country, type, vintage, barcode, grape_variety, denomination, image_url, source, created_by)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'custom', ?) returning *`,
    )
    .bind(
      body.name, body.producer, body.region ?? null, body.country, type, body.vintage ?? null, body.barcode ?? null,
      body.grapeVariety ?? null, body.denomination ?? null, body.imageUrl ?? null, c.get('userId'),
    )
    .first();
  return c.json(wine);
});
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd worker && npm test -- wines.test.ts`
Expected: PASS (all 8 tests in this file)

- [ ] **Step 6: Run the full suite to confirm nothing else broke**

Run: `cd worker && npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add worker/migrations/0003_wine_recognition_fields.sql worker/src/routes/wines.ts worker/test/wines.test.ts
git commit -m "feat: add grape_variety/denomination/image_url to wines"
```

---

### Task 2: Barcode recognition — Open Food Facts fallback

**Files:**
- Create: `worker/src/lib/fetch-timeout.ts`
- Create: `worker/src/lib/open-food-facts.ts`
- Create: `worker/src/routes/recognize.ts`
- Modify: `worker/src/index.ts`
- Test: `worker/test/fetch-timeout.test.ts`
- Test: `worker/test/open-food-facts.test.ts`
- Test: `worker/test/recognize.test.ts`

**Interfaces:**
- Consumes: `wines` table's `barcode`/`grape_variety`/`denomination`/`image_url` columns (Task 1).
- Produces: `buildSuggestion(env: Env, body: { barcode?: string; photoBase64?: string }, deps?: RecognizeDeps): Promise<Suggestion>`, exported from `worker/src/routes/recognize.ts` — Tasks 3 and 4 extend this same function and its `RecognizeDeps` type (adding `enrichFromWikidata` and `runVisionOcr` to the deps object) rather than replacing it. `POST /api/wines/recognize` (mounted in `index.ts`), requiring auth, returning `Suggestion` as JSON.

- [ ] **Step 1: Write the failing test for `fetchWithTimeout`**

Create `worker/test/fetch-timeout.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fetchWithTimeout } from '../src/lib/fetch-timeout';

describe('fetchWithTimeout', () => {
  it('returns the response on success', async () => {
    const fetchImpl = (async () => new Response('ok')) as typeof fetch;
    const res = await fetchWithTimeout('https://example.com', 1000, fetchImpl);
    expect(await res!.text()).toBe('ok');
  });

  it('returns null when the fetch implementation throws', async () => {
    const fetchImpl = (async () => { throw new Error('boom'); }) as typeof fetch;
    expect(await fetchWithTimeout('https://example.com', 1000, fetchImpl)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd worker && npm test -- fetch-timeout.test.ts`
Expected: FAIL — `../src/lib/fetch-timeout` doesn't exist yet.

- [ ] **Step 3: Implement `fetchWithTimeout`**

Create `worker/src/lib/fetch-timeout.ts`:

```ts
// A small shared wrapper every external lookup in this feature uses: never
// throw, never hang past `ms`. A dependency being slow or down degrades the
// caller's data, it never turns into a 500.
export async function fetchWithTimeout(url: string, ms: number, fetchImpl: typeof fetch = fetch): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetchImpl(url, { signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `cd worker && npm test -- fetch-timeout.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing test for `lookupBarcode`**

Create `worker/test/open-food-facts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { lookupBarcode } from '../src/lib/open-food-facts';

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
}

describe('lookupBarcode', () => {
  it('maps a found product, taking only the first comma-separated brand/country', async () => {
    const fetchImpl = fakeFetch(200, {
      product: { product_name: 'Chianti Classico', brands: 'Antinori, Altro Marchio', countries: 'Italia,Toscana', image_url: 'https://x/img.jpg' },
    });
    const result = await lookupBarcode('8001234500019', fetchImpl);
    expect(result).toEqual({ name: 'Chianti Classico', producer: 'Antinori', country: 'Italia', imageUrl: 'https://x/img.jpg' });
  });

  it('returns null when the response has no product', async () => {
    const fetchImpl = fakeFetch(200, {});
    expect(await lookupBarcode('0000000000000', fetchImpl)).toBeNull();
  });

  it('returns null on a non-200 response', async () => {
    const fetchImpl = fakeFetch(404, {});
    expect(await lookupBarcode('0000000000000', fetchImpl)).toBeNull();
  });

  it('returns null when the fetch throws (network error or timeout)', async () => {
    const fetchImpl = (async () => { throw new Error('timeout'); }) as typeof fetch;
    expect(await lookupBarcode('0000000000000', fetchImpl)).toBeNull();
  });

  it('returns null when the response body is not valid JSON', async () => {
    const fetchImpl = (async () => new Response('not json', { status: 200 })) as typeof fetch;
    expect(await lookupBarcode('0000000000000', fetchImpl)).toBeNull();
  });
});
```

- [ ] **Step 6: Run it, confirm it fails**

Run: `cd worker && npm test -- open-food-facts.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 7: Implement `lookupBarcode`**

Create `worker/src/lib/open-food-facts.ts`:

```ts
import { fetchWithTimeout } from './fetch-timeout';

export type OffSuggestion = { name?: string; producer?: string; country?: string; imageUrl?: string };

export async function lookupBarcode(barcode: string, fetchImpl: typeof fetch = fetch): Promise<OffSuggestion | null> {
  const res = await fetchWithTimeout(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}`, 8000, fetchImpl);
  if (!res || !res.ok) return null;

  let body: any;
  try {
    body = await res.json();
  } catch {
    return null;
  }

  const product = body?.product;
  if (!product) return null;

  const suggestion: OffSuggestion = {};
  if (typeof product.product_name === 'string' && product.product_name.trim()) suggestion.name = product.product_name.trim();
  if (typeof product.brands === 'string' && product.brands.trim()) suggestion.producer = product.brands.split(',')[0].trim();
  if (typeof product.countries === 'string' && product.countries.trim()) suggestion.country = product.countries.split(',')[0].trim();
  if (typeof product.image_url === 'string' && product.image_url.trim()) suggestion.imageUrl = product.image_url.trim();
  return Object.keys(suggestion).length ? suggestion : null;
}
```

- [ ] **Step 8: Run it, confirm it passes**

Run: `cd worker && npm test -- open-food-facts.test.ts`
Expected: PASS

- [ ] **Step 9: Write the failing tests for `buildSuggestion` and the route**

Create `worker/test/recognize.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../src/index';
import { buildSuggestion } from '../src/routes/recognize';
import type { OffSuggestion } from '../src/lib/open-food-facts';

beforeEach(async () => {
  await env.DB.exec('DELETE FROM wines;');
});

describe('buildSuggestion', () => {
  it('returns the local wine and never calls Open Food Facts when the barcode is already in the catalog', async () => {
    await env.DB
      .prepare(`insert into wines (name, producer, country, type, barcode, grape_variety, denomination, image_url, source) values ('Barolo DOCG', 'Elio Altare', 'Italia', 'rosso', '8001234500019', 'Nebbiolo', 'Barolo DOCG', 'https://x/img.jpg', 'catalog')`)
      .run();
    const lookupBarcode = async (): Promise<OffSuggestion | null> => { throw new Error('should not be called'); };
    const result = await buildSuggestion(env, { barcode: '8001234500019' }, { lookupBarcode });
    expect(result).toEqual({
      name: 'Barolo DOCG', producer: 'Elio Altare', country: 'Italia', region: undefined, type: 'rosso',
      vintage: undefined, barcode: '8001234500019', grapeVariety: 'Nebbiolo', denomination: 'Barolo DOCG', imageUrl: 'https://x/img.jpg',
    });
  });

  it('falls back to Open Food Facts on a local miss and maps its fields', async () => {
    const lookupBarcode = async (): Promise<OffSuggestion | null> => ({ name: 'Chianti Classico', producer: 'Antinori', country: 'Italia', imageUrl: 'https://x/img.jpg' });
    const result = await buildSuggestion(env, { barcode: '1234567890123' }, { lookupBarcode });
    expect(result).toEqual({ barcode: '1234567890123', name: 'Chianti Classico', producer: 'Antinori', country: 'Italia', imageUrl: 'https://x/img.jpg' });
  });

  it('keeps the barcode and returns an otherwise-empty suggestion when Open Food Facts finds nothing', async () => {
    const lookupBarcode = async (): Promise<OffSuggestion | null> => null;
    const result = await buildSuggestion(env, { barcode: '0000000000000' }, { lookupBarcode });
    expect(result).toEqual({ barcode: '0000000000000' });
  });

  it('returns an empty suggestion when called with neither barcode nor photo', async () => {
    const result = await buildSuggestion(env, {});
    expect(result).toEqual({});
  });
});

describe('POST /api/wines/recognize', () => {
  it('requires barcode or photoBase64', async () => {
    const res = await app.request(
      '/api/wines/recognize',
      { method: 'POST', body: JSON.stringify({}), headers: { 'X-Calice-Dev-Email': 'rec1@b.com', 'content-type': 'application/json' } },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('requires auth', async () => {
    const noDevEmail = { ...env, CALICE_DEV_EMAIL: undefined };
    const res = await app.request(
      '/api/wines/recognize',
      { method: 'POST', body: JSON.stringify({ barcode: '123' }), headers: { 'content-type': 'application/json' } },
      noDevEmail,
    );
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 10: Run it, confirm it fails**

Run: `cd worker && npm test -- recognize.test.ts`
Expected: FAIL — `../src/routes/recognize` doesn't exist.

- [ ] **Step 11: Implement the route**

Create `worker/src/routes/recognize.ts`:

```ts
import { Hono } from 'hono';
import { requireAuth } from '../lib/session';
import { lookupBarcode as defaultLookupBarcode } from '../lib/open-food-facts';
import type { Env } from '../index';

export type Suggestion = {
  name?: string; producer?: string; country?: string; region?: string;
  type?: string; vintage?: number; barcode?: string;
  grapeVariety?: string; denomination?: string;
  imageUrl?: string; rawText?: string;
};

export type RecognizeDeps = {
  lookupBarcode: typeof defaultLookupBarcode;
};

function defaultDeps(): RecognizeDeps {
  return { lookupBarcode: defaultLookupBarcode };
}

type WineRow = {
  name: string; producer: string; country: string; region: string | null; type: string; vintage: number | null;
  barcode: string | null; grape_variety: string | null; denomination: string | null; image_url: string | null;
};

export async function buildSuggestion(
  env: Env,
  body: { barcode?: string; photoBase64?: string },
  deps: RecognizeDeps = defaultDeps(),
): Promise<Suggestion> {
  const suggestion: Suggestion = {};

  if (body.barcode) {
    const local = await env.DB.prepare('select * from wines where barcode = ? limit 1').bind(body.barcode).first<WineRow>();
    if (local) {
      return {
        name: local.name, producer: local.producer, country: local.country, region: local.region ?? undefined,
        type: local.type, vintage: local.vintage ?? undefined, barcode: local.barcode ?? undefined,
        grapeVariety: local.grape_variety ?? undefined, denomination: local.denomination ?? undefined, imageUrl: local.image_url ?? undefined,
      };
    }

    suggestion.barcode = body.barcode;
    const off = await deps.lookupBarcode(body.barcode);
    if (off) {
      if (off.name) suggestion.name = off.name;
      if (off.producer) suggestion.producer = off.producer;
      if (off.country) suggestion.country = off.country;
      if (off.imageUrl) suggestion.imageUrl = off.imageUrl;
    }
  }

  return suggestion;
}

export const recognizeRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
recognizeRoutes.use('*', requireAuth);

recognizeRoutes.post('/', async (c) => {
  const body = await c.req.json<{ barcode?: string; photoBase64?: string }>();
  if (!body.barcode && !body.photoBase64) return c.json({ error: 'barcode or photoBase64 required' }, 400);
  const suggestion = await buildSuggestion(c.env, body);
  return c.json(suggestion);
});
```

- [ ] **Step 12: Wire the route into `index.ts`**

In `worker/src/index.ts`, add the import and mount line (right after the existing `wineRoutes` mount, since this is a wine-search-adjacent route):

```ts
import { recognizeRoutes } from './routes/recognize';
```

```ts
app.route('/api/wines/recognize', recognizeRoutes);
```

- [ ] **Step 13: Run it, confirm it passes**

Run: `cd worker && npm test -- recognize.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 14: Run the full suite**

Run: `cd worker && npm test`
Expected: PASS

- [ ] **Step 15: Commit**

```bash
git add worker/src/lib/fetch-timeout.ts worker/src/lib/open-food-facts.ts worker/src/routes/recognize.ts worker/src/index.ts worker/test/fetch-timeout.test.ts worker/test/open-food-facts.test.ts worker/test/recognize.test.ts
git commit -m "feat: add POST /api/wines/recognize with Open Food Facts barcode fallback"
```

---

### Task 3: Wikidata enrichment (grape variety)

**Files:**
- Create: `worker/src/lib/wikidata.ts`
- Modify: `worker/src/routes/recognize.ts`
- Test: `worker/test/wikidata.test.ts`
- Test: `worker/test/recognize.test.ts`

**Interfaces:**
- Consumes: `Suggestion.name`/`Suggestion.producer` fields produced by Task 2's `buildSuggestion`.
- Produces: `enrichFromWikidata(name: string, producer: string | undefined, fetchImpl?: typeof fetch): Promise<WikidataSuggestion | null>` from `worker/src/lib/wikidata.ts`, added to `RecognizeDeps` as `enrichFromWikidata`, consumed the same way in Task 4.

Verified live against the real Wikidata API while writing this plan (searched `Barolo DOCG` → `Q808584`, fetched its claims): the property that holds a wine's grape variety is **P186** ("made from material") — `Q808584`'s `P186` claim points to `Q202290`, whose label resolves to "Nebbiolo". `P527` ("has part(s)") pointed to the same entity on this item and is used as a fallback in case a different wine item only has one of the two set. There is no separate, reliably-present property for "denomination/appellation" on these items — most items Wikidata actually has for wine ARE the denomination itself (e.g. `Q808584` *is* "Barolo DOCG"), so a wine-appellation match found this way already surfaces as `grapeVariety`, not as a separate field. This plan therefore only enriches `grapeVariety` from Wikidata — `Suggestion.denomination` is still a real field (Task 4's OCR can set it directly from label text), just not one Wikidata fills in here.

- [ ] **Step 1: Write the failing test**

Create `worker/test/wikidata.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { enrichFromWikidata } from '../src/lib/wikidata';

function fakeFetch(responses: { search: unknown; claims?: unknown; entity?: unknown }): typeof fetch {
  return (async (url: string | URL) => {
    const u = url.toString();
    if (u.includes('wbsearchentities')) return new Response(JSON.stringify(responses.search), { status: 200 });
    if (u.includes('wbgetclaims')) return new Response(JSON.stringify(responses.claims), { status: 200 });
    return new Response(JSON.stringify(responses.entity), { status: 200 });
  }) as typeof fetch;
}

describe('enrichFromWikidata', () => {
  it('resolves a known wine to its grape variety via P186', async () => {
    const fetchImpl = fakeFetch({
      search: { search: [{ id: 'Q808584' }] },
      claims: { claims: { P186: [{ mainsnak: { datavalue: { value: { id: 'Q202290' } } } }] } },
      entity: { entities: { Q202290: { labels: { it: { value: 'Nebbiolo' }, en: { value: 'Nebbiolo' } } } } },
    });
    const result = await enrichFromWikidata('Barolo DOCG', undefined, fetchImpl);
    expect(result).toEqual({ grapeVariety: 'Nebbiolo' });
  });

  it('falls back to P527 when P186 is absent', async () => {
    const fetchImpl = fakeFetch({
      search: { search: [{ id: 'Q1' }] },
      claims: { claims: { P527: [{ mainsnak: { datavalue: { value: { id: 'Q2' } } } }] } },
      entity: { entities: { Q2: { labels: { en: { value: 'Sangiovese' } } } } },
    });
    const result = await enrichFromWikidata('Chianti Classico', 'Antinori', fetchImpl);
    expect(result).toEqual({ grapeVariety: 'Sangiovese' });
  });

  it('returns null when no entity matches the search', async () => {
    const fetchImpl = fakeFetch({ search: { search: [] } });
    expect(await enrichFromWikidata('Vino inventato che non esiste', undefined, fetchImpl)).toBeNull();
  });

  it('returns null when the matched entity has neither P186 nor P527', async () => {
    const fetchImpl = fakeFetch({ search: { search: [{ id: 'Q1' }] }, claims: { claims: {} } });
    expect(await enrichFromWikidata('Qualcosa', undefined, fetchImpl)).toBeNull();
  });

  it('returns null when the search request fails', async () => {
    const fetchImpl = (async () => { throw new Error('timeout'); }) as typeof fetch;
    expect(await enrichFromWikidata('Barolo DOCG', 'Elio Altare', fetchImpl)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd worker && npm test -- wikidata.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `enrichFromWikidata`**

Create `worker/src/lib/wikidata.ts`:

```ts
import { fetchWithTimeout } from './fetch-timeout';

export type WikidataSuggestion = { grapeVariety?: string };

// P186 ("made from material") and P527 ("has part(s)") confirmed live against
// https://www.wikidata.org/wiki/Q808584 (Barolo DOCG) while writing this
// plan: both point to Q202290, which labels as "Nebbiolo". See Task 3 in
// docs/superpowers/plans/2026-09-02-wine-recognition-implementation.md.
const GRAPE_VARIETY_PROPERTIES = ['P186', 'P527'];

function claimEntityId(claims: any, property: string): string | null {
  return claims?.[property]?.[0]?.mainsnak?.datavalue?.value?.id ?? null;
}

async function resolveLabel(entityId: string, fetchImpl: typeof fetch): Promise<string | null> {
  const res = await fetchWithTimeout(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${entityId}&props=labels&languages=it|en&format=json`,
    8000,
    fetchImpl,
  );
  if (!res || !res.ok) return null;
  try {
    const body: any = await res.json();
    const labels = body?.entities?.[entityId]?.labels;
    return labels?.it?.value ?? labels?.en?.value ?? null;
  } catch {
    return null;
  }
}

export async function enrichFromWikidata(name: string, producer: string | undefined, fetchImpl: typeof fetch = fetch): Promise<WikidataSuggestion | null> {
  const query = producer ? `${name} ${producer}` : name;
  const searchRes = await fetchWithTimeout(
    `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(query)}&language=it&format=json&type=item&limit=1`,
    8000,
    fetchImpl,
  );
  if (!searchRes || !searchRes.ok) return null;

  let entityId: string | null = null;
  try {
    const searchBody: any = await searchRes.json();
    entityId = searchBody?.search?.[0]?.id ?? null;
  } catch {
    return null;
  }
  if (!entityId) return null;

  const claimsRes = await fetchWithTimeout(`https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${entityId}&format=json`, 8000, fetchImpl);
  if (!claimsRes || !claimsRes.ok) return null;

  let claims: any;
  try {
    const claimsBody: any = await claimsRes.json();
    claims = claimsBody?.claims;
  } catch {
    return null;
  }
  if (!claims) return null;

  let grapeId: string | null = null;
  for (const property of GRAPE_VARIETY_PROPERTIES) {
    grapeId = claimEntityId(claims, property);
    if (grapeId) break;
  }
  if (!grapeId) return null;

  const label = await resolveLabel(grapeId, fetchImpl);
  return label ? { grapeVariety: label } : null;
}
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `cd worker && npm test -- wikidata.test.ts`
Expected: PASS

- [ ] **Step 5: Wire it into `buildSuggestion`**

In `worker/src/routes/recognize.ts`:

```ts
import { enrichFromWikidata as defaultEnrichFromWikidata } from '../lib/wikidata';
```

```ts
export type RecognizeDeps = {
  lookupBarcode: typeof defaultLookupBarcode;
  enrichFromWikidata: typeof defaultEnrichFromWikidata;
};

function defaultDeps(): RecognizeDeps {
  return { lookupBarcode: defaultLookupBarcode, enrichFromWikidata: defaultEnrichFromWikidata };
}
```

At the end of `buildSuggestion`, before the final `return suggestion;` (both the early-return-on-local-hit path and the fall-through path should skip this if the name is still unknown):

```ts
  if (suggestion.name && !suggestion.grapeVariety) {
    const wd = await deps.enrichFromWikidata(suggestion.name, suggestion.producer);
    if (wd?.grapeVariety) suggestion.grapeVariety = wd.grapeVariety;
  }

  return suggestion;
```

Note the early-return branch (local DB hit) returns directly and does NOT go through this — a wine already fully known locally doesn't need Wikidata. Move that `return` to fall through to this block instead if you want local hits enriched too; the spec doesn't require it (a locally-cataloged wine already has whatever grape variety data a prior save gave it), so leaving the early return as-is is correct.

- [ ] **Step 6: Add a `buildSuggestion` test for the enrichment**

Add to `worker/test/recognize.test.ts`, inside `describe('buildSuggestion', ...)`:

```ts
  it('enriches with grape variety once a name is known from Open Food Facts', async () => {
    const lookupBarcode = async () => ({ name: 'Barolo DOCG', producer: 'Elio Altare' });
    const enrichFromWikidata = async (name: string, producer?: string) => {
      expect(name).toBe('Barolo DOCG');
      expect(producer).toBe('Elio Altare');
      return { grapeVariety: 'Nebbiolo' };
    };
    const result = await buildSuggestion(env, { barcode: '9999999999999' }, { lookupBarcode, enrichFromWikidata });
    expect(result.grapeVariety).toBe('Nebbiolo');
  });

  it('skips Wikidata entirely when no name is known yet', async () => {
    const lookupBarcode = async () => null;
    const enrichFromWikidata = async (): Promise<never> => { throw new Error('should not be called'); };
    const result = await buildSuggestion(env, { barcode: '9999999999998' }, { lookupBarcode, enrichFromWikidata });
    expect(result).toEqual({ barcode: '9999999999998' });
  });
```

- [ ] **Step 7: Run the full suite**

Run: `cd worker && npm test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add worker/src/lib/wikidata.ts worker/src/routes/recognize.ts worker/test/wikidata.test.ts worker/test/recognize.test.ts
git commit -m "feat: enrich wine suggestions with grape variety from Wikidata"
```

---

### Task 4: Workers AI label OCR

**Files:**
- Create: `worker/src/lib/vision-ocr.ts`
- Modify: `worker/src/index.ts`
- Modify: `worker/src/routes/recognize.ts`
- Modify: `worker/wrangler.jsonc`
- Modify: `wrangler.jsonc` (root)
- Test: `worker/test/vision-ocr.test.ts`
- Test: `worker/test/recognize.test.ts`

**Interfaces:**
- Consumes: `Env.AI` binding (new).
- Produces: `runVisionOcr(ai: Ai, photoBase64: string): Promise<OcrResult | null>` from `worker/src/lib/vision-ocr.ts`, where `OcrResult = { parsed?: { name?: string; producer?: string; vintage?: number; denomination?: string }; rawText?: string }`. Wired into `buildSuggestion` as `deps.runVisionOcr`, filling the same `Suggestion` fields Task 2/3 already produce, plus `Suggestion.rawText`.

Verified live against this account's real Workers AI catalog (`GET /accounts/{account_id}/ai/models/search?task=Image-to-Text`) while writing this plan: `@cf/llava-hf/llava-1.5-7b-hf` exists on the account and carries no `price` property (unlike the newer `@cf/moondream/moondream3.1-9B-A2B`, which is metered per token) — the free-tier-friendly choice, matching the "zero euro" goal this whole feature is built around. Workers AI models can still be renamed/retired over time, so if `ai.run()` errors specifically with a model-not-found message at real deploy time, re-run that same catalog search rather than guessing a replacement. The exact shape of a successful response (`{ description: string }` vs `{ response: string }`) isn't guaranteed by the catalog listing above, so the implementation below defensively reads either key.

- [ ] **Step 1: Add the AI binding**

In `worker/wrangler.jsonc` (test config), add:

```jsonc
  "ai": { "binding": "AI" },
```

In the root `wrangler.jsonc` (production config, already merged with the frontend per the auth-migration commit), add the same:

```jsonc
  "ai": { "binding": "AI" },
```

In `worker/src/index.ts`, add `AI: Ai;` to the `Env` type (the `Ai` type comes from `@cloudflare/workers-types`, already a dependency — no new import needed beyond what TypeScript's ambient types already provide).

- [ ] **Step 2: Write the failing test**

Create `worker/test/vision-ocr.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { runVisionOcr } from '../src/lib/vision-ocr';

describe('runVisionOcr', () => {
  it('parses a valid JSON response', async () => {
    const fakeAi = { run: async () => ({ description: '{"name":"Barolo DOCG","producer":"Elio Altare","vintage":2016,"denomination":"Barolo DOCG"}' }) } as any;
    const result = await runVisionOcr(fakeAi, 'data:image/jpeg;base64,AAAA');
    expect(result).toEqual({ parsed: { name: 'Barolo DOCG', producer: 'Elio Altare', vintage: 2016, denomination: 'Barolo DOCG' } });
  });

  it('falls back to rawText when the response is not valid JSON', async () => {
    const fakeAi = { run: async () => ({ description: 'Barolo DOCG 2016, Elio Altare' }) } as any;
    const result = await runVisionOcr(fakeAi, 'data:image/jpeg;base64,AAAA');
    expect(result).toEqual({ rawText: 'Barolo DOCG 2016, Elio Altare' });
  });

  it('also reads a { response } shape (some Workers AI models use this key instead of description)', async () => {
    const fakeAi = { run: async () => ({ response: '{"name":"Chianti"}' }) } as any;
    const result = await runVisionOcr(fakeAi, 'data:image/jpeg;base64,AAAA');
    expect(result).toEqual({ parsed: { name: 'Chianti' } });
  });

  it('returns null when the AI binding throws (not enabled on the account, model error, etc.)', async () => {
    const fakeAi = { run: async () => { throw new Error('AI binding not available'); } } as any;
    expect(await runVisionOcr(fakeAi, 'data:image/jpeg;base64,AAAA')).toBeNull();
  });

  it('returns null when the model returns no usable text at all', async () => {
    const fakeAi = { run: async () => ({}) } as any;
    expect(await runVisionOcr(fakeAi, 'data:image/jpeg;base64,AAAA')).toBeNull();
  });
});
```

- [ ] **Step 3: Run it, confirm it fails**

Run: `cd worker && npm test -- vision-ocr.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 4: Implement**

Create `worker/src/lib/vision-ocr.ts`:

```ts
// Confirmed present on this account's Workers AI catalog on 2026-09-02
// (GET /accounts/{account_id}/ai/models/search?task=Image-to-Text) — no
// `price` property, unlike @cf/moondream/moondream3.1-9B-A2B.
const VISION_MODEL = '@cf/llava-hf/llava-1.5-7b-hf';

const PROMPT =
  'Extract the wine name, producer/winery, vintage year, and denomination/appellation ' +
  '(e.g. DOCG, DOC, AOC, AVA) visible on this label. Reply with ONLY a JSON object: ' +
  '{"name": string|null, "producer": string|null, "vintage": number|null, "denomination": string|null}. ' +
  'No other text before or after the JSON.';

export type OcrResult = { parsed?: { name?: string; producer?: string; vintage?: number; denomination?: string }; rawText?: string };

function base64ToBytes(dataUrl: string): number[] {
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  const binary = atob(base64);
  const bytes = new Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function runVisionOcr(ai: Ai, photoBase64: string): Promise<OcrResult | null> {
  let text: string;
  try {
    const response: any = await ai.run(VISION_MODEL as any, { image: base64ToBytes(photoBase64), prompt: PROMPT, max_tokens: 256 });
    text = typeof response === 'string' ? response : (response?.description ?? response?.response ?? '');
  } catch {
    return null;
  }
  if (!text || !text.trim()) return null;

  try {
    const parsed = JSON.parse(text.trim());
    const clean: NonNullable<OcrResult['parsed']> = {};
    if (typeof parsed.name === 'string' && parsed.name.trim()) clean.name = parsed.name.trim();
    if (typeof parsed.producer === 'string' && parsed.producer.trim()) clean.producer = parsed.producer.trim();
    if (typeof parsed.vintage === 'number' && Number.isInteger(parsed.vintage)) clean.vintage = parsed.vintage;
    if (typeof parsed.denomination === 'string' && parsed.denomination.trim()) clean.denomination = parsed.denomination.trim();
    return Object.keys(clean).length ? { parsed: clean } : { rawText: text };
  } catch {
    return { rawText: text };
  }
}
```

- [ ] **Step 5: Run it, confirm it passes**

Run: `cd worker && npm test -- vision-ocr.test.ts`
Expected: PASS

- [ ] **Step 6: Wire it into `buildSuggestion`**

In `worker/src/routes/recognize.ts`:

```ts
import { runVisionOcr as defaultRunVisionOcr } from '../lib/vision-ocr';
```

```ts
export type RecognizeDeps = {
  lookupBarcode: typeof defaultLookupBarcode;
  enrichFromWikidata: typeof defaultEnrichFromWikidata;
  runVisionOcr: (photoBase64: string) => ReturnType<typeof defaultRunVisionOcr>;
};

function defaultDeps(env: Env): RecognizeDeps {
  return {
    lookupBarcode: defaultLookupBarcode,
    enrichFromWikidata: defaultEnrichFromWikidata,
    runVisionOcr: (photoBase64) => defaultRunVisionOcr(env.AI, photoBase64),
  };
}
```

Update `buildSuggestion`'s signature so its default `deps` can reference `env` (default parameter values can reference earlier parameters of the same function):

```ts
export async function buildSuggestion(
  env: Env,
  body: { barcode?: string; photoBase64?: string },
  deps: RecognizeDeps = defaultDeps(env),
): Promise<Suggestion> {
```

After the barcode block (and its early return for a local hit), before the Wikidata block, add:

```ts
  if (body.photoBase64 && !suggestion.name) {
    const ocr = await deps.runVisionOcr(body.photoBase64);
    if (ocr?.parsed) {
      if (ocr.parsed.name) suggestion.name = ocr.parsed.name;
      if (ocr.parsed.producer) suggestion.producer = ocr.parsed.producer;
      if (ocr.parsed.vintage) suggestion.vintage = ocr.parsed.vintage;
      if (ocr.parsed.denomination) suggestion.denomination = ocr.parsed.denomination;
    } else if (ocr?.rawText) {
      suggestion.rawText = ocr.rawText;
    }
  }
```

Update the route handler to pass `c.env`'s `AI` implicitly (it already does, since `deps` now defaults from `defaultDeps(c.env)` — no handler change needed, `buildSuggestion(c.env, body)` already works because `env` is the first argument).

- [ ] **Step 7: Update the 400 check to keep working, and add `buildSuggestion`/route tests for the photo path**

Add to `worker/test/recognize.test.ts`, inside `describe('buildSuggestion', ...)`:

```ts
  it('runs OCR on a photo when no barcode/local name is known, and fills the suggestion from it', async () => {
    const runVisionOcr = async (photoBase64: string) => {
      expect(photoBase64).toBe('data:image/jpeg;base64,AAAA');
      return { parsed: { name: 'Chianti Classico', producer: 'Antinori', vintage: 2019, denomination: 'Chianti Classico DOCG' } };
    };
    const result = await buildSuggestion(env, { photoBase64: 'data:image/jpeg;base64,AAAA' }, { runVisionOcr } as any);
    expect(result.name).toBe('Chianti Classico');
    expect(result.vintage).toBe(2019);
  });

  it('surfaces rawText when OCR could not produce structured JSON', async () => {
    const runVisionOcr = async () => ({ rawText: 'Chianti Classico 2019' });
    const result = await buildSuggestion(env, { photoBase64: 'data:image/jpeg;base64,AAAA' }, { runVisionOcr } as any);
    expect(result.rawText).toBe('Chianti Classico 2019');
    expect(result.name).toBeUndefined();
  });

  it('does not run OCR when a name is already known from a local barcode hit', async () => {
    await env.DB.prepare(`insert into wines (name, producer, country, type, barcode, source) values ('Barolo DOCG', 'Elio Altare', 'Italia', 'rosso', '1111111111111', 'catalog')`).run();
    const runVisionOcr = async (): Promise<never> => { throw new Error('should not be called'); };
    const result = await buildSuggestion(env, { barcode: '1111111111111', photoBase64: 'data:image/jpeg;base64,AAAA' }, { runVisionOcr } as any);
    expect(result.name).toBe('Barolo DOCG');
  });
```

Note the `as any` on these three `deps` objects: they intentionally omit `lookupBarcode`/`enrichFromWikidata` since those code paths aren't exercised (no `barcode` in the first two, and the third short-circuits on the local DB hit) — using `defaultDeps(env)`'s real Wikidata/Open Food Facts implementations there would hit the real network for nothing.

- [ ] **Step 8: Run it, confirm it passes**

Run: `cd worker && npm test -- recognize.test.ts`
Expected: PASS

- [ ] **Step 9: Run the full suite**

Run: `cd worker && npm test`
Expected: PASS. If `vitest-pool-workers` errors on the new `ai` binding itself (rather than on any test using it — no test in this plan calls `env.AI` directly, every AI-touching test injects a fake `ai`/`runVisionOcr`), that's a real environment gap to investigate and note in the task's completion report, not something to work around by removing the binding from `worker/wrangler.jsonc`.

- [ ] **Step 10: Commit**

```bash
git add worker/src/lib/vision-ocr.ts worker/src/index.ts worker/src/routes/recognize.ts worker/wrangler.jsonc wrangler.jsonc worker/test/vision-ocr.test.ts worker/test/recognize.test.ts
git commit -m "feat: label photo OCR via Cloudflare Workers AI"
```

---

### Task 5: Frontend — review sheet for all three add-a-wine paths

**Files:**
- Modify: `public/index.html`
- Modify: `public/js/screens/add.js`

**Interfaces:**
- Consumes: `POST /api/wines/recognize` (Tasks 2-4), `POST /api/wines` (Task 1's extended body).
- Produces: nothing consumed by later tasks — this is the last task in the plan.

- [ ] **Step 1: Add the review sheet markup**

In `public/index.html`, add this right after the closing `</div>` of `view-add` (i.e. as a sibling of the other `.view` divs, alongside `detail-overlay`/`compare-overlay` near the end of the `.screen` div — put it next to `compare-overlay` for locality):

```html
  <div class="compare-overlay" id="recognize-overlay">
    <div class="compare-sheet">
      <div class="compare-head"><h3>Rivedi e conferma</h3><div class="close" id="recognize-close"><svg viewBox="0 0 24 24" style="width:14px;height:14px;" fill="none" stroke="#241e1a" stroke-width="1.8" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/></svg></div></div>
      <div id="recognize-photo-wrap" style="display:none;"><img id="recognize-photo" alt="" style="width:100%;border-radius:10px;display:block;"></div>
      <div id="recognize-rawtext" class="lang-note" style="display:none;"></div>
      <input id="rec-name" class="search" placeholder="Nome del vino" type="text">
      <input id="rec-producer" class="search" placeholder="Produttore" type="text">
      <input id="rec-country" class="search" placeholder="Paese" type="text">
      <input id="rec-region" class="search" placeholder="Regione (opzionale)" type="text">
      <select id="rec-type" class="search">
        <option value="rosso">Rosso</option>
        <option value="bianco">Bianco</option>
        <option value="bollicine">Bollicine</option>
        <option value="rosato">Rosato</option>
      </select>
      <input id="rec-vintage" class="search" placeholder="Annata (opzionale)" type="number">
      <input id="rec-grape" class="search" placeholder="Vitigno (opzionale)" type="text">
      <input id="rec-denomination" class="search" placeholder="Denominazione (opzionale)" type="text">
      <div class="action" id="recognize-save" style="cursor:pointer;">Salva</div>
    </div>
  </div>
```

Also give the first (currently id-less) scan tile an id so it can be wired up. Find:

```html
      <div class="scan-tile">
        <div class="ic-wrap"><svg class="ic" viewBox="0 0 24 24" style="width:18px;height:18px;"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7l1.8-2.5h4.4L16 7"/><circle cx="12" cy="13.5" r="3.2"/></svg></div>
        <div class="t">Scansiona etichetta</div><div class="s">Riconoscimento foto</div>
      </div>
```

Replace with:

```html
      <div class="scan-tile" id="scan-label-tile">
        <div class="ic-wrap"><svg class="ic" viewBox="0 0 24 24" style="width:18px;height:18px;"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7l1.8-2.5h4.4L16 7"/><circle cx="12" cy="13.5" r="3.2"/></svg></div>
        <div class="t">Scansiona etichetta</div><div class="s">Riconoscimento foto</div>
      </div>
```

- [ ] **Step 2: Replace `runManualAdd` and extend the barcode-miss path in `add.js`**

In `public/js/screens/add.js`, replace the whole `runManualAdd` function and the barcode-scan-result handling, and add the new sheet/camera functions. Replace:

```js
async function runBarcodeScan() {
  if (!('BarcodeDetector' in window)) {
    alert('Scansione barcode non supportata su questo browser, usa la ricerca testuale.');
    return;
  }
  const results = document.getElementById('add-results');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const video = document.createElement('video');
    video.srcObject = stream;
    await video.play();
    const detector = new window.BarcodeDetector();
    const barcodes = await detector.detect(video);
    if (!barcodes.length) {
      alert('Nessun codice a barre rilevato');
      return;
    }
    const wines = await api.get(`/api/wines/search?barcode=${encodeURIComponent(barcodes[0].rawValue)}`);
    if (results) {
      results.innerHTML = wines.length ? wines.map(resultRowHtml).join('') : '<p class="sub">Nessun vino trovato per questo codice</p>';
      wireResults(results);
    }
  } catch (err) {
    console.error(err);
    alert('Impossibile accedere alla fotocamera');
  } finally {
    stream?.getTracks().forEach((t) => t.stop());
  }
}

async function runManualAdd() {
  const name = prompt('Nome del vino');
  if (!name) return;
  const producer = prompt('Produttore') || 'Produttore sconosciuto';
  const country = prompt('Paese', 'Italia') || 'Italia';
  const region = prompt('Regione') || '';
  const type = prompt('Tipo (rosso/bianco/bollicine/rosato)', 'rosso') || 'rosso';
  try {
    const wine = await api.post('/api/wines', { name, producer, country, region, type });
    await addWineToCellar(wine.id);
  } catch (err) {
    console.error(err);
    alert('Impossibile aggiungere il vino: controlla i dati inseriti e riprova.');
  }
}
```

With:

```js
async function runBarcodeScan() {
  if (!('BarcodeDetector' in window)) {
    alert('Scansione barcode non supportata su questo browser, usa la ricerca testuale.');
    return;
  }
  const results = document.getElementById('add-results');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const video = document.createElement('video');
    video.srcObject = stream;
    await video.play();
    const detector = new window.BarcodeDetector();
    const barcodes = await detector.detect(video);
    if (!barcodes.length) {
      alert('Nessun codice a barre rilevato');
      return;
    }
    const wines = await api.get(`/api/wines/search?barcode=${encodeURIComponent(barcodes[0].rawValue)}`);
    if (wines.length) {
      if (results) {
        results.innerHTML = wines.map(resultRowHtml).join('');
        wireResults(results);
      }
      return;
    }
    const suggestion = await api.post('/api/wines/recognize', { barcode: barcodes[0].rawValue });
    openRecognizeSheet(suggestion);
  } catch (err) {
    console.error(err);
    alert('Impossibile accedere alla fotocamera');
  } finally {
    stream?.getTracks().forEach((t) => t.stop());
  }
}

async function runLabelScan() {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const video = document.createElement('video');
    video.srcObject = stream;
    await video.play();
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const photoBase64 = canvas.toDataURL('image/jpeg', 0.7);
    const suggestion = await api.post('/api/wines/recognize', { photoBase64 });
    openRecognizeSheet(suggestion, photoBase64);
  } catch (err) {
    console.error(err);
    alert('Impossibile accedere alla fotocamera');
  } finally {
    stream?.getTracks().forEach((t) => t.stop());
  }
}

let pendingImageUrl;

function openRecognizeSheet(suggestion, capturedPhotoDataUrl) {
  document.getElementById('rec-name').value = suggestion.name ?? '';
  document.getElementById('rec-producer').value = suggestion.producer ?? '';
  document.getElementById('rec-country').value = suggestion.country ?? 'Italia';
  document.getElementById('rec-region').value = suggestion.region ?? '';
  document.getElementById('rec-type').value = suggestion.type ?? 'rosso';
  document.getElementById('rec-vintage').value = suggestion.vintage ?? '';
  document.getElementById('rec-grape').value = suggestion.grapeVariety ?? '';
  document.getElementById('rec-denomination').value = suggestion.denomination ?? '';
  pendingImageUrl = suggestion.imageUrl;

  const photoWrap = document.getElementById('recognize-photo-wrap');
  const photoImg = document.getElementById('recognize-photo');
  const shownPhoto = capturedPhotoDataUrl ?? suggestion.imageUrl;
  if (shownPhoto) {
    photoImg.src = shownPhoto;
    photoWrap.style.display = '';
  } else {
    photoWrap.style.display = 'none';
  }

  const rawTextEl = document.getElementById('recognize-rawtext');
  if (suggestion.rawText) {
    rawTextEl.textContent = "Testo letto dall'etichetta: " + suggestion.rawText;
    rawTextEl.style.display = '';
  } else {
    rawTextEl.style.display = 'none';
  }

  document.getElementById('recognize-overlay').classList.add('open');
}

function closeRecognizeSheet() {
  document.getElementById('recognize-overlay').classList.remove('open');
}

async function saveRecognizedWine() {
  const name = document.getElementById('rec-name').value.trim();
  if (!name) {
    alert('Il nome del vino è obbligatorio');
    return;
  }
  const producer = document.getElementById('rec-producer').value.trim() || 'Produttore sconosciuto';
  const country = document.getElementById('rec-country').value.trim() || 'Italia';
  const region = document.getElementById('rec-region').value.trim() || undefined;
  const type = document.getElementById('rec-type').value;
  const vintageRaw = document.getElementById('rec-vintage').value.trim();
  const vintage = vintageRaw ? Number(vintageRaw) : undefined;
  const grapeVariety = document.getElementById('rec-grape').value.trim() || undefined;
  const denomination = document.getElementById('rec-denomination').value.trim() || undefined;

  try {
    const wine = await api.post('/api/wines', { name, producer, country, region, type, vintage, grapeVariety, denomination, imageUrl: pendingImageUrl });
    closeRecognizeSheet();
    await addWineToCellar(wine.id);
  } catch (err) {
    console.error(err);
    alert('Impossibile aggiungere il vino: controlla i dati inseriti e riprova.');
  }
}
```

- [ ] **Step 3: Rewire the static listeners**

Replace:

```js
document.getElementById('add-search-input')?.addEventListener('input', (e) => runSearch(e.target.value.trim()));
document.getElementById('scan-barcode-tile')?.addEventListener('click', runBarcodeScan);
document.getElementById('manual-add-link')?.addEventListener('click', runManualAdd);
```

With:

```js
document.getElementById('add-search-input')?.addEventListener('input', (e) => runSearch(e.target.value.trim()));
document.getElementById('scan-barcode-tile')?.addEventListener('click', runBarcodeScan);
document.getElementById('scan-label-tile')?.addEventListener('click', runLabelScan);
document.getElementById('manual-add-link')?.addEventListener('click', () => openRecognizeSheet({}));
document.getElementById('recognize-close')?.addEventListener('click', closeRecognizeSheet);
document.getElementById('recognize-save')?.addEventListener('click', saveRecognizedWine);
```

- [ ] **Step 4: Manual verification**

This repo has no automated frontend test harness — verify live instead:

Run: `npx wrangler dev --var CALICE_DEV_EMAIL:you@example.com` (from the repo root, using the merged root `wrangler.jsonc`)

In a browser at the printed local URL:
1. Go to Aggiungi → "Aggiungilo manualmente" → sheet opens blank → fill in a name → Salva → confirm it lands in the cantina.
2. "Scansiona etichetta" → grant camera permission → point at any label-like text (or deny permission and confirm the alert fires cleanly, camera stream released, no console error loop) → if permission granted, confirm the sheet opens (fields may be empty or partially filled depending on what Workers AI reads — this is expected, not a bug, per the spec's best-effort contract) → edit → Salva.
3. Scan a barcode that has no local match (e.g. a random EAN) → confirm the sheet opens instead of a dead "nessun vino trovato" — either pre-filled from Open Food Facts or blank with the barcode set → Salva.
4. Scan a barcode that already exists in the local catalog (from a wine saved in step 1 or 3, if it had a barcode) → confirm the existing local-hit result list still appears, unchanged from before this plan.

Note any deviation (Workers AI not enabled on the account, wrong model id, Wikidata property ids not resolving as expected) in the task's completion report — these are exactly the kind of account-specific gaps this plan flagged as "confirm at implementation time," not blockers to fix silently.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/js/screens/add.js
git commit -m "feat: review sheet for label scan, barcode-miss fallback, and manual add"
```
