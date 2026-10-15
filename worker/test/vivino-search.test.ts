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
    });
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

  it('returns null — so the caller falls back to Tavily — on a non-200, invalid JSON, a network error or no usable hits', async () => {
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
