import { describe, it, expect } from 'vitest';
import { searchWine } from '../src/lib/tavily-search';

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
}

describe('searchWine', () => {
  it('zips results and images by index into candidates, and counts one credit spent', async () => {
    const fetchImpl = fakeFetch(200, {
      results: [
        { title: 'Barolo DOCG - Wine Searcher', content: 'Rosso piemontese.', url: 'https://wine-searcher.com/p/1' },
        { title: 'Barolo DOCG - Decanter', content: 'Vino corposo.', url: 'https://decanter.com/p/2' },
      ],
      images: ['https://wine-searcher.com/bottiglia.jpg', 'https://decanter.com/bottiglia.jpg'],
    });
    const result = await searchWine('Barolo DOCG', 'key', fetchImpl);
    expect(result).toEqual({
      creditsUsed: 1,
      candidates: [
        { title: 'Barolo DOCG - Wine Searcher', snippet: 'Rosso piemontese.', sourceUrl: 'https://wine-searcher.com/p/1', imageUrl: 'https://wine-searcher.com/bottiglia.jpg' },
        { title: 'Barolo DOCG - Decanter', snippet: 'Vino corposo.', sourceUrl: 'https://decanter.com/p/2', imageUrl: 'https://decanter.com/bottiglia.jpg' },
      ],
    });
  });

  it('reorders candidates so more query words matched in the URL rank first', async () => {
    // Neither URL contains "riserva" or "fondatore" as literally as the
    // producer's own domain contains "zamuner" — zamuner.it should outrank
    // a generic retailer URL even though Tavily listed it second.
    const fetchImpl = fakeFetch(200, {
      results: [
        { title: 'Zamuner Riserva del Fondatore - Vivino', content: 'Bollicine venete.', url: 'https://vivino.com/p/98765' },
        { title: 'Zamuner | Sito ufficiale', content: 'Cantina Zamuner.', url: 'https://www.zamuner.it/riserva-del-fondatore' },
        { title: 'Unrelated result', content: 'n/a', url: 'https://example.com/other' },
      ],
      images: [],
    });
    const result = await searchWine('Zamuner Riserva del Fondatore', 'key', fetchImpl);
    expect(result?.candidates.map((c) => c.sourceUrl)).toEqual([
      'https://www.zamuner.it/riserva-del-fondatore',
      'https://vivino.com/p/98765',
      'https://example.com/other',
    ]);
  });

  it('keeps stable Tavily order among candidates that tie on URL-match score', async () => {
    const fetchImpl = fakeFetch(200, {
      results: [
        { title: 'A', content: 'a', url: 'https://a.example/no-match' },
        { title: 'B', content: 'b', url: 'https://b.example/no-match' },
        { title: 'C', content: 'c', url: 'https://c.example/no-match' },
      ],
      images: [],
    });
    const result = await searchWine('Barolo DOCG', 'key', fetchImpl);
    expect(result?.candidates.map((c) => c.title)).toEqual(['A', 'B', 'C']);
  });

  it('requests a bigger pool from Tavily than it shows, then caps the (re-sorted) result at 10', async () => {
    const results = Array.from({ length: 15 }, (_, i) => ({ title: String(i), content: String(i), url: `https://${i}.example` }));
    const fetchImpl = fakeFetch(200, { results, images: [] });
    const result = await searchWine('query', 'key', fetchImpl);
    expect(result?.candidates).toHaveLength(10);
  });

  it('handles image objects with a url field', async () => {
    const fetchImpl = fakeFetch(200, {
      results: [{ title: 'Barolo DOCG', content: 'Rosso piemontese.', url: 'https://wine-searcher.com/barolo' }],
      images: [{ url: 'https://x/barolo.jpg', description: 'Bottiglia di Barolo' }],
    });
    const result = await searchWine('Barolo DOCG', 'key', fetchImpl);
    expect(result?.candidates[0]?.imageUrl).toBe('https://x/barolo.jpg');
  });

  it('returns an empty candidate list (not null) when there are no results — the call still cost a credit', async () => {
    const fetchImpl = fakeFetch(200, { results: [], images: [] });
    const result = await searchWine('nothing found', 'key', fetchImpl);
    expect(result).toEqual({ candidates: [], creditsUsed: 1 });
  });

  it('returns null (no credit counted) on a non-200 response', async () => {
    const fetchImpl = fakeFetch(401, { error: 'invalid API key' });
    expect(await searchWine('query', 'key', fetchImpl)).toBeNull();
  });

  it('returns null when the fetch throws (network error or timeout)', async () => {
    const fetchImpl = (async () => { throw new Error('timeout'); }) as typeof fetch;
    expect(await searchWine('query', 'key', fetchImpl)).toBeNull();
  });

  it('returns null when the response body is not valid JSON', async () => {
    const fetchImpl = (async () => new Response('not json', { status: 200 })) as typeof fetch;
    expect(await searchWine('query', 'key', fetchImpl)).toBeNull();
  });
});
