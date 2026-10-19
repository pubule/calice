import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../src/index';
import { buildSuggestion, OCR_DAILY_LIMIT } from '../src/routes/recognize';
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
    const enrichFromWikidata = async (): Promise<never> => { throw new Error('should not be called'); };
    const runVisionOcr = async (): Promise<never> => { throw new Error('should not be called'); };
    const result = await buildSuggestion(env, { barcode: '8001234500019' }, { lookupBarcode, enrichFromWikidata, runVisionOcr });
    expect(result).toEqual({
      name: 'Barolo DOCG', producer: 'Elio Altare', country: 'Italia', region: undefined, type: 'rosso',
      vintage: undefined, barcode: '8001234500019', grapeVariety: 'Nebbiolo', denomination: 'Barolo DOCG', imageUrl: 'https://x/img.jpg',
    });
  });

  it('falls back to Open Food Facts on a local miss and maps its fields', async () => {
    const lookupBarcode = async (): Promise<OffSuggestion | null> => ({ name: 'Chianti Classico', producer: 'Antinori', country: 'Italia', imageUrl: 'https://x/img.jpg' });
    const enrichFromWikidata = async () => null;
    const runVisionOcr = async (): Promise<never> => { throw new Error('should not be called'); };
    const result = await buildSuggestion(env, { barcode: '1234567890123' }, { lookupBarcode, enrichFromWikidata, runVisionOcr });
    expect(result).toEqual({ barcode: '1234567890123', name: 'Chianti Classico', producer: 'Antinori', country: 'Italia', imageUrl: 'https://x/img.jpg' });
  });

  it('keeps the barcode and returns an otherwise-empty suggestion when Open Food Facts finds nothing', async () => {
    const lookupBarcode = async (): Promise<OffSuggestion | null> => null;
    const enrichFromWikidata = async (): Promise<never> => { throw new Error('should not be called'); };
    const runVisionOcr = async (): Promise<never> => { throw new Error('should not be called'); };
    const result = await buildSuggestion(env, { barcode: '0000000000000' }, { lookupBarcode, enrichFromWikidata, runVisionOcr });
    expect(result).toEqual({ barcode: '0000000000000' });
  });

  it('returns an empty suggestion when called with neither barcode nor photo', async () => {
    const result = await buildSuggestion(env, {});
    expect(result).toEqual({});
  });

  it('enriches with grape variety once a name is known from Open Food Facts', async () => {
    const lookupBarcode = async () => ({ name: 'Barolo DOCG', producer: 'Elio Altare' });
    const enrichFromWikidata = async (name: string, producer?: string) => {
      expect(name).toBe('Barolo DOCG');
      expect(producer).toBe('Elio Altare');
      return { grapeVariety: 'Nebbiolo' };
    };
    const runVisionOcr = async (): Promise<never> => { throw new Error('should not be called'); };
    const result = await buildSuggestion(env, { barcode: '9999999999999' }, { lookupBarcode, enrichFromWikidata, runVisionOcr });
    expect(result.grapeVariety).toBe('Nebbiolo');
  });

  it('skips Wikidata entirely when no name is known yet', async () => {
    const lookupBarcode = async () => null;
    const searchWine = async () => null;
    const enrichFromWikidata = async (): Promise<never> => { throw new Error('should not be called'); };
    const runVisionOcr = async (): Promise<never> => { throw new Error('should not be called'); };
    const result = await buildSuggestion(env, { barcode: '9999999999998' }, { lookupBarcode, searchWine, enrichFromWikidata, runVisionOcr });
    expect(result).toEqual({ barcode: '9999999999998' });
  });

  it('runs OCR on a photo when no barcode/local name is known, and fills the suggestion from it', async () => {
    const runVisionOcr = async (photoBase64: string) => {
      expect(photoBase64).toBe('data:image/jpeg;base64,AAAA');
      return { parsed: { name: 'Chianti Classico', producer: 'Antinori', vintage: 2019, denomination: 'Chianti Classico DOCG' } };
    };
    // OCR fills suggestion.name, which then triggers the Wikidata enrichment
    // step (suggestion.name && !suggestion.grapeVariety) — stub it out so it
    // doesn't hit the real network.
    const enrichFromWikidata = async () => null;
    const result = await buildSuggestion(env, { photoBase64: 'data:image/jpeg;base64,AAAA' }, { runVisionOcr, enrichFromWikidata } as any);
    expect(result.name).toBe('Chianti Classico');
    expect(result.vintage).toBe(2019);
  });

  it('surfaces rawText when OCR could not produce structured JSON', async () => {
    const runVisionOcr = async () => ({ rawText: 'Chianti Classico 2019' });
    const result = await buildSuggestion(env, { photoBase64: 'data:image/jpeg;base64,AAAA' }, { runVisionOcr } as any);
    expect(result.rawText).toBe('Chianti Classico 2019');
    expect(result.name).toBeUndefined();
  });

  it('trusts a text-search query as the name and exposes Vivino candidates', async () => {
    const vivino = [{ title: 'Ambrosini Franciacorta Batudè Brut', sourceUrl: 'https://www.vivino.com/IT/it/ambrosini-franciacorta-batude-brut/w/2667819' }];
    const searchVivino = async (query: string) => { expect(query).toBe('ambrosini batud'); return vivino; };
    const enrichFromWikidata = async () => null;
    const result = await buildSuggestion(env, { query: 'ambrosini batud' }, { searchVivino, enrichFromWikidata } as any);
    expect(result.name).toBe('ambrosini batud');
    expect(result.candidates).toEqual(vivino);
    expect(result.imageUrl).toBeUndefined();
  });

  it('keeps just the typed name when Vivino fails or finds nothing', async () => {
    const enrichFromWikidata = async () => null;
    for (const searchVivino of [async () => null, async () => []]) {
      const result = await buildSuggestion(env, { query: 'Vino Sconosciuto Rarissimo' }, { searchVivino, enrichFromWikidata } as any);
      expect(result).toEqual({ name: 'Vino Sconosciuto Rarissimo' });
    }
  });

  it('answers the same name search again from the shared cache, without Vivino', async () => {
    await env.DB.exec('DELETE FROM search_cache;');
    const vivino = [{ title: 'Masi Campofiorin', sourceUrl: 'https://www.vivino.com/w/1' }];
    let calls = 0;
    const searchVivino = async () => { calls++; return vivino; };
    const enrichFromWikidata = async () => ({ grapeVariety: 'Corvina' });
    await buildSuggestion(env, { query: 'Campofiorin' }, { searchVivino, enrichFromWikidata } as any);
    const again = await buildSuggestion(env, { query: 'campofiorìn ' }, { searchVivino, enrichFromWikidata } as any);
    expect(calls).toBe(1);
    expect(again).toEqual({ name: 'campofiorìn ', candidates: vivino, grapeVariety: 'Corvina' });
    // A miss is not remembered: asked again next time.
    const none = async () => { calls++; return null; };
    await buildSuggestion(env, { query: 'introvabile' }, { searchVivino: none, enrichFromWikidata } as any);
    await buildSuggestion(env, { query: 'introvabile' }, { searchVivino: none, enrichFromWikidata } as any);
    expect(calls).toBe(3);
  });

  it('reads at most OCR_DAILY_LIMIT label photos a day, then asks to fill in by hand', async () => {
    await env.DB.exec('DELETE FROM ai_usage;');
    let calls = 0;
    const runVisionOcr = async () => { calls++; return { rawText: 'x' }; };
    for (let i = 0; i < OCR_DAILY_LIMIT; i++) {
      const r = await buildSuggestion(env, { photoBase64: 'data:image/jpeg;base64,AAAA' }, { runVisionOcr } as any);
      expect(r.ocrLimited).toBeUndefined();
    }
    const over = await buildSuggestion(env, { photoBase64: 'data:image/jpeg;base64,AAAA' }, { runVisionOcr } as any);
    expect(over).toEqual({ ocrLimited: true });
    expect(calls).toBe(OCR_DAILY_LIMIT);
    // Yesterday's count doesn't block today.
    await env.DB.exec(`UPDATE ai_usage SET day = date('now', '-1 day');`);
    const next = await buildSuggestion(env, { photoBase64: 'data:image/jpeg;base64,AAAA' }, { runVisionOcr } as any);
    expect(next.ocrLimited).toBeUndefined();
  });

  it('does not run OCR when a name is already known from a local barcode hit', async () => {
    await env.DB.prepare(`insert into wines (name, producer, country, type, barcode, source) values ('Barolo DOCG', 'Elio Altare', 'Italia', 'rosso', '1111111111111', 'catalog')`).run();
    const runVisionOcr = async (): Promise<never> => { throw new Error('should not be called'); };
    const result = await buildSuggestion(env, { barcode: '1111111111111', photoBase64: 'data:image/jpeg;base64,AAAA' }, { runVisionOcr } as any);
    expect(result.name).toBe('Barolo DOCG');
  });

});

describe('POST /api/wines/recognize', () => {
  it('requires barcode, photoBase64, or query', async () => {
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

  it('returns 200 with the local wine when the barcode is a catalog hit', async () => {
    await env.DB
      .prepare(`insert into wines (name, producer, country, type, barcode, source) values ('Barolo DOCG', 'Elio Altare', 'Italia', 'rosso', '8001234500019', 'catalog')`)
      .run();
    const res = await app.request(
      '/api/wines/recognize',
      { method: 'POST', body: JSON.stringify({ barcode: '8001234500019' }), headers: { 'X-Calice-Dev-Email': 'rec2@b.com', 'content-type': 'application/json' } },
      env,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Barolo DOCG');
  });
});
