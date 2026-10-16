import { describe, it, expect } from 'vitest';
import { searchVivino, queryVivino, hitToCandidate } from '../src/lib/vivino-search';

function fakeFetch(status: number, body: unknown, seen?: { url?: string; init?: RequestInit }): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    if (seen) { seen.url = url; seen.init = init; }
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }) as typeof fetch;
}

const batude = {
  id: 2667819,
  name: 'Franciacorta Batudè Brut',
  seo_name: 'franciacorta-batude-brut',
  type_id: 3,
  winery: { name: 'Ambrosini', seo_name: 'ambrosini' },
  region: { name: 'Franciacorta', country: { name: 'Italia' } },
  image: { location: '//images.vivino.com/thumbs/abc_pb_x600.png', variations: { bottle_medium: '//images.vivino.com/thumbs/abc_pb_x300.png' } },
};

describe('hitToCandidate', () => {
  it('builds title from winery + name, a /w/<id> Italian URL, a type/region snippet and an absolute bottle image', () => {
    expect(hitToCandidate(batude)).toEqual({
      title: 'Ambrosini Franciacorta Batudè Brut',
      sourceUrl: 'https://www.vivino.com/IT/it/ambrosini-franciacorta-batude-brut/w/2667819',
      snippet: 'Bollicine · Franciacorta, Italia',
      imageUrl: 'https://images.vivino.com/thumbs/abc_pb_x300.png',
      prefill: { name: 'Franciacorta Batudè Brut', producer: 'Ambrosini', country: 'Italia', type: 'bollicine', denomination: 'Franciacorta' },
    });
  });

  it('turns an ISO country code into the Italian name, and reads grapes when the record carries them', () => {
    const c = hitToCandidate({ id: 9, name: 'Barolo Brunate', type_id: 1, winery: { name: 'Elio Altare' }, region: { name: 'Barolo', country: 'it' }, grapes: [{ name: 'Nebbiolo' }] });
    expect(c?.prefill).toEqual({ name: 'Barolo Brunate', producer: 'Elio Altare', country: 'Italia', type: 'rosso', denomination: 'Barolo', grapeVariety: 'Nebbiolo' });
    expect(c?.snippet).toBe('Rosso · Barolo, Italia');
  });

  it('reads the class into the denomination, the region above it, alcohol, website and per-vintage ratings', () => {
    const c = hitToCandidate({
      ...batude,
      alcohol: 12.5,
      region: { id: 817, name: 'Franciacorta', parent_id: 745, country: 'it', class: { abbreviation: 'DOCG' } },
      winery: { name: 'Ambrosini', seo_name: 'ambrosini', website: 'https://www.tenutambrosini.it/', region: { id: 745, name: 'Lombardia', class: { abbreviation: 'VDT' } } },
      vintages: [
        { year: '2019', statistics: { ratings_average: 3.7, ratings_count: 68 } },
        { year: '2017', statistics: { ratings_average: 0, ratings_count: 4 } },
        { year: 'U.V.', statistics: { ratings_average: 3.8, ratings_count: 475 } },
      ],
    });
    expect(c?.prefill).toMatchObject({ denomination: 'Franciacorta DOCG', region: 'Lombardia', alcohol: 12.5, producerUrl: 'https://www.tenutambrosini.it/' });
    expect(c?.vintageRatings).toEqual({ '2019': { average: 3.7, count: 68 } });
  });

  it("leaves out what isn't certain: a winery region elsewhere, a table-wine class, a bad website", () => {
    const c = hitToCandidate({
      ...batude,
      region: { id: 900, name: 'Salento', parent_id: 901, country: 'it', class: { abbreviation: 'VDT' } },
      winery: { name: 'Antinori', website: 'javascript:alert(1)', region: { id: 50, name: 'Toscana' } },
    });
    expect(c?.prefill?.denomination).toBe('Salento');
    expect(c?.prefill?.region).toBeUndefined();
    expect(c?.prefill?.producerUrl).toBeUndefined();
    expect(c?.prefill?.alcohol).toBeUndefined();
  });

  it('reads the community rating, and treats a 0 average (too few ratings) as none', () => {
    expect(hitToCandidate({ ...batude, statistics: { ratings_average: 3.84, ratings_count: 475 } })?.rating).toEqual({ average: 3.8, count: 475 });
    expect(hitToCandidate({ ...batude, statistics: { ratings_average: 0, ratings_count: 3 } })?.rating).toBeUndefined();
    expect(hitToCandidate(batude)?.rating).toBeUndefined();
  });

  it('leaves the type out when Vivino\'s type has no match in the app (dessert, fortified)', () => {
    expect(hitToCandidate({ id: 9, name: 'Recioto', type_id: 7 })?.prefill?.type).toBeUndefined();
  });

  it('does not repeat the winery when the wine name already contains it', () => {
    expect(hitToCandidate({ id: 1, name: 'Ambrosini Altri Sangiovese', winery: { name: 'Ambrosini' } })?.title).toBe('Ambrosini Altri Sangiovese');
  });

  it('skips hits without an id or a name', () => {
    expect(hitToCandidate({ name: 'x' })).toBeNull();
    expect(hitToCandidate({ id: 3 })).toBeNull();
  });
});

describe('searchVivino', () => {
  it('queries the Vivino search index with the query and returns mapped candidates in its order', async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const result = await searchVivino('ambrosini batud', fakeFetch(200, { hits: [batude, { id: 5, name: 'Altri Sangiovese', winery: { name: 'Ambrosini' } }] }, seen));
    expect(result?.map((c) => c.title)).toEqual(['Ambrosini Franciacorta Batudè Brut', 'Ambrosini Altri Sangiovese']);
    expect(seen.url).toMatch(/algolia\.net\/1\/indexes\/.+\/query$/);
    expect(JSON.parse(String(seen.init?.body)).params).toContain('query=ambrosini+batud');
  });

  it('returns null on a non-200, invalid JSON, a network error or no usable hits', async () => {
    expect(await searchVivino('x', fakeFetch(403, { message: 'Invalid API key' }))).toBeNull();
    expect(await searchVivino('x', fakeFetch(200, 'not json'))).toBeNull();
    expect(await searchVivino('x', (async () => { throw new Error('down'); }) as typeof fetch)).toBeNull();
    expect(await searchVivino('x', fakeFetch(200, { hits: [{ unexpected: true }] }))).toBeNull();
  });

  it('reports diagnostics for the debug endpoint', async () => {
    const diag = await queryVivino('x', fakeFetch(403, { message: 'Invalid API key' }));
    expect(diag).toMatchObject({ ok: false, status: 403 });
    expect(diag.error).toContain('Invalid API key');
  });
});
