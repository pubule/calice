import { describe, it, expect } from 'vitest';
import { searchWine } from '../src/lib/tavily-search';

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
}

describe('searchWine', () => {
  it('sends the query as-is with basic search depth (default), no domain restriction', async () => {
    let capturedBody: any;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ results: [], images: [] }), { status: 200 });
    }) as typeof fetch;
    await searchWine('Zamuner blanc', 'key', fetchImpl);
    expect(capturedBody.query).toBe('Zamuner blanc vino');
    expect(capturedBody.search_depth).toBeUndefined();
    expect(capturedBody.include_domains).toBeUndefined();
  });

  it('zips results and images by index into candidates, and counts one credit spent', async () => {
    const fetchImpl = fakeFetch(200, {
      results: [
        { title: 'Barolo DOCG - Wine Searcher', content: 'Rosso piemontese.', url: 'https://wine-searcher.com/p/1', score: 0.8 },
        { title: 'Barolo DOCG - Decanter', content: 'Vino corposo.', url: 'https://decanter.com/p/2', score: 0.7 },
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

  it('reorders candidates by Tavily\'s own relevance score', async () => {
    const fetchImpl = fakeFetch(200, {
      results: [
        { title: 'Weak match', content: 'n/a', url: 'https://example.com/other', score: 0.3 },
        { title: 'Zamuner | Sito ufficiale', content: 'Cantina Zamuner.', url: 'https://www.zamuner.it/riserva-del-fondatore', score: 0.9 },
      ],
      images: [],
    });
    const result = await searchWine('Zamuner Riserva del Fondatore', 'key', fetchImpl);
    expect(result?.candidates.map((c) => c.sourceUrl)).toEqual([
      'https://www.zamuner.it/riserva-del-fondatore',
      'https://example.com/other',
    ]);
  });

  it('always ranks a Vivino result first, even over a much higher Tavily score elsewhere', async () => {
    const fetchImpl = fakeFetch(200, {
      results: [
        // Lower Tavily score, but it's Vivino — should still win.
        { title: 'Zamuner Riserva del Fondatore - Vivino', content: 'Bollicine venete.', url: 'https://vivino.com/p/98765', score: 0.5 },
        // Much higher Tavily score — would win without the boost.
        { title: 'Zamuner | Sito ufficiale', content: 'Cantina Zamuner.', url: 'https://www.zamuner.it/riserva-del-fondatore', score: 0.95 },
      ],
      images: [],
    });
    const result = await searchWine('Zamuner Riserva del Fondatore', 'key', fetchImpl);
    expect(result?.candidates.map((c) => c.sourceUrl)).toEqual([
      'https://vivino.com/p/98765',
      'https://www.zamuner.it/riserva-del-fondatore',
    ]);
  });

  it('does not treat a URL that merely contains "vivino.com" as a real Vivino hostname', async () => {
    const fetchImpl = fakeFetch(200, {
      results: [
        // Spoofed: neither is actually on vivino.com.
        { title: 'Fake 1', content: 'n/a', url: 'https://evil.example/?x=vivino.com', score: 0.5 },
        { title: 'Fake 2', content: 'n/a', url: 'https://vivino.com.evil.example/p/1', score: 0.5 },
        // Real, and scores lower on Tavily's own relevance too — still wins on the Vivino boost alone.
        { title: 'Real', content: 'n/a', url: 'https://vivino.com/wines/1', score: 0.1 },
      ],
      images: [],
    });
    const result = await searchWine('query', 'key', fetchImpl);
    expect(result?.candidates.map((c) => c.sourceUrl)).toEqual([
      'https://vivino.com/wines/1',
      'https://evil.example/?x=vivino.com',
      'https://vivino.com.evil.example/p/1',
    ]);
  });

  it('orders multiple Vivino results between themselves by Tavily score', async () => {
    const fetchImpl = fakeFetch(200, {
      results: [
        { title: 'Generic Vivino hit', content: 'n/a', url: 'https://vivino.com/wines/1', score: 0.4 },
        { title: 'Zamuner Vivino hit', content: 'n/a', url: 'https://vivino.com/wines/zamuner-riserva', score: 0.8 },
      ],
      images: [],
    });
    const result = await searchWine('Zamuner Riserva', 'key', fetchImpl);
    expect(result?.candidates.map((c) => c.sourceUrl)).toEqual([
      'https://vivino.com/wines/zamuner-riserva',
      'https://vivino.com/wines/1',
    ]);
  });

  it('keeps stable Tavily order among candidates that tie on score (missing score defaults to 0)', async () => {
    const fetchImpl = fakeFetch(200, {
      results: [
        { title: 'A', content: 'a', url: 'https://a.example/x' },
        { title: 'B', content: 'b', url: 'https://b.example/x' },
        { title: 'C', content: 'c', url: 'https://c.example/x' },
      ],
      images: [],
    });
    const result = await searchWine('Barolo DOCG', 'key', fetchImpl);
    expect(result?.candidates.map((c) => c.title)).toEqual(['A', 'B', 'C']);
  });

  it('requests a bigger pool from Tavily than it shows, then caps the (re-sorted) result at 10', async () => {
    const results = Array.from({ length: 15 }, (_, i) => ({ title: String(i), content: String(i), url: `https://${i}.example`, score: i / 15 }));
    const fetchImpl = fakeFetch(200, { results, images: [] });
    const result = await searchWine('query', 'key', fetchImpl);
    expect(result?.candidates).toHaveLength(10);
  });

  it('handles image objects with a url field', async () => {
    const fetchImpl = fakeFetch(200, {
      results: [{ title: 'Barolo DOCG', content: 'Rosso piemontese.', url: 'https://wine-searcher.com/barolo', score: 0.8 }],
      images: [{ url: 'https://x/barolo.jpg', description: 'Bottiglia di Barolo' }],
    });
    const result = await searchWine('Barolo DOCG', 'key', fetchImpl);
    expect(result?.candidates[0]?.imageUrl).toBe('https://x/barolo.jpg');
  });

  it('cleans markdown-separator noise and long boilerplate out of the snippet', async () => {
    const fetchImpl = fakeFetch(200, {
      results: [
        {
          title: 'Zamuner Blanc de Blancs Brut | Vivino English',
          content:
            'Zamuner Blanc de Blancs Brut\n\n# Zamuner Blanc de Blancs Brut\n\n##### Facts about the wine\n\n##### winery Zamuner\n\n##### grapes Pinot Blanc, Chardonnay\n\nOur support team is always here to help. Careful delivery right to your doorstep. Check honest reviews of any wine before purchase.',
          url: 'https://vivino.com/wines/zamuner',
          score: 0.8,
        },
      ],
      images: [],
    });
    const result = await searchWine('Zamuner', 'key', fetchImpl);
    const snippet = result?.candidates[0]?.snippet ?? '';
    expect(snippet).not.toContain('#');
    expect(snippet.length).toBeLessThanOrEqual(181); // 180 + the ellipsis char
  });

  it('returns an empty candidate list (not null) when there are no results — the call still cost credits', async () => {
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
