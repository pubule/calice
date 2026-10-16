import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../src/index';
import { downloadImage } from '../src/routes/wine-image';

const signup = (email: string) => ({ 'X-Calice-Dev-Email': email });
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

let wineId: number;
let auth: Record<string, string>;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM activity_feed; DELETE FROM bottle_places; DELETE FROM bottles; DELETE FROM wines; DELETE FROM cellar_members; DELETE FROM cellars; DELETE FROM users;');
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
