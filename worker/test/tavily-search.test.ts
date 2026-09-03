import { describe, it, expect } from 'vitest';
import { searchWine } from '../src/lib/tavily-search';

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
}

describe('searchWine', () => {
  it('restricts the search to the trusted wine-site domain list, so Vivino coverage is guaranteed rather than hoped-for', async () => {
    let capturedBody: any;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ results: [], images: [] }), { status: 200 });
    }) as typeof fetch;
    await searchWine('Barolo DOCG', 'key', fetchImpl);
    expect(capturedBody.query).toBe('Barolo DOCG'); // sent as-is — no " vino" suffix diluting relevance
    expect(capturedBody.include_domains).toEqual([
      'vivino.com',
      'wine-searcher.com',
      'tannico.it',
      'oltrebolla20.com',
      'callmewine.com',
      'bernabei.it',
      'vino.com',
      'xtrawine.com',
    ]);
  });

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

  it('reorders candidates so more query words matched in the URL rank first, among non-Vivino results', async () => {
    // Neither URL contains "riserva" or "fondatore" as literally as the
    // producer's own domain contains "zamuner" — zamuner.it should outrank
    // a generic retailer URL even though Tavily listed it second. Both
    // mention "fondatore" (the distinctive word) so neither trips the
    // relevance filter below.
    const fetchImpl = fakeFetch(200, {
      results: [
        { title: 'Trovato: Fondatore', content: 'n/a', url: 'https://example.com/other' },
        { title: 'Zamuner | Sito ufficiale', content: 'Cantina Zamuner.', url: 'https://www.zamuner.it/riserva-del-fondatore' },
      ],
      images: [],
    });
    const result = await searchWine('Zamuner Riserva del Fondatore', 'key', fetchImpl);
    expect(result?.candidates.map((c) => c.sourceUrl)).toEqual([
      'https://www.zamuner.it/riserva-del-fondatore',
      'https://example.com/other',
    ]);
  });

  it('always ranks a Vivino result first, even over a stronger URL-match elsewhere', async () => {
    const fetchImpl = fakeFetch(200, {
      results: [
        // Zero URL-match words, but it's Vivino — should still win.
        { title: 'Zamuner Riserva del Fondatore - Vivino', content: 'Bollicine venete.', url: 'https://vivino.com/p/98765' },
        // Every query word literally in the URL — would win without the boost.
        { title: 'Zamuner | Sito ufficiale', content: 'Cantina Zamuner.', url: 'https://www.zamuner.it/riserva-del-fondatore' },
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
        { title: 'Fake 1', content: 'n/a', url: 'https://evil.example/?x=vivino.com' },
        { title: 'Fake 2', content: 'n/a', url: 'https://vivino.com.evil.example/p/1' },
        // Real, but scores 0 on URL-match too — order should be Tavily's own (stable).
        { title: 'Real', content: 'n/a', url: 'https://vivino.com/wines/1' },
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

  it('orders multiple Vivino results between themselves by URL-match score', async () => {
    // Both mention "zamuner" (the distinctive word) so neither trips the
    // relevance filter — only their URL-match score should differ.
    const fetchImpl = fakeFetch(200, {
      results: [
        { title: 'Zamuner - lista vini', content: 'n/a', url: 'https://vivino.com/wines/1' },
        { title: 'Zamuner Vivino hit', content: 'n/a', url: 'https://vivino.com/wines/zamuner-riserva' },
      ],
      images: [],
    });
    const result = await searchWine('Zamuner Riserva', 'key', fetchImpl);
    expect(result?.candidates.map((c) => c.sourceUrl)).toEqual([
      'https://vivino.com/wines/zamuner-riserva',
      'https://vivino.com/wines/1',
    ]);
  });

  it('drops a candidate that never mentions the distinctive query word in its title or URL', async () => {
    const fetchImpl = fakeFetch(200, {
      results: [
        { title: 'Sauvignon Blanc | Uve da vino', content: 'wine types. price range. showing 1-24 of 673 wines.', url: 'https://vivino.com/grapes/sauvignon-blanc' },
        { title: 'Zamuner Blanc de Noirs', content: 'Bollicine venete.', url: 'https://vivino.com/wines/zamuner-blanc' },
      ],
      images: [],
    });
    const result = await searchWine('Zamuner blanc', 'key', fetchImpl);
    expect(result?.candidates.map((c) => c.title)).toEqual(['Zamuner Blanc de Noirs']);
  });

  it('does not let a coincidental mention buried in the snippet save a generic listing page', async () => {
    // A grape/category listing page can enumerate hundreds of wines in its
    // scraped content, so "zamuner" can show up there by sheer coincidence
    // even though the page itself is a generic "Sauvignon Blanc" listing,
    // not anything specific to Zamuner — only title/URL should count.
    const fetchImpl = fakeFetch(200, {
      results: [
        { title: 'Sauvignon Blanc | Uve da vino', content: 'showing 1-24 of 673 wines, including Zamuner Blanc de Blancs among many others.', url: 'https://vivino.com/grapes/sauvignon-blanc' },
        { title: 'Zamuner Blanc de Noirs', content: 'Bollicine venete.', url: 'https://vivino.com/wines/zamuner-blanc' },
      ],
      images: [],
    });
    const result = await searchWine('Zamuner blanc', 'key', fetchImpl);
    expect(result?.candidates.map((c) => c.title)).toEqual(['Zamuner Blanc de Noirs']);
  });

  it('keeps every candidate when filtering would drop them all (a loose guess beats nothing)', async () => {
    const fetchImpl = fakeFetch(200, {
      results: [
        { title: 'Sauvignon Blanc | Uve da vino', content: 'n/a', url: 'https://vivino.com/grapes/sauvignon-blanc' },
        { title: 'Muscat Blanc | Uve da vino', content: 'n/a', url: 'https://vivino.com/grapes/muscat-blanc' },
      ],
      images: [],
    });
    const result = await searchWine('Zamuner blanc', 'key', fetchImpl);
    expect(result?.candidates).toHaveLength(2);
  });

  it('cleans markdown-separator noise and long boilerplate out of the snippet', async () => {
    const fetchImpl = fakeFetch(200, {
      results: [
        {
          title: 'Zamuner',
          content:
            'Title: Sauvignon Blanc ##### wine types. ##### price range(EUR). ##### vivino average rating. ## grapes. ## regions. ## countries. ## foods. showing 1-24 of 673 wines. Lail Vineyards Georgia Sauvignon Blanc 2017. Terlan Quarz Sauvignon 2024. Henri Bourgeois Sancerre Jadis 2017.',
          url: 'https://vivino.com/wines/zamuner',
        },
      ],
      images: [],
    });
    const result = await searchWine('Zamuner', 'key', fetchImpl);
    const snippet = result?.candidates[0]?.snippet ?? '';
    expect(snippet).not.toContain('#');
    expect(snippet.length).toBeLessThanOrEqual(181); // 180 + the ellipsis char
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
