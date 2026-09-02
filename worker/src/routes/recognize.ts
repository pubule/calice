import { Hono } from 'hono';
import { requireAuth } from '../lib/session';
import { lookupBarcode as defaultLookupBarcode } from '../lib/open-food-facts';
import { enrichFromWikidata as defaultEnrichFromWikidata } from '../lib/wikidata';
import { runVisionOcr as defaultRunVisionOcr } from '../lib/vision-ocr';
import type { Env } from '../index';

export type Suggestion = {
  name?: string; producer?: string; country?: string; region?: string;
  type?: string; vintage?: number; barcode?: string;
  grapeVariety?: string; denomination?: string;
  imageUrl?: string; rawText?: string;
};

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

type WineRow = {
  name: string; producer: string; country: string; region: string | null; type: string; vintage: number | null;
  barcode: string | null; grape_variety: string | null; denomination: string | null; image_url: string | null;
};

export async function buildSuggestion(
  env: Env,
  body: { barcode?: string; photoBase64?: string },
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

  if (suggestion.name && !suggestion.grapeVariety) {
    const wd = await deps.enrichFromWikidata(suggestion.name, suggestion.producer);
    if (wd?.grapeVariety) suggestion.grapeVariety = wd.grapeVariety;
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
