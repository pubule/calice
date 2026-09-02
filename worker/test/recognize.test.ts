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
    const result = await buildSuggestion(env, { barcode: '8001234500019' }, { lookupBarcode, enrichFromWikidata });
    expect(result).toEqual({
      name: 'Barolo DOCG', producer: 'Elio Altare', country: 'Italia', region: undefined, type: 'rosso',
      vintage: undefined, barcode: '8001234500019', grapeVariety: 'Nebbiolo', denomination: 'Barolo DOCG', imageUrl: 'https://x/img.jpg',
    });
  });

  it('falls back to Open Food Facts on a local miss and maps its fields', async () => {
    const lookupBarcode = async (): Promise<OffSuggestion | null> => ({ name: 'Chianti Classico', producer: 'Antinori', country: 'Italia', imageUrl: 'https://x/img.jpg' });
    const enrichFromWikidata = async () => null;
    const result = await buildSuggestion(env, { barcode: '1234567890123' }, { lookupBarcode, enrichFromWikidata });
    expect(result).toEqual({ barcode: '1234567890123', name: 'Chianti Classico', producer: 'Antinori', country: 'Italia', imageUrl: 'https://x/img.jpg' });
  });

  it('keeps the barcode and returns an otherwise-empty suggestion when Open Food Facts finds nothing', async () => {
    const lookupBarcode = async (): Promise<OffSuggestion | null> => null;
    const enrichFromWikidata = async (): Promise<never> => { throw new Error('should not be called'); };
    const result = await buildSuggestion(env, { barcode: '0000000000000' }, { lookupBarcode, enrichFromWikidata });
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
    const result = await buildSuggestion(env, { barcode: '9999999999999' }, { lookupBarcode, enrichFromWikidata });
    expect(result.grapeVariety).toBe('Nebbiolo');
  });

  it('skips Wikidata entirely when no name is known yet', async () => {
    const lookupBarcode = async () => null;
    const enrichFromWikidata = async (): Promise<never> => { throw new Error('should not be called'); };
    const result = await buildSuggestion(env, { barcode: '9999999999998' }, { lookupBarcode, enrichFromWikidata });
    expect(result).toEqual({ barcode: '9999999999998' });
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
