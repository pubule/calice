import { Hono } from 'hono';
import { requireAuth } from '../lib/session';
import { lookupBarcode as defaultLookupBarcode } from '../lib/open-food-facts';
import { enrichFromWikidata as defaultEnrichFromWikidata } from '../lib/wikidata';
import { runVisionOcr as defaultRunVisionOcr } from '../lib/vision-ocr';
import { searchVivino as defaultSearchVivino, queryVivino } from '../lib/vivino-search';
import { findProducerImages } from '../lib/producer-site';
import type { Env } from '../index';

export type { WineCandidate } from '../lib/vivino-search';
import type { WineCandidate } from '../lib/vivino-search';

export type Suggestion = {
  name?: string; producer?: string; country?: string; region?: string;
  type?: string; vintage?: number; barcode?: string;
  grapeVariety?: string; denomination?: string;
  imageUrl?: string; rawText?: string; sourceUrl?: string;
  candidates?: WineCandidate[];
  ocrLimited?: boolean;
};

export type RecognizeDeps = {
  lookupBarcode: typeof defaultLookupBarcode;
  enrichFromWikidata: typeof defaultEnrichFromWikidata;
  runVisionOcr: (photoBase64: string) => ReturnType<typeof defaultRunVisionOcr>;
  // Optional so callers (and tests) that only exercise other paths can omit it.
  searchVivino?: (query: string) => ReturnType<typeof defaultSearchVivino>;
};

function defaultDeps(env: Env): RecognizeDeps {
  return {
    lookupBarcode: defaultLookupBarcode,
    enrichFromWikidata: defaultEnrichFromWikidata,
    runVisionOcr: (photoBase64) => defaultRunVisionOcr(env.AI, photoBase64),
    searchVivino: (query) => defaultSearchVivino(query),
  };
}

type WineRow = {
  name: string; producer: string; country: string; region: string | null; type: string; vintage: number | null;
  barcode: string | null; grape_variety: string | null; denomination: string | null; image_url: string | null;
};

// Label reading runs on Workers AI, free up to a daily allocation (10,000
// "neurons"; Cloudflare bills beyond it only on a paid plan). The app stops
// well before: at most OCR_DAILY_LIMIT label photos a day (UTC), counted in
// ai_usage. Over the cap the photo is simply not read and the sheet opens to
// be filled by hand (suggestion.ocrLimited). The user asked for "never pay".
export const OCR_DAILY_LIMIT = 50;

async function takeOcrSlot(env: Env): Promise<boolean> {
  const row = await env.DB
    .prepare(`insert into ai_usage (day, calls) values (date('now'), 1)
              on conflict(day) do update set calls = calls + 1
              where calls < ? returning calls`)
    .bind(OCR_DAILY_LIMIT)
    .first<{ calls: number }>();
  return row != null;
}

export async function buildSuggestion(
  env: Env,
  body: { barcode?: string; photoBase64?: string; query?: string },
  deps: RecognizeDeps = defaultDeps(env),
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

    // Open Food Facts barely covers wine; when it misses, the sheet opens with
    // just the barcode attached, to be filled by hand (there used to be a paid
    // web search here, removed so the app never risks a bill).
  }

  if (body.photoBase64 && !suggestion.name) {
    if (!(await takeOcrSlot(env))) return { ...suggestion, ocrLimited: true };
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

  // Text search miss: the user already typed a real name, so trust it as-is
  // and ask Vivino's own search (vivino-search.ts) for real candidates with
  // their photos; the frontend lets the user pick. When Vivino fails or finds
  // nothing, just the typed name comes back.
  if (body.query && !suggestion.name) {
    suggestion.name = body.query;
    const vivino = await deps.searchVivino?.(body.query);
    if (vivino?.length) suggestion.candidates = vivino;
  }

  if (suggestion.name && !suggestion.grapeVariety) {
    const wd = await deps.enrichFromWikidata(suggestion.name, suggestion.producer);
    if (wd?.grapeVariety) suggestion.grapeVariety = wd.grapeVariety;
  }

  return suggestion;
}

export const recognizeRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
recognizeRoutes.use('*', requireAuth);

// Reports what the Vivino search actually receives from the deployed Worker
// (status, hit count, field names, mapped candidates) — it is an unofficial
// endpoint that can't be exercised from the dev sandbox.
recognizeRoutes.get('/debug', async (c) => {
  const q = c.req.query('q')?.trim();
  if (!q) return c.json({ error: 'q required' }, 400);
  return c.json(await queryVivino(q));
});

// Diagnostic for the "photo from the producer's site" idea: what the Worker
// finds on a winery site for one wine (pages that match its name, images on
// them). Read-only; nothing is saved. Example:
// /api/wines/recognize/producer?site=https://www.zamuner.it&wine=Blanc%20de%20Noirs%20Brut&producer=Zamuner
recognizeRoutes.get('/producer', async (c) => {
  const site = c.req.query('site')?.trim();
  const wine = c.req.query('wine')?.trim();
  if (!site || !wine) return c.json({ error: 'site and wine required' }, 400);
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(site) ? site : `https://${site}`);
  } catch {
    return c.json({ error: 'site must be a web address' }, 400);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return c.json({ error: 'site must be http(s)' }, 400);
  return c.json(await findProducerImages(url.toString(), wine, c.req.query('producer')?.trim()));
});

recognizeRoutes.post('/', async (c) => {
  const body = await c.req.json<{ barcode?: string; photoBase64?: string; query?: string }>();
  if (!body.barcode && !body.photoBase64 && !body.query) return c.json({ error: 'barcode, photoBase64, or query required' }, 400);
  const suggestion = await buildSuggestion(c.env, body);
  return c.json(suggestion);
});
