import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../src/index';
import { downloadImage, copyImageToR2, copyExternalImages } from '../src/routes/wine-image';

const signup = (email: string) => ({ 'X-Calice-Dev-Email': email });
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

let wineId: number;
let auth: Record<string, string>;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM bottle_places; DELETE FROM bottles; DELETE FROM wines; DELETE FROM cellar_members; DELETE FROM cellars; DELETE FROM users;');
  auth = signup('img@b.com');
  const cellars = await (await app.request('/api/cellars', { headers: auth }, env)).json<any[]>();
  const wine = await env.DB.prepare(`insert into wines (name, producer, country, type, source, image_url) values ('Le Macine', 'Colli Vicentini', 'Italia', 'bollicine', 'catalog', 'https://images.vivino.com/x.png') returning id`).first<{ id: number }>();
  wineId = wine!.id;
  await app.request(`/api/cellars/${cellars[0].id}/bottles`, { method: 'POST', body: JSON.stringify({ wineId, quantity: 1 }), headers: { ...auth, 'content-type': 'application/json' } }, env);
});

describe('wine photo chosen by the user', () => {
  it('stores an uploaded image as the wine photo, serves it, and removes it', async () => {
    const form = new FormData();
    form.append('file', new File([PNG], 'x.png'));
    const res = await app.request(`/api/wines/${wineId}/image`, { method: 'PUT', body: form, headers: auth }, env);
    expect(res.status).toBe(200);
    const wine = await res.json<any>();
    expect(wine.image_url).toMatch(/^\/api\/wine-images\/wines%2F/);
    const file = await app.request(wine.image_url, { headers: auth }, env);
    expect(file.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(PNG);

    const removed = await (await app.request(`/api/wines/${wineId}/image`, { method: 'DELETE', headers: auth }, env)).json<any>();
    expect(removed.image_url).toBeNull();
    expect((await app.request(wine.image_url, { headers: auth }, env)).status).toBe(404);
  });

  it('keeps a small copy for the lists, served with ?thumb=1, falling back to the photo', async () => {
    const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9]);
    const plain = new FormData();
    plain.append('file', new File([PNG], 'x.png'));
    const before = await (await app.request(`/api/wines/${wineId}/image`, { method: 'PUT', body: plain, headers: auth }, env)).json<any>();
    const fallback = await app.request(`${before.image_url}?thumb=1`, { headers: auth }, env);
    expect(fallback.headers.get('x-thumb')).toBe('0');
    expect(fallback.headers.get('cache-control')).toContain('max-age=60');
    expect(new Uint8Array(await fallback.arrayBuffer())).toEqual(PNG);

    const form = new FormData();
    form.append('file', new File([PNG], 'x.png'));
    form.append('thumb', new File([JPEG], 't.jpg'));
    const wine = await (await app.request(`/api/wines/${wineId}/image`, { method: 'PUT', body: form, headers: auth }, env)).json<any>();
    const small = await app.request(`${wine.image_url}?thumb=1`, { headers: auth }, env);
    expect(small.headers.get('x-thumb')).toBe('1');
    expect(new Uint8Array(await small.arrayBuffer())).toEqual(JPEG);
    // The old photo and its small copy went with it; the copy is never served on its own.
    const oldKey = decodeURIComponent(before.image_url.slice('/api/wine-images/'.length));
    expect(await env.PHOTOS.head(oldKey)).toBeNull();
    const key = decodeURIComponent(wine.image_url.slice('/api/wine-images/'.length));
    expect((await app.request(`/api/wine-images/${encodeURIComponent(key + '.thumb')}`, { headers: auth }, env)).status).toBe(404);
    await app.request(`/api/wines/${wineId}/image`, { method: 'DELETE', headers: auth }, env);
    expect(await env.PHOTOS.head(key + '.thumb')).toBeNull();
  });

  it('refuses something that is not an image, and a stranger', async () => {
    const form = new FormData();
    form.append('file', new File([new TextEncoder().encode('<html>')], 'x.png'));
    expect((await app.request(`/api/wines/${wineId}/image`, { method: 'PUT', body: form, headers: auth }, env)).status).toBe(400);
    const form2 = new FormData();
    form2.append('file', new File([PNG], 'x.png'));
    expect((await app.request(`/api/wines/${wineId}/image`, { method: 'PUT', body: form2, headers: signup('altro@b.com') }, env)).status).toBe(404);
  });

  it('downloads an image link, refusing what is not a link or too big', async () => {
    const ok = (async () => new Response(PNG, { status: 200 })) as unknown as typeof fetch;
    expect(new Uint8Array((await downloadImage('https://example.com/a.png', ok)) as ArrayBuffer)).toEqual(PNG);
    expect(await downloadImage('javascript:alert(1)', ok)).toBe('not a link');
    const big = (async () => new Response('x', { status: 200, headers: { 'content-length': '9000000' } })) as unknown as typeof fetch;
    expect(await downloadImage('https://example.com/a.png', big)).toBe('too big');
  });
});

describe('web images copied into R2', () => {
  const ok = (async () => new Response(PNG, { status: 200 })) as unknown as typeof fetch;
  const down = (async () => new Response('no', { status: 404 })) as unknown as typeof fetch;
  const imageOf = async (id: number) => (await env.DB.prepare('select image_url from wines where id = ?').bind(id).first<{ image_url: string }>())!.image_url;

  it('the cron copies every web link, keeps a dead one, and never overwrites a newer photo', async () => {
    const dead = await env.DB.prepare(`insert into wines (name, producer, country, type, source, image_url) values ('Morto', 'X', 'Italia', 'rosso', 'catalog', 'https://dead.example/x.png') returning id`).first<{ id: number }>();
    const fetchImpl = (async (u: string) => (String(u).includes('dead') ? down('') : ok(''))) as unknown as typeof fetch;
    expect(await copyExternalImages(env, fetchImpl)).toEqual({ copied: 1, left: 1 });
    const url = await imageOf(wineId);
    expect(url).toMatch(/^\/api\/wine-images\/wines%2F/);
    expect(new Uint8Array(await (await app.request(url, { headers: auth }, env)).arrayBuffer())).toEqual(PNG);
    expect(await imageOf(dead!.id)).toBe('https://dead.example/x.png');

    // The link changed meanwhile (the user picked a photo): the copy is dropped.
    await env.DB.prepare(`update wines set image_url = 'https://images.vivino.com/y.png' where id = ?`).bind(dead!.id).run();
    expect(await copyImageToR2(env, dead!.id, 'https://images.vivino.com/old.png', ok)).toBe(false);
    expect(await imageOf(dead!.id)).toBe('https://images.vivino.com/y.png');
  });

  it('"Rimuovi foto" keeps a file another wine shows under another encoding of its key', async () => {
    await env.PHOTOS.put('wines/9/k', PNG);
    await env.DB.prepare(`insert into wines (name, producer, country, type, source, image_url) values ('Altro', 'X', 'Italia', 'rosso', 'catalog', '/api/wine-images/wines%2F9%2Fk')`).run();
    await env.DB.prepare(`update wines set image_url = '/api/wine-images/wines/9/k' where id = ?`).bind(wineId).run();
    expect((await app.request(`/api/wines/${wineId}/image`, { method: 'DELETE', headers: auth }, env)).status).toBe(200);
    expect(await env.PHOTOS.head('wines/9/k')).not.toBeNull();
  });

  it('a wine whose photo is already ours can be saved again with that photo', async () => {
    const own = '/api/wine-images/wines%2F1%2Fabc';
    await env.DB.prepare(`update wines set image_url = ? where id = ?`).bind(own, wineId).run();
    const post = (imageUrl: string) => app.request('/api/wines', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Nuovo', producer: 'Y', country: 'Italia', type: 'rosso', imageUrl }) }, env);
    const res = await post(own);
    expect(res.status).toBe(200);
    expect((await res.json<any>()).image_url).toBe(own);
    // A key no wine shows (here: a backup) is refused, so "Rimuovi foto" can never delete it.
    expect((await post('/api/wine-images/backups%2F2026-10-19.json')).status).toBe(400);
  });
});

