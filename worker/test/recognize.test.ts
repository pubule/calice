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

  it('keeps the barcode and returns an otherwise-empty suggestion when neither Open Food Facts nor Tavily find anything', async () => {
    const lookupBarcode = async (): Promise<OffSuggestion | null> => null;
    const searchWine = async () => null;
    const enrichFromWikidata = async (): Promise<never> => { throw new Error('should not be called'); };
    const runVisionOcr = async (): Promise<never> => { throw new Error('should not be called'); };
    const result = await buildSuggestion(env, { barcode: '0000000000000' }, { lookupBarcode, searchWine, enrichFromWikidata, runVisionOcr });
    expect(result).toEqual({ barcode: '0000000000000' });
  });

  it('falls back to a Tavily search on the barcode itself when Open Food Facts finds nothing, and logs the credit spent', async () => {
    await env.DB.exec('DELETE FROM tavily_usage;');
    const candidates = [
      { title: 'Barolo DOCG 8001234500099 - Wine Searcher', snippet: 'Rosso piemontese.', sourceUrl: 'https://wine-searcher.com/p/1', imageUrl: 'https://x/barolo.jpg' },
    ];
    const lookupBarcode = async (): Promise<OffSuggestion | null> => null;
    const searchWine = async (query: string) => {
      expect(query).toBe('8001234500099');
      return { candidates, creditsUsed: 1 };
    };
    const enrichFromWikidata = async (): Promise<never> => { throw new Error('should not be called'); };
    const runVisionOcr = async (): Promise<never> => { throw new Error('should not be called'); };
    const result = await buildSuggestion(env, { barcode: '8001234500099' }, { lookupBarcode, searchWine, enrichFromWikidata, runVisionOcr });
    expect(result).toEqual({ barcode: '8001234500099', candidates });
    // A barcode number is never trusted as the wine's name — only the
    // candidates come back, same as the text-search fallback.
    expect(result.name).toBeUndefined();

    const usage = await env.DB.prepare('select credits from tavily_usage').first<{ credits: number }>();
    expect(usage?.credits).toBe(1);
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

  it('does not run OCR when a name is already known from a local barcode hit', async () => {
    await env.DB.prepare(`insert into wines (name, producer, country, type, barcode, source) values ('Barolo DOCG', 'Elio Altare', 'Italia', 'rosso', '1111111111111', 'catalog')`).run();
    const runVisionOcr = async (): Promise<never> => { throw new Error('should not be called'); };
    const result = await buildSuggestion(env, { barcode: '1111111111111', photoBase64: 'data:image/jpeg;base64,AAAA' }, { runVisionOcr } as any);
    expect(result.name).toBe('Barolo DOCG');
  });

  it('trusts a text-search query as the name, exposes Tavily candidates, and logs the credit spent', async () => {
    await env.DB.exec('DELETE FROM tavily_usage;');
    const candidates = [
      { title: 'Zamuner | Sito ufficiale', snippet: 'Cantina Zamuner.', sourceUrl: 'https://www.zamuner.it', imageUrl: 'https://zamuner.it/bottiglia.jpg' },
      { title: 'Zamuner - Vivino', snippet: 'Bollicine venete.', sourceUrl: 'https://vivino.com/zamuner', imageUrl: 'https://images.vivino.com/zamuner.jpg' },
    ];
    const searchWine = async (query: string) => {
      expect(query).toBe('Bardolino Chiaretto');
      return { candidates, creditsUsed: 2 };
    };
    const enrichFromWikidata = async () => null;
    const result = await buildSuggestion(env, { query: 'Bardolino Chiaretto' }, { searchWine, enrichFromWikidata } as any);
    expect(result.name).toBe('Bardolino Chiaretto');
    expect(result.candidates).toEqual(candidates);
    // Nothing is auto-picked onto the top-level suggestion — the frontend
    // decides once the user taps a candidate.
    expect(result.imageUrl).toBeUndefined();

    const usage = await env.DB.prepare('select credits from tavily_usage').first<{ credits: number }>();
    expect(usage?.credits).toBe(2);
  });

  it('keeps just the name when Tavily finds no candidates for the query', async () => {
    const searchWine = async () => ({ candidates: [], creditsUsed: 1 });
    const enrichFromWikidata = async () => null;
    const result = await buildSuggestion(env, { query: 'Vino Sconosciuto Rarissimo' }, { searchWine, enrichFromWikidata } as any);
    expect(result.name).toBe('Vino Sconosciuto Rarissimo');
    expect(result.candidates).toBeUndefined();
  });

  it('keeps just the name when Tavily fails outright', async () => {
    const searchWine = async () => null;
    const enrichFromWikidata = async () => null;
    const result = await buildSuggestion(env, { query: 'Vino Sconosciuto Rarissimo' }, { searchWine, enrichFromWikidata } as any);
    expect(result).toEqual({ name: 'Vino Sconosciuto Rarissimo' });
  });

  it('never calls Tavily when a name is already known from a barcode hit', async () => {
    await env.DB.prepare(`insert into wines (name, producer, country, type, barcode, source) values ('Barolo DOCG', 'Elio Altare', 'Italia', 'rosso', '2222222222222', 'catalog')`).run();
    const searchWine = async (): Promise<never> => { throw new Error('should not be called'); };
    const result = await buildSuggestion(env, { barcode: '2222222222222', query: 'irrelevant' }, { searchWine } as any);
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
