import { describe, it, expect } from 'vitest';
import { searchWine } from '../src/lib/tavily-search';

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
}

describe('searchWine', () => {
  it('sends the query verbatim (no " vino" suffix), basic search depth (default), restricted to vivino.com', async () => {
    let capturedBody: any;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ results: [], images: [] }), { status: 200 });
    }) as typeof fetch;
    await searchWine('Zamuner blanc', 'key', fetchImpl);
    expect(capturedBody.query).toBe('Zamuner blanc');
    expect(capturedBody.search_depth).toBeUndefined();
    expect(capturedBody.include_domains).toEqual(['vivino.com']);
  });

  it('zips results and images by index into candidates, and counts one credit spent', async () => {
    const fetchImpl = fakeFetch(200, {
      results: [
        { title: 'Barolo DOCG', content: 'Rosso piemontese.', url: 'https://vivino.com/it/barolo-docg/w/1', score: 0.8 },
        { title: 'Barolo DOCG Riserva', content: 'Vino corposo.', url: 'https://vivino.com/it/barolo-docg-riserva/w/2', score: 0.7 },
      ],
      images: ['https://vivino.com/bottiglia1.jpg', 'https://vivino.com/bottiglia2.jpg'],
    });
    const result = await searchWine('Barolo DOCG', 'key', fetchImpl);
    expect(result).toEqual({
      creditsUsed: 1,
      candidates: [
        { title: 'Barolo DOCG', snippet: 'Rosso piemontese.', sourceUrl: 'https://vivino.com/it/barolo-docg/w/1', imageUrl: 'https://vivino.com/bottiglia1.jpg' },
        { title: 'Barolo DOCG Riserva', snippet: 'Vino corposo.', sourceUrl: 'https://vivino.com/it/barolo-docg-riserva/w/2', imageUrl: 'https://vivino.com/bottiglia2.jpg' },
      ],
    });
  });

  it('reorders candidates by Tavily\'s own relevance score', async () => {
    // Both mention "fondatore" (the distinctive word) so neither trips the
    // relevance filter — only their Tavily score should differ.
    const fetchImpl = fakeFetch(200, {
      results: [
        { title: 'Trovato: Fondatore', content: 'n/a', url: 'https://vivino.com/it/trovato-fondatore/w/1', score: 0.3 },
        { title: 'Zamuner Riserva del Fondatore', content: 'Cantina Zamuner.', url: 'https://vivino.com/it/riserva-del-fondatore/w/2', score: 0.9 },
      ],
      images: [],
    });
    const result = await searchWine('Zamuner Riserva del Fondatore', 'key', fetchImpl);
    expect(result?.candidates.map((c) => c.sourceUrl)).toEqual([
      'https://vivino.com/it/riserva-del-fondatore/w/2',
      'https://vivino.com/it/trovato-fondatore/w/1',
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
    expect(result?.candidates.map((c) => c.title)).toEqual(['Zamuner Blanc de Noirs Brut']);
  });

  it('keeps stable Tavily order among candidates that tie on score (missing score defaults to 0)', async () => {
    // All three mention "barolo" (the distinctive word) so none trips the
    // relevance filter.
    const fetchImpl = fakeFetch(200, {
      results: [
        { title: 'Barolo A', content: 'a', url: 'https://vivino.com/it/barolo-a/w/1' },
        { title: 'Barolo B', content: 'b', url: 'https://vivino.com/it/barolo-b/w/2' },
        { title: 'Barolo C', content: 'c', url: 'https://vivino.com/it/barolo-c/w/3' },
      ],
      images: [],
    });
    const result = await searchWine('Barolo DOCG', 'key', fetchImpl);
    expect(result?.candidates.map((c) => c.title)).toEqual(['Barolo A', 'Barolo B', 'Barolo C']);
  });

  it('requests a bigger pool from Tavily than it shows, then caps the (re-sorted) result at 10', async () => {
    // A stopword-only query has no distinctive word, so the relevance
    // filter is skipped entirely — this test is only about pool/cap size.
    const results = Array.from({ length: 15 }, (_, i) => ({ title: String(i), content: String(i), url: `https://vivino.com/it/wine-${i}/w/${i}`, score: i / 15 }));
    const fetchImpl = fakeFetch(200, { results, images: [] });
    const result = await searchWine('il', 'key', fetchImpl);
    expect(result?.candidates).toHaveLength(10);
  });

  it('handles image objects with a url field', async () => {
    const fetchImpl = fakeFetch(200, {
      results: [{ title: 'Barolo DOCG', content: 'Rosso piemontese.', url: 'https://vivino.com/it/barolo/w/1', score: 0.8 }],
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
          url: 'https://vivino.com/it/zamuner-blanc-de-blancs-brut/w/1',
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

  it('collapses same-wine duplicates published under several languages, keeping the /it/ one', async () => {
    // All three are the same bottle (/w/1) that Vivino serves per language.
    // Before the dedup these took three of the ten rows in the picker, which
    // is what surfaced as "Spanish Vivino records" in the add-wine search.
    const fetchImpl = fakeFetch(200, {
      results: [
        { title: 'Zamuner Cuvée Alessandra | Vivino Español', content: 'n/a', url: 'https://www.vivino.com/es/zamuner-cuvee-alessandra/w/1', score: 0.77 },
        { title: 'Zamuner Cuvée Alessandra | Vivino English', content: 'n/a', url: 'https://www.vivino.com/en/zamuner-cuvee-alessandra/w/1', score: 0.75 },
        { title: 'Zamuner Cuvée Alessandra | Vivino Italiano', content: 'n/a', url: 'https://www.vivino.com/it/zamuner-cuvee-alessandra/w/1', score: 0.73 },
      ],
      images: [],
    });
    const result = await searchWine('Zamuner', 'key', fetchImpl);
    expect(result?.candidates.map((c) => c.sourceUrl)).toEqual([
      'https://www.vivino.com/it/zamuner-cuvee-alessandra/w/1',
    ]);
  });

  it('keeps two vintages of the same wine apart — same wine id, different ?year=', async () => {
    const fetchImpl = fakeFetch(200, {
      results: [
        { title: 'Zamuner Riserva 2019 | Vivino Italiano', content: 'n/a', url: 'https://www.vivino.com/it/zamuner-riserva/w/1?year=2019', score: 0.8 },
        { title: 'Zamuner Riserva 2020 | Vivino Italiano', content: 'n/a', url: 'https://www.vivino.com/it/zamuner-riserva/w/1?year=2020', score: 0.7 },
      ],
      images: [],
    });
    const result = await searchWine('Zamuner', 'key', fetchImpl);
    expect(result?.candidates).toHaveLength(2);
  });

  it('drops winery profiles and listing pages — only a wine page can become a bottle', async () => {
    // Both of these reached the real picker: tapping one would have saved a
    // wine named "Zamuner Winery", since the add sheet pre-fills from the
    // title. Only the /w/ page survives.
    const fetchImpl = fakeFetch(200, {
      results: [
        { title: 'Zamuner Winery - Vivino', content: 'n/a', url: 'https://www.vivino.com/it/wineries/zamuner', score: 0.9 },
        { title: 'Zamuner wines list | Vivino', content: 'n/a', url: 'https://www.vivino.com/it/search/wines?q=zamuner', score: 0.85 },
        { title: 'Zamuner Blanc de Blancs Brut | Vivino Italiano', content: 'n/a', url: 'https://www.vivino.com/it/zamuner-blanc-de-blancs-brut/w/2118', score: 0.7 },
      ],
      images: [],
    });
    const result = await searchWine('Zamuner', 'key', fetchImpl);
    expect(result?.candidates).toEqual([
      { title: 'Zamuner Blanc de Blancs Brut', snippet: 'n/a', sourceUrl: 'https://www.vivino.com/it/zamuner-blanc-de-blancs-brut/w/2118' },
    ]);
  });

  it('strips the per-language Vivino site suffix from the title', async () => {
    // The title is what the add sheet pre-fills the wine name from, so the
    // suffix would otherwise be saved into the cellar. All three separators
    // below appeared in one production list.
    const fetchImpl = fakeFetch(200, {
      results: [
        { title: 'Zamuner Amarone della Valpolicella | Vivino English', content: 'n/a', url: 'https://www.vivino.com/it/a/w/1', score: 0.9 },
        { title: 'Zamuner Valecchia Rosso | Vivino Italiano', content: 'n/a', url: 'https://www.vivino.com/it/b/w/2', score: 0.8 },
        { title: 'Zamuner Daniele Riserva del Fondatore Brut Rosé - Vivino', content: 'n/a', url: 'https://www.vivino.com/it/c/w/3', score: 0.7 },
      ],
      images: [],
    });
    const result = await searchWine('Zamuner', 'key', fetchImpl);
    expect(result?.candidates.map((c) => c.title)).toEqual([
      'Zamuner Amarone della Valpolicella',
      'Zamuner Valecchia Rosso',
      'Zamuner Daniele Riserva del Fondatore Brut Rosé',
    ]);
  });

  it('leaves a title that has no Vivino suffix untouched', async () => {
    const fetchImpl = fakeFetch(200, {
      results: [{ title: 'Ambrosini Franciacorta Lorenzo Ambrosini Riserva', content: 'n/a', url: 'https://www.vivino.com/it/x/w/1', score: 0.9 }],
      images: [],
    });
    const result = await searchWine('Ambrosini', 'key', fetchImpl);
    expect(result?.candidates[0]?.title).toBe('Ambrosini Franciacorta Lorenzo Ambrosini Riserva');
  });

  it('recognises the Italian page in every Vivino URL shape, including /IT/it/', async () => {
    // Live URL shapes: /en/… (language only), /IT/it/… and /BR/pt-BR/…
    // (country + language). The Italian copy must win the collapse in all
    // of them — a bare startsWith('/it/') used to miss /IT/it/ entirely.
    const fetchImpl = fakeFetch(200, {
      results: [
        { title: 'Ambrosini Franciacorta Batude Brut | Vivino Brasil', content: 'n/a', url: 'https://www.vivino.com/BR/pt-BR/ambrosini-franciacorta-batude/w/2667819', score: 0.9 },
        { title: 'Ambrosini Franciacorta Batude Brut | Vivino US', content: 'n/a', url: 'https://www.vivino.com/US/en/ambrosini-franciacorta-batude/w/2667819?year=2019', score: 0.85 },
        { title: 'Ambrosini Franciacorta Batude Brut | Vivino Italiano', content: 'n/a', url: 'https://www.vivino.com/IT/it/ambrosini-franciacorta-batude/w/2667819', score: 0.5 },
      ],
      images: [],
    });
    const result = await searchWine('Ambrosini batude', 'key', fetchImpl);
    // The ?year= copy is a different vintage, so it legitimately stays.
    expect(result?.candidates.map((c) => c.sourceUrl)).toEqual([
      'https://www.vivino.com/IT/it/ambrosini-franciacorta-batude/w/2667819',
      'https://www.vivino.com/US/en/ambrosini-franciacorta-batude/w/2667819?year=2019',
    ]);
  });

  it('matches across accents both ways — the title carries them, the Vivino slug does not', async () => {
    // The real wine is titled "Batudè" but slugged "…-batude".
    const accented = {
      results: [{ title: 'Ambrosini Franciacorta Batudè Brut | Vivino Italiano', content: 'n/a', url: 'https://www.vivino.com/IT/it/ambrosini-franciacorta-batude/w/2667819', score: 0.9 }],
      images: [],
    };
    // Typed without the accent, and with it: both must find the wine.
    expect((await searchWine('Batude', 'key', fakeFetch(200, accented)))?.candidates).toHaveLength(1);
    expect((await searchWine('Batudè', 'key', fakeFetch(200, accented)))?.candidates).toHaveLength(1);

    // And when only the title carries the name at all, folding is the only
    // thing keeping the result alive.
    const titleOnly = {
      results: [{ title: 'Ambrosini Franciacorta Satèn | Vivino Italiano', content: 'n/a', url: 'https://www.vivino.com/IT/it/ambrosini/w/999', score: 0.9 }],
      images: [],
    };
    expect((await searchWine('Saten', 'key', fakeFetch(200, titleOnly)))?.candidates).toHaveLength(1);
  });

  it('orders different wines by score alone — language never lifts one above a more relevant other', async () => {
    // Two different wines (/w/1 and /w/2), so there is nothing to collapse.
    // The Italian one is far less relevant and must stay second — this is
    // what the old +0.05 boost put at risk, and it was seen inverting a
    // 0.84 against a 0.88 in a real list before the boost was removed.
    const fetchImpl = fakeFetch(200, {
      results: [
        { title: 'Zamuner Riserva | Vivino English', content: 'n/a', url: 'https://www.vivino.com/en/zamuner-riserva/w/1', score: 0.9 },
        { title: 'Zamuner Base | Vivino Italiano', content: 'n/a', url: 'https://www.vivino.com/it/zamuner-base/w/2', score: 0.87 },
      ],
      images: [],
    });
    const result = await searchWine('Zamuner', 'key', fetchImpl);
    expect(result?.candidates.map((c) => c.sourceUrl)).toEqual([
      'https://www.vivino.com/en/zamuner-riserva/w/1',
      'https://www.vivino.com/it/zamuner-base/w/2',
    ]);
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

  it('"Zamuner Blanc de Blancs": collapses the language copies and drops the unrelated Spanish white', async () => {
    // Distinctive word here is "zamuner" (the producer), which every real
    // Zamuner page carries in title and slug — so the filter is on its
    // strong footing and only the duplicates need removing.
    const fetchImpl = fakeFetch(200, {
      results: [
        { title: 'Zamuner Blanc de Blancs Brut | Vivino Español', content: 'n/a', url: 'https://www.vivino.com/es/zamuner-blanc-de-blancs-brut/w/2118', score: 0.78 },
        { title: 'Don de Dar Vino De La Tierra De Castilla Sauvignon Blanc | Vivino', content: 'n/a', url: 'https://www.vivino.com/es/don-de-dar-sauvignon-blanc/w/9001', score: 0.76 },
        { title: 'Zamuner Blanc de Blancs Brut | Vivino English', content: 'n/a', url: 'https://www.vivino.com/en/zamuner-blanc-de-blancs-brut/w/2118', score: 0.74 },
        { title: 'Zamuner Blanc de Blancs Brut | Vivino', content: 'n/a', url: 'https://www.vivino.com/it/zamuner-blanc-de-blancs-brut/w/2118', score: 0.72 },
      ],
      images: [],
    });
    const result = await searchWine('Zamuner blanc de blanc', 'key', fetchImpl);
    expect(result?.candidates.map((c) => c.sourceUrl)).toEqual([
      'https://www.vivino.com/it/zamuner-blanc-de-blancs-brut/w/2118',
    ]);
  });

  it('"Batude Tenuta Ambrosini": collapses the duplicate but keeps the producer\'s other wine', async () => {
    const fetchImpl = fakeFetch(200, {
      results: [
        { title: 'Tenuta Ambrosini Batude | Vivino Español', content: 'n/a', url: 'https://www.vivino.com/es/tenuta-ambrosini-batude/w/5501', score: 0.81 },
        { title: 'Tenuta Ambrosini Batude | Vivino', content: 'n/a', url: 'https://www.vivino.com/it/tenuta-ambrosini-batude/w/5501', score: 0.79 },
        { title: 'Tenuta Ambrosini Franciacorta Brut | Vivino', content: 'n/a', url: 'https://www.vivino.com/it/tenuta-ambrosini-franciacorta/w/5502', score: 0.60 },
      ],
      images: [],
    });
    const result = await searchWine('batude di tenuta Ambrosini', 'key', fetchImpl);
    expect(result?.candidates.map((c) => c.sourceUrl)).toEqual([
      'https://www.vivino.com/it/tenuta-ambrosini-batude/w/5501',
      'https://www.vivino.com/it/tenuta-ambrosini-franciacorta/w/5502',
    ]);
  });

  it('characterises a real weak spot: the right wine is dropped when its page never names the producer', async () => {
    // "batude di tenuta Ambrosini" keys the relevance filter on "ambrosini"
    // (the longest word), not on "batude". If Vivino titles and slugs the
    // page by the wine name alone, the correct bottle matches nothing and is
    // filtered out — the user sees "nessun risultato" for a wine that WAS
    // returned. Searching the bare wine name instead is the workaround.
    const onlyWineName = {
      results: [{ title: 'Batude 2019 | Vivino', content: 'n/a', url: 'https://www.vivino.com/it/batude/w/5501', score: 0.9 }],
      images: [],
    };
    expect((await searchWine('batude di tenuta Ambrosini', 'key', fakeFetch(200, onlyWineName)))?.candidates).toEqual([]);
    expect((await searchWine('batude', 'key', fakeFetch(200, onlyWineName)))?.candidates).toHaveLength(1);
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
