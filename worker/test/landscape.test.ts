import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../src/index';
import { placeOf, landscapeTerms, pickLandscape, findLandscape, zoneFor } from '../src/lib/landscape';
import { ZONES } from '../src/lib/landscape-zones';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);

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

  it('refuses a vineyard photo that does not name the place', () => {
    // Was the Veneto photo: a Californian winery.
    expect(pickLandscape([page('File:Schramsberg Vineyards, July 2019.jpg', { cats: 'Vineyards in California' })], 'Veneto')).toBeNull();
  });

  it('finds the hand-picked zone from the denomination, else the region', () => {
    const z = (denomination: string | null, region: string | null) => zoneFor({ denomination, region })?.id ?? null;
    expect(z('Conegliano-Valdobbiadene Prosecco Superiore Rive DOCG', 'Veneto')).toBe('valdobbiadene');
    expect(z('Valpolicella Ripasso Classico Superiore DOC', 'Veneto')).toBe('valpolicella');
    expect(z('Rosso Veronese IGT', 'Veneto')).toBe('valpolicella');
    expect(z('Chiaretto di Bardolino Classico Spumante DOC', 'Veneto')).toBe('bardolino');
    expect(z('Piave Malanotte DOCG', 'Veneto')).toBe('piave');
    expect(z('Friuli Colli Orientali DOC', 'Friuli-Venezia Giulia')).toBe('colli-orientali');
    expect(z('Friuli Grave DOC', 'Friuli-Venezia Giulia')).toBe('grave');
    expect(z('Trevenezie IGT', 'Friuli-Venezia Giulia')).toBe('friuli');
    expect(z('Südtirol - Alto Adige DOC', null)).toBe('alto-adige');
    expect(z(null, 'Veneto')).toBe('veneto');
    expect(z('Rioja DOCa', 'Rioja')).toBeNull();
  });
});

describe('hand-picked landscapes', () => {
  it('give each wine of a zone its own photo, always the same, served from R2', async () => {
    const area = { denomination: 'Bardolino DOC', region: 'Veneto', country: 'Italia' };
    const noSearch = (async () => { throw new Error('no search for a known zone'); }) as unknown as typeof fetch;
    const urls = new Set<string>();
    for (let id = 1; id <= 20; id++) urls.add((await findLandscape(env, area, noSearch, String(id)))!.url);
    expect(urls.size).toBeGreaterThan(4);
    const one = await findLandscape(env, area, noSearch, '7');
    expect((await findLandscape(env, area, noSearch, '7'))!.url).toBe(one!.url);
    expect(one!.url).toMatch(/^\/api\/landscape-images\/landscapes%2Fbardolino%2F/);

    const key = decodeURIComponent(one!.url.split('/').pop()!);
    await env.PHOTOS.put(key, JPEG, { httpMetadata: { contentType: 'image/jpeg' } });
    const res = await app.request(one!.url, { headers: { 'X-Calice-Dev-Email': 'land@b.com' } }, env);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(JPEG);
    expect((await app.request('/api/landscape-images/wines%2F1%2Fx', { headers: { 'X-Calice-Dev-Email': 'land@b.com' } }, env)).status).toBe(404);
  });

  it('answers only for the area of a wine in the caller\'s cellar', async () => {
    const auth = { 'X-Calice-Dev-Email': 'area@b.com' };
    const cellars = await (await app.request('/api/cellars', { headers: auth }, env)).json<any[]>();
    const wine = await env.DB.prepare(`insert into wines (name, producer, country, type, source, denomination, region) values ('B', 'X', 'Italia', 'rosso', 'catalog', 'Bardolino DOC', 'Veneto') returning id`).first<{ id: number }>();
    await app.request(`/api/cellars/${cellars[0].id}/bottles`, { method: 'POST', body: JSON.stringify({ wineId: wine!.id, quantity: 1 }), headers: { ...auth, 'content-type': 'application/json' } }, env);
    const get = async (qs: string) => (await (await app.request(`/api/landscape?${qs}`, { headers: auth }, env)).json<any>()).landscape;
    expect((await get('denomination=Bardolino+DOC&region=Veneto&country=Italia&seed=1'))?.url).toMatch(/landscapes%2Fbardolino%2F/);
    expect(await get('denomination=Qualunque+cosa&region=Veneto&country=Italia')).toBeNull();
  });

  it('every zone has photos with a credit', () => {
    for (const z of ZONES) {
      expect(z.photos.length).toBeGreaterThan(0);
      for (const p of z.photos) {
        expect(p.key.startsWith(`landscapes/${z.id}/`)).toBe(true);
        expect(p.author && p.license && p.pageUrl).toBeTruthy();
      }
    }
  });
});

describe('findLandscape', () => {
  beforeEach(async () => { await env.DB.exec('DELETE FROM landscapes;'); });

  const commons = (byQuery: Record<string, unknown[]>, calls: string[]) => (async (url: string) => {
    if (String(url).startsWith('https://upload.wikimedia.org/')) return new Response(JPEG, { status: 200 });
    const q = new URL(url).searchParams.get('gsrsearch') ?? '';
    calls.push(q);
    const key = Object.keys(byQuery).find((k) => q.startsWith(k + ' '));
    return new Response(JSON.stringify(key && byQuery[key].length ? { query: { pages: byQuery[key] } } : {}), { status: 200 });
  }) as unknown as typeof fetch;

  it('falls back to the region when the denomination has nothing, copies the photo to R2 and remembers both', async () => {
    const calls: string[] = [];
    const fake = commons({ Toscana: [page('File:Vigneti in Toscana.jpg', { cats: 'Vineyards in Tuscany' })] }, calls);
    const area = { denomination: 'Morellino di Scansano DOCG', region: 'Toscana', country: 'Italia' };
    const l = await findLandscape(env, area, fake);
    expect(l?.file).toBe('File:Vigneti in Toscana.jpg');
    expect(l?.url).toMatch(/^\/api\/landscape-images\/landscapes%2Fauto%2F/);
    expect(calls).toEqual(['Morellino di Scansano vineyard filetype:bitmap', 'Toscana vineyard filetype:bitmap']);
    // Second time: no search at all.
    const again = await findLandscape(env, area, fake);
    expect(again?.url).toBe(l?.url);
    expect(calls.length).toBe(2);
  });

  it('searches again a term remembered with a photo on Commons', async () => {
    await env.DB.prepare(`insert into landscapes (term, file, url, page_url, author, license, checked_at) values ('toscana', 'File:Old.jpg', 'https://upload.wikimedia.org/x/960px-Old.jpg', '', 'A', 'CC0', datetime('now'))`).run();
    const calls: string[] = [];
    const l = await findLandscape(env, { region: 'Toscana' }, commons({ Toscana: [page('File:Vigneti in Toscana.jpg')] }, calls));
    expect(calls).toEqual(['Toscana vineyard filetype:bitmap']);
    expect(l?.url.startsWith('/api/landscape-images/')).toBe(true);
  });

  it('does not remember anything when Commons cannot be reached', async () => {
    const down = (async () => { throw new Error('down'); }) as unknown as typeof fetch;
    expect(await findLandscape(env, { region: 'Toscana' }, down)).toBeNull();
    const { n } = (await env.DB.prepare('select count(*) as n from landscapes').first<{ n: number }>())!;
    expect(n).toBe(0);
  });
});
