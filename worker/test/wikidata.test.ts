import { describe, it, expect } from 'vitest';
import { enrichFromWikidata } from '../src/lib/wikidata';

function fakeFetch(responses: { search: unknown; claims?: unknown; entity?: unknown }): typeof fetch {
  return (async (url: string | URL) => {
    const u = url.toString();
    if (u.includes('wbsearchentities')) return new Response(JSON.stringify(responses.search), { status: 200 });
    if (u.includes('wbgetclaims')) return new Response(JSON.stringify(responses.claims), { status: 200 });
    return new Response(JSON.stringify(responses.entity), { status: 200 });
  }) as typeof fetch;
}

describe('enrichFromWikidata', () => {
  it('resolves a known wine to its grape variety via P186', async () => {
    const fetchImpl = fakeFetch({
      search: { search: [{ id: 'Q808584' }] },
      claims: { claims: { P186: [{ mainsnak: { datavalue: { value: { id: 'Q202290' } } } }] } },
      entity: { entities: { Q202290: { labels: { it: { value: 'Nebbiolo' }, en: { value: 'Nebbiolo' } } } } },
    });
    const result = await enrichFromWikidata('Barolo DOCG', undefined, fetchImpl);
    expect(result).toEqual({ grapeVariety: 'Nebbiolo' });
  });

  it('falls back to P527 when P186 is absent', async () => {
    const fetchImpl = fakeFetch({
      search: { search: [{ id: 'Q1' }] },
      claims: { claims: { P527: [{ mainsnak: { datavalue: { value: { id: 'Q2' } } } }] } },
      entity: { entities: { Q2: { labels: { en: { value: 'Sangiovese' } } } } },
    });
    const result = await enrichFromWikidata('Chianti Classico', 'Antinori', fetchImpl);
    expect(result).toEqual({ grapeVariety: 'Sangiovese' });
  });

  it('returns null when no entity matches the search', async () => {
    const fetchImpl = fakeFetch({ search: { search: [] } });
    expect(await enrichFromWikidata('Vino inventato che non esiste', undefined, fetchImpl)).toBeNull();
  });

  it('returns null when the matched entity has neither P186 nor P527', async () => {
    const fetchImpl = fakeFetch({ search: { search: [{ id: 'Q1' }] }, claims: { claims: {} } });
    expect(await enrichFromWikidata('Qualcosa', undefined, fetchImpl)).toBeNull();
  });

  it('returns null when the search request fails', async () => {
    const fetchImpl = (async () => { throw new Error('timeout'); }) as typeof fetch;
    expect(await enrichFromWikidata('Barolo DOCG', 'Elio Altare', fetchImpl)).toBeNull();
  });
});
