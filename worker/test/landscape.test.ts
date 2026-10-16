import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { placeOf, landscapeTerms, pickLandscape, findLandscape } from '../src/lib/landscape';

const page = (title: string, o: { w?: number; h?: number; mime?: string; license?: string; cats?: string; index?: number; artist?: string } = {}) => ({
  title, index: o.index ?? 1,
  imageinfo: [{
    thumburl: `https://upload.wikimedia.org/thumb/${encodeURIComponent(title)}/1100px.jpg`, descriptionurl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`,
    width: o.w ?? 4000, height: o.h ?? 2600, mime: o.mime ?? 'image/jpeg',
    extmetadata: {
      LicenseShortName: { value: o.license ?? 'CC BY-SA 4.0' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0' },
      Artist: { value: o.artist ?? '<a href="//commons.wikimedia.org/wiki/User:Mario">Mario Rossi</a>' }, Categories: { value: o.cats ?? 'Vineyards in Piedmont' },
    },
  }],
});

describe('landscape helpers', () => {
  it('drops classification words from a denomination', () => {
    expect(placeOf('Franciacorta DOCG')).toBe('Franciacorta');
    expect(placeOf('Saint-Émilion Grand Cru')).toBe('Saint-Émilion');
    expect(placeOf('Rioja DOCa')).toBe('Rioja');
    expect(placeOf('Chianti Classico DOCG')).toBe('Chianti Classico');
  });

  it('searches the denomination, then the region, then the country in English', () => {
    expect(landscapeTerms({ denomination: 'Barolo DOCG', region: 'Piemonte', country: 'Italia' }).map((t) => t.query)).toEqual(['Barolo', 'Piemonte', 'Italy']);
    expect(landscapeTerms({ denomination: 'Bordeaux AOC', region: 'Bordeaux', country: 'Francia' }).map((t) => t.query)).toEqual(['Bordeaux', 'France']);
    expect(landscapeTerms({ country: 'Italia' })[0]).toEqual({ key: 'italy', query: 'Italy' });
  });

  it('keeps only wide free-licence vineyard photos, preferring quality ones', () => {
    const pages = [
      page('File:Barolo map.jpg', { index: 0 }),
      page('File:Langhe bottle.jpg', { index: 0, cats: 'Vineyards' }),
      page('File:Vineyard NC.jpg', { index: 0, license: 'CC BY-NC 2.0' }),
      page('File:Tall vines.jpg', { index: 0, w: 2000, h: 3000 }),
      page('File:Small vines.jpg', { index: 0, w: 800, h: 500 }),
      page('File:Castle.jpg', { index: 0, cats: 'Castles in Italy' }),
      page('File:Vigneti a Barolo.jpg', { index: 3 }),
      page('File:Barolo vineyards at dusk.jpg', { index: 5, cats: 'Vineyards in Piedmont|Quality images' }),
    ];
    const l = pickLandscape(pages, 'Barolo');
    expect(l?.file).toBe('File:Barolo vineyards at dusk.jpg');
    expect(l?.author).toBe('Mario Rossi');
    expect(l?.license).toBe('CC BY-SA 4.0');
    expect(pickLandscape([page('File:Barolo map.jpg')], 'Barolo')).toBeNull();
  });
});

describe('findLandscape', () => {
  beforeEach(async () => { await env.DB.exec('DELETE FROM landscapes;'); });

  const commons = (byQuery: Record<string, unknown[]>, calls: string[]) => (async (url: string) => {
    const q = new URL(url).searchParams.get('gsrsearch') ?? '';
    calls.push(q);
    const key = Object.keys(byQuery).find((k) => q.startsWith(k + ' '));
    return new Response(JSON.stringify(key && byQuery[key].length ? { query: { pages: byQuery[key] } } : {}), { status: 200 });
  }) as unknown as typeof fetch;

  it('falls back to the region when the denomination has nothing, and remembers both', async () => {
    const calls: string[] = [];
    const fake = commons({ Piemonte: [page('File:Vigneti in Piemonte.jpg')] }, calls);
    const area = { denomination: 'Barolo DOCG', region: 'Piemonte', country: 'Italia' };
    const l = await findLandscape(env.DB, area, fake);
    expect(l?.file).toBe('File:Vigneti in Piemonte.jpg');
    expect(calls).toEqual(['Barolo vineyard filetype:bitmap', 'Piemonte vineyard filetype:bitmap']);
    // Second time: no search at all.
    const again = await findLandscape(env.DB, area, fake);
    expect(again?.file).toBe('File:Vigneti in Piemonte.jpg');
    expect(calls.length).toBe(2);
  });

  it('does not remember anything when Commons cannot be reached', async () => {
    const down = (async () => { throw new Error('down'); }) as unknown as typeof fetch;
    expect(await findLandscape(env.DB, { region: 'Toscana' }, down)).toBeNull();
    const { n } = (await env.DB.prepare('select count(*) as n from landscapes').first<{ n: number }>())!;
    expect(n).toBe(0);
  });
});
