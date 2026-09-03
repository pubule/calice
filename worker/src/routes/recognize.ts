import { Hono } from 'hono';
import { requireAuth } from '../lib/session';
import { lookupBarcode as defaultLookupBarcode } from '../lib/open-food-facts';
import { enrichFromWikidata as defaultEnrichFromWikidata } from '../lib/wikidata';
import { runVisionOcr as defaultRunVisionOcr } from '../lib/vision-ocr';
import { searchWine as defaultSearchWine } from '../lib/tavily-search';
import type { Env } from '../index';

export type WineCandidate = { title?: string; snippet?: string; sourceUrl?: string; imageUrl?: string };

export type Suggestion = {
  name?: string; producer?: string; country?: string; region?: string;
  type?: string; vintage?: number; barcode?: string;
  grapeVariety?: string; denomination?: string;
  imageUrl?: string; rawText?: string; sourceUrl?: string;
  candidates?: WineCandidate[];
};

export type RecognizeDeps = {
  lookupBarcode: typeof defaultLookupBarcode;
  enrichFromWikidata: typeof defaultEnrichFromWikidata;
  runVisionOcr: (photoBase64: string) => ReturnType<typeof defaultRunVisionOcr>;
  searchWine: (query: string) => ReturnType<typeof defaultSearchWine>;
};

function defaultDeps(env: Env): RecognizeDeps {
  return {
    lookupBarcode: defaultLookupBarcode,
    enrichFromWikidata: defaultEnrichFromWikidata,
    runVisionOcr: (photoBase64) => defaultRunVisionOcr(env.AI, photoBase64),
    searchWine: (query) => defaultSearchWine(query, env.TAVILY_API_KEY),
  };
}

type WineRow = {
  name: string; producer: string; country: string; region: string | null; type: string; vintage: number | null;
  barcode: string | null; grape_variety: string | null; denomination: string | null; image_url: string | null;
};

// Best-effort usage logging for the monthly-quota warning (cron.ts) — never
// let a logging failure take down the actual suggestion.
async function logTavilyUsage(env: Env, credits: number | undefined) {
  if (!credits) return;
  try {
    await env.DB.prepare('insert into tavily_usage (credits) values (?)').bind(credits).run();
  } catch (err) {
    console.error('failed to log tavily usage', err);
  }
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

    // Open Food Facts barely covers wine — when it comes up empty, try a web
    // search on the barcode itself. Many retailer/wine-database pages index
    // products by EAN, so a bare barcode number is often a real, working
    // query. Never auto-fills name (a barcode number is not a wine name) —
    // same candidates-not-a-guess pattern as the text-search fallback below.
    if (!suggestion.name) {
      const web = await deps.searchWine(body.barcode);
      if (web?.candidates.length) suggestion.candidates = web.candidates;
      await logTavilyUsage(env, web?.creditsUsed);
    }
  }

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

  // Text search miss: the user already typed a real name, so trust it as-is
  // (no OCR/barcode noise to second-guess) and ask Tavily for what we can't
  // invent — real candidate photos/snippets. A specific product query often
  // ranks a retailer's page above the producer's own site, so this doesn't
  // guess which one is "right" — it hands back a few and the frontend lets
  // the user pick, same review-before-save principle as everywhere else.
  if (body.query && !suggestion.name) {
    suggestion.name = body.query;
    const web = await deps.searchWine(body.query);
    if (web?.candidates.length) suggestion.candidates = web.candidates;
    await logTavilyUsage(env, web?.creditsUsed);
  }

  if (suggestion.name && !suggestion.grapeVariety) {
    const wd = await deps.enrichFromWikidata(suggestion.name, suggestion.producer);
    if (wd?.grapeVariety) suggestion.grapeVariety = wd.grapeVariety;
  }

  return suggestion;
}

export const recognizeRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
recognizeRoutes.use('*', requireAuth);

recognizeRoutes.post('/', async (c) => {
  const body = await c.req.json<{ barcode?: string; photoBase64?: string; query?: string }>();
  if (!body.barcode && !body.photoBase64 && !body.query) return c.json({ error: 'barcode, photoBase64, or query required' }, 400);
  const suggestion = await buildSuggestion(c.env, body);
  return c.json(suggestion);
});
