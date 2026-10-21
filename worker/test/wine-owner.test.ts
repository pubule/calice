import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../src/index';

// Each user has their own wines; the search is shared, one result per wine,
// with the most complete record (user's choice, 2026-10-19).
const h = (email: string) => ({ 'X-Calice-Dev-Email': email, 'content-type': 'application/json' });
const req = (email: string, path: string, method = 'GET', body?: unknown) =>
  app.request(path, { method, headers: h(email), body: body === undefined ? undefined : JSON.stringify(body) }, env);
const cellarOf = async (email: string) => (await (await req(email, '/api/cellars')).json<any[]>())[0].id;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM bottle_places; DELETE FROM photos; DELETE FROM tasting_notes; DELETE FROM wishlist_items; DELETE FROM bottles; DELETE FROM wines; DELETE FROM cellar_members; DELETE FROM cellars; DELETE FROM users;');
});

describe('wines per user', () => {
  it("adding another user's wine makes a copy: neither can change the other's", async () => {
    const a = await (await req('a@w.com', '/api/wines', 'POST', { name: 'Soave Classico', producer: 'Pieropan', country: 'Italia', type: 'bianco', vintage: 2022 })).json<any>();
    await req('a@w.com', `/api/cellars/${await cellarOf('a@w.com')}/bottles`, 'POST', { wineId: a.id, quantity: 1 });

    const bottle = await (await req('b@w.com', `/api/cellars/${await cellarOf('b@w.com')}/bottles`, 'POST', { wineId: a.id, quantity: 1 })).json<any>();
    expect(bottle.wine_id).not.toBe(a.id);

    const edit = { name: 'Soave Classico', producer: 'Pieropan', country: 'Italia', type: 'bianco', vintage: 2022, denomination: 'Scritto da B' };
    expect((await req('b@w.com', `/api/wines/${a.id}`, 'PATCH', edit)).status).toBe(404);
    expect((await req('b@w.com', `/api/wines/${a.id}/image`, 'DELETE')).status).toBe(404);
    expect((await req('b@w.com', `/api/wines/${bottle.wine_id}`, 'PATCH', edit)).status).toBe(200);
    const mine = await env.DB.prepare('select denomination from wines where id = ?').bind(a.id).first<any>();
    expect(mine.denomination).toBeNull();
  });

  it('the search shows each wine once, with the most complete record, and adding it fills the gaps', async () => {
    const a = await (await req('a@w.com', '/api/wines', 'POST', { name: 'Barolo', producer: 'Ascheri', country: 'Italia', type: 'rosso', vintage: 2019 })).json<any>();
    await req('a@w.com', `/api/cellars/${await cellarOf('a@w.com')}/bottles`, 'POST', { wineId: a.id, quantity: 1 });
    const b = await (await req('b@w.com', '/api/wines', 'POST', { name: 'Barolo', producer: 'Ascheri', country: 'Italia', type: 'rosso', vintage: 2019,
      region: 'Piemonte', denomination: 'Barolo DOCG', grapeVariety: 'Nebbiolo', alcohol: 14.5 })).json<any>();
    await req('b@w.com', `/api/cellars/${await cellarOf('b@w.com')}/bottles`, 'POST', { wineId: b.id, quantity: 1 });

    // A third user sees one Barolo, with B's data.
    const forC = await (await req('c@w.com', '/api/wines/search?q=barolo ascheri')).json<any[]>();
    expect(forC).toHaveLength(1);
    expect(forC[0]).toMatchObject({ denomination: 'Barolo DOCG', grape_variety: 'Nebbiolo' });
    expect(forC[0].owner_id).toBeUndefined();

    // A sees the best data under A's own id; adding it again fills A's wine.
    const forA = await (await req('a@w.com', '/api/wines/search?q=barolo')).json<any[]>();
    expect(forA).toHaveLength(1);
    expect(forA[0]).toMatchObject({ id: a.id, denomination: 'Barolo DOCG' });
    await req('a@w.com', `/api/cellars/${await cellarOf('a@w.com')}/bottles`, 'POST', { wineId: forA[0].id, quantity: 1 });
    const filled = await env.DB.prepare('select denomination, alcohol, owner_id from wines where id = ?').bind(a.id).first<any>();
    expect(filled.denomination).toBe('Barolo DOCG');
    expect(filled.alcohol).toBe(14.5);
    const count = await env.DB.prepare(`select count(*) as n from wines where name = 'Barolo' and owner_id = ?`).bind(filled.owner_id).first<any>();
    expect(count.n).toBe(1);
  });

  it('a copy takes the photo already in our R2 over a web link', async () => {
    const a = await (await req('a@w.com', '/api/wines', 'POST', { name: 'Anima', producer: 'Le Due Torri', country: 'Italia', type: 'rosato', vintage: 2023 })).json<any>();
    const b = await (await req('b@w.com', '/api/wines', 'POST', { name: 'Anima', producer: 'Le Due Torri', country: 'Italia', type: 'rosato', vintage: 2023,
      region: 'Friuli', denomination: 'Friuli DOC', grapeVariety: 'Merlot' })).json<any>();
    await env.DB.prepare('update wines set image_url = ? where id = ?').bind('/api/wine-images/wines%2F1%2Fown', a.id).run();
    await env.DB.prepare('update wines set image_url = ? where id = ?').bind('https://example.com/anima.png', b.id).run();

    const bottle = await (await req('c@w.com', `/api/cellars/${await cellarOf('c@w.com')}/bottles`, 'POST', { wineId: b.id, quantity: 1 })).json<any>();
    const copy = await env.DB.prepare('select image_url, denomination from wines where id = ?').bind(bottle.wine_id).first<any>();
    expect(copy).toEqual({ image_url: '/api/wine-images/wines%2F1%2Fown', denomination: 'Friuli DOC' });
  });
});
