# Wine Recognition (Photo/Barcode) — Design

## Context

Calice's "Aggiungi vino" screen has three ways to find a wine: text search, barcode scan, and manual entry. All three only ever look at Calice's own `wines` table. Barcode scan and the "Scansiona etichetta" (label photo) tile were both drawn in the original mockup, but only barcode scan actually works — and on a miss it just says "nessun vino trovato" and stops. The label-photo tile has never had a click handler. Manual entry is a chain of `prompt()` dialogs.

This reverses one explicit decision from the original spec (`2026-09-01-calice-wine-cellar-design.md`): "no live external wine API, no fabricated web reviews." That decision was about *tasting-note/review/price data* — protecting against fake opinions and prices. This feature is different in kind: it's catalog *identification* (name/producer/region), sourced from a real product database (Open Food Facts) and a real structured-data project (Wikidata), always shown to a human for confirmation before anything is saved. The "no fake data" spirit is kept: nothing here is invented, and nothing saves itself.

## Goal

Scan a barcode or photograph a label; get a pre-filled, editable form instead of a dead end or a chain of `prompt()`s. Every wine still gets added through the existing `POST /api/wines`, unchanged — this feature only gets better data into that form before the user confirms it.

## Architecture

```
Foto etichetta ──▶ Workers AI (vision, JSON diretto) ──┐
Barcode scan   ──▶ ricerca locale (già esiste)          ├──▶ form di revisione ──▶ utente conferma ──▶ POST /api/wines (già esiste)
                     │ miss                              │                                              │
                     ▼                                   │                                          cresce il catalogo
                Open Food Facts (fallback) ──────────────┤                                          condiviso (già così oggi)
                                                           │
Nome/produttore estratto ──▶ Wikidata (best-effort) ─────┘  arricchisce vitigno/denominazione, mai blocca il flusso
```

One new endpoint, `POST /api/wines/recognize`, orchestrates every external call server-side: no CORS from the browser, no keys exposed (none needed — all three sources are free/unauthenticated for read), Workers AI is only reachable from the Worker anyway. It never saves anything on its own — it returns a suggestion object; saving is still always the existing `POST /api/wines`, with a human in between.

## Data

`wines` has no columns for grape variety, appellation, or a label image today. New migration:

```sql
ALTER TABLE wines ADD COLUMN grape_variety TEXT;   -- e.g. "Nebbiolo"
ALTER TABLE wines ADD COLUMN denomination TEXT;    -- e.g. "Barolo DOCG"
ALTER TABLE wines ADD COLUMN image_url TEXT;       -- label image from Open Food Facts, if any
```

All nullable — a hand-entered wine stays valid without them. `source` stays `'custom'` for anything saved through this flow: it's still a user-confirmed entry, just pre-filled instead of hand-typed. The existing `barcode` column already makes any wine saved with one searchable by every future user — this feature doesn't need a new mechanism for "the catalog grows over time," it already has one.

## Cloudflare Workers AI binding

New requirement: an `ai` binding in `wrangler.jsonc` (`"ai": { "binding": "AI" }`), a vision-capable model (e.g. `@cf/llava-hf/llava-1.5-7b-hf` or the current equivalent available on the account at implementation time — confirm exact model id against Workers AI's catalog then, since it moves). Like R2, Workers AI may or may not be enabled on this account already — verify at implementation time and treat "not enabled" the same way R2's absence was handled (documented gap, feature degrades to a blank form, not a deploy blocker).

## API

```
POST /api/wines/recognize
Body: { barcode?: string, photoBase64?: string }   -- at least one required, 400 otherwise
Auth: requireAuth (same as every other route)
```

Steps, in order, each **best-effort** — a failure at any step is caught and ignored, never surfaces as a 500:

1. `barcode` given: query local `wines` by barcode (same SQL as `GET /search?barcode=`). A hit returns immediately — nothing external is called.
2. `barcode` given and local miss: `GET https://world.openfoodfacts.org/api/v2/product/{barcode}`, ~8s `AbortController` timeout. Map `product_name`→name, `brands`→producer, `countries`→country, `image_url`→image_url.
3. `photoBase64` given: one Workers AI vision call. Prompt asks directly for JSON: `{name, producer, vintage, denomination}`. Parse defensively — `JSON.parse` wrapped in try/catch; on failure, the model's raw text response is returned as `rawText` instead (never thrown away, never blocks the response).
4. If a `name` is known at this point (from barcode/OFF/OCR): best-effort Wikidata lookup (`wbsearchentities` + a follow-up entity fetch, both free/unauthenticated) to fill `grape_variety`/`denomination` if still missing. Silent no-op if no confident match.

Response shape — the same fields `POST /api/wines` accepts, plus optional `rawText` and `imageUrl`:

```ts
{
  name?: string; producer?: string; country?: string; region?: string;
  type?: string; vintage?: number; barcode?: string;
  grapeVariety?: string; denomination?: string;
  imageUrl?: string; rawText?: string;
}
```

Every field is optional; an empty `{}` (every source failed or found nothing) is a valid 200 response — the frontend just opens a blank form, identical to today's manual-add.

## Frontend — one review sheet, three entry points

Replaces `runManualAdd()`'s `prompt()` chain entirely with a single bottom sheet (same slide-up pattern as the existing `.detail-sheet`/`.compare-sheet`), with editable fields: name, producer, country, region, type, vintage, grape variety, denomination. Three ways to open it, same sheet:

1. **"Scansiona etichetta"** (dead tile today, no listener) → opens the camera (same `getUserMedia` pattern the working barcode scan already uses) → captures one frame → `canvas.toDataURL('image/jpeg', 0.7)` → `POST /api/wines/recognize {photoBase64}` → sheet opens pre-filled. If the model didn't return valid JSON, `rawText` is shown above the form so the user can copy from it by hand.
2. **Barcode scan, local miss** (today: "nessun vino trovato", dead end) → calls `/recognize {barcode}` instead → sheet opens, pre-filled from Open Food Facts if it had a match, otherwise blank with the barcode already set.
3. **"Aggiungilo manualmente"** → same sheet, blank.

In every case: user edits, taps "Salva" → existing `POST /api/wines` (already accepts every field this adds) → `addWineToCellar`. Never an automatic save, never a dead end (total failure across every source = blank form, same as manual-add today).

## Error handling

Every external call (Open Food Facts, Wikidata, Workers AI) is isolated in its own try/catch with a short timeout. One slow or down source never blocks the others or fails the request. If **everything** fails — including Workers AI not being enabled on the account, the same kind of surprise R2 was — `/recognize` still returns 200 with an empty object; the sheet still opens, just blank. Never a 500 for an external dependency being unavailable.

## Testing

- `worker/test/wines-recognize.test.ts`: local-barcode-hit short-circuits (no external calls — inject fetch/AI mocks that would fail the test if called), Open Food Facts mapping (mock fetch), malformed-JSON OCR response falls back to `rawText`, every-source-fails still returns 200 `{}`, auth required (401 with no identity).
- Frontend: manual check in a real browser per this project's existing UI-testing practice (no headless test harness for `public/js/` today) — golden path for all three entry points, plus the camera-permission-denied and Workers-AI-disabled degraded paths.

## Out of scope

Auto-save on high confidence (explicitly decided against — always human-confirmed). Editing/removing the `grape_variety`/`denomination` fields from existing wines already in the catalog (only new saves get them). Any UI for browsing/searching by grape variety or denomination (columns exist for display and future use, not wired into search/filters yet). Multi-photo capture or retake-before-submit UX polish — one frame, one call, same as the existing barcode scanner's UX today.
