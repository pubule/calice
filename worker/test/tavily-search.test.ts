import { describe, it, expect } from 'vitest';
import { searchWine } from '../src/lib/tavily-search';

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
}

describe('searchWine', () => {
  it('sends the query with a " vino" suffix, basic search depth (default), restricted to vivino.com', async () => {
    let capturedBody: any;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ results: [], images: [] }), { status: 200 });
    }) as typeof fetch;
    await searchWine('Zamuner blanc', 'key', fetchImpl);
    expect(capturedBody.query).toBe('Zamuner blanc vino');
    expect(capturedBody.search_depth).toBeUndefined();
    expect(capturedBody.include_domains).toEqual(['vivino.com']);
  });

  it('zips results and images by index into candidates, and counts one credit spent', async () => {
    const fetchImpl = fakeFetch(200, {
      results: [
        { title: 'Barolo DOCG - Vivino', content: 'Rosso piemontese.', url: 'https://vivino.com/p/1', score: 0.8 },
        { title: 'Barolo DOCG - Vivino IT', content: 'Vino corposo.', url: 'https://vivino.com/p/2', score: 0.7 },
      ],
      images: ['https://vivino.com/bottiglia1.jpg', 'https://vivino.com/bottiglia2.jpg'],
    });
    const result = await searchWine('Barolo DOCG', 'key', fetchImpl);
    expect(result).toEqual({
      creditsUsed: 1,
      candidates: [
        { title: 'Barolo DOCG - Vivino', snippet: 'Rosso piemontese.', sourceUrl: 'https://vivino.com/p/1', imageUrl: 'https://vivino.com/bottiglia1.jpg' },
        { title: 'Barolo DOCG - Vivino IT', snippet: 'Vino corposo.', sourceUrl: 'https://vivino.com/p/2', imageUrl: 'https://vivino.com/bottiglia2.jpg' },
      ],
    });
  });

  it('reorders candidates by Tavily\'s own relevance score', async () => {
    // Both mention "fondatore" (the distinctive word) so neither trips the
    // relevance filter — only their Tavily score should differ.
    const fetchImpl = fakeFetch(200, {
      results: [
        { title: 'Trovato: Fondatore', content: 'n/a', url: 'https://vivino.com/other', score: 0.3 },
        { title: 'Zamuner Riserva del Fondatore | Vivino', content: 'Cantina Zamuner.', url: 'https://vivino.com/riserva-del-fondatore', score: 0.9 },
      ],
      images: [],
    });
    const result = await searchWine('Zamuner Riserva del Fondatore', 'key', fetchImpl);
    expect(result?.candidates.map((c) => c.sourceUrl)).toEqual([
      'https://vivino.com/riserva-del-fondatore',
      'https://vivino.com/other',
    ]);
  });

  it('drops an off-topic Vivino result that only coincidentally shares the search category', async () => {
    // Reproduces a real failure: "Zamuner blanc" once surfaced "Don de Dar
    // ... Sauvignon Blanc", a completely unrelated Spanish wine, also on
    // vivino.com — being on the trusted domain isn't enough on its own.
    const fetchImpl = fakeFetch(200, {
      results: [
        { title: 'Don de Dar Vino De La Tierra De Castilla Sauvignon Blanc | Vivino Español', content: 'n/a', url: 'https://vivino.com/es/don-de-dar/w/1', score: 0.6 },
        { title: 'Zamuner Blanc de Noirs Brut | Vivino English', content: 'n/a', url: 'https://vivino.com/en/zamuner-blanc-de-noirs-brut/w/2', score: 0.5 },
      ],
      images: [],
    });
    const result = await searchWine('Zamuner blanc', 'key', fetchImpl);
    expect(result?.candidates.map((c) => c.title)).toEqual(['Zamuner Blanc de Noirs Brut | Vivino English']);
  });

  it('keeps stable Tavily order among candidates that tie on score (missing score defaults to 0)', async () => {
    // All three mention "barolo" (the distinctive word) so none trips the
    // relevance filter.
    const fetchImpl = fakeFetch(200, {
      results: [
        { title: 'Barolo A', content: 'a', url: 'https://vivino.com/a' },
        { title: 'Barolo B', content: 'b', url: 'https://vivino.com/b' },
        { title: 'Barolo C', content: 'c', url: 'https://vivino.com/c' },
      ],
      images: [],
    });
    const result = await searchWine('Barolo DOCG', 'key', fetchImpl);
    expect(result?.candidates.map((c) => c.title)).toEqual(['Barolo A', 'Barolo B', 'Barolo C']);
  });

  it('requests a bigger pool from Tavily than it shows, then caps the (re-sorted) result at 10', async () => {
    // A stopword-only query has no distinctive word, so the relevance
    // filter is skipped entirely — this test is only about pool/cap size.
    const results = Array.from({ length: 15 }, (_, i) => ({ title: String(i), content: String(i), url: `https://vivino.com/${i}`, score: i / 15 }));
    const fetchImpl = fakeFetch(200, { results, images: [] });
    const result = await searchWine('il', 'key', fetchImpl);
    expect(result?.candidates).toHaveLength(10);
  });

  it('handles image objects with a url field', async () => {
    const fetchImpl = fakeFetch(200, {
      results: [{ title: 'Barolo DOCG', content: 'Rosso piemontese.', url: 'https://vivino.com/barolo', score: 0.8 }],
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

  it('returns an empty list rather than falling back to off-topic candidates when none mention the distinctive word', async () => {
    // On an unlucky Tavily draw, every returned result can miss the
    // distinctive query term — an honest "nothing found" beats resurrecting
    // candidates that merely look plausible.
    const fetchImpl = fakeFetch(200, {
      results: [
        { title: 'Sauvignon Blanc | Uve da vino', content: 'n/a', url: 'https://vivino.com/grapes/sauvignon-blanc', score: 0.8 },
        { title: 'Muscat Blanc | Uve da vino', content: 'n/a', url: 'https://vivino.com/grapes/muscat-blanc', score: 0.7 },
      ],
      images: [],
    });
    const result = await searchWine('Zamuner blanc', 'key', fetchImpl);
    expect(result?.candidates).toEqual([]);
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
