import { describe, it, expect } from 'vitest';
import { lookupBarcode } from '../src/lib/open-food-facts';

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
}

describe('lookupBarcode', () => {
  it('maps a found product, taking only the first comma-separated brand/country', async () => {
    const fetchImpl = fakeFetch(200, {
      product: { product_name: 'Chianti Classico', brands: 'Antinori, Altro Marchio', countries: 'Italia,Toscana', image_url: 'https://x/img.jpg' },
    });
    const result = await lookupBarcode('8001234500019', fetchImpl);
    expect(result).toEqual({ name: 'Chianti Classico', producer: 'Antinori', country: 'Italia', imageUrl: 'https://x/img.jpg' });
  });

  it('returns null when the response has no product', async () => {
    const fetchImpl = fakeFetch(200, {});
    expect(await lookupBarcode('0000000000000', fetchImpl)).toBeNull();
  });

  it('returns null on a non-200 response', async () => {
    const fetchImpl = fakeFetch(404, {});
    expect(await lookupBarcode('0000000000000', fetchImpl)).toBeNull();
  });

  it('returns null when the fetch throws (network error or timeout)', async () => {
    const fetchImpl = (async () => { throw new Error('timeout'); }) as typeof fetch;
    expect(await lookupBarcode('0000000000000', fetchImpl)).toBeNull();
  });

  it('returns null when the response body is not valid JSON', async () => {
    const fetchImpl = (async () => new Response('not json', { status: 200 })) as typeof fetch;
    expect(await lookupBarcode('0000000000000', fetchImpl)).toBeNull();
  });
});
