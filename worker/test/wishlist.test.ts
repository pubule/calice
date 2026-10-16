import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../src/index';

function signup(email: string) {
  return { 'X-Calice-Dev-Email': email };
}

async function myCellarId(auth: Record<string, string>) {
  const cellars = await (await app.request('/api/cellars', { headers: auth }, env)).json<any[]>();
  return cellars[0].id;
}

let wineId: number;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM wishlist_items; DELETE FROM wines; DELETE FROM cellar_members; DELETE FROM cellars; DELETE FROM users;');
  const wine = await env.DB
    .prepare(`insert into wines (name, producer, country, type, source) values ('Sassicaia', 'Tenuta San Guido', 'Italia', 'rosso', 'catalog') returning id`)
    .first<{ id: number }>();
  wineId = wine!.id;
});

describe('wishlist', () => {
  it('adds, lists, and removes an item', async () => {
    const auth = signup('w1@b.com');
    const cellars = await (await app.request('/api/cellars', { headers: auth }, env)).json<any[]>();
    const cellarId = cellars[0].id;

    const created = await (
      await app.request(
        `/api/cellars/${cellarId}/wishlist`,
        { method: 'POST', body: JSON.stringify({ wineId, targetPrice: 140 }), headers: { ...auth, 'content-type': 'application/json' } },
        env,
      )
    ).json<{ id: number }>();

    const list = await (await app.request(`/api/cellars/${cellarId}/wishlist`, { headers: auth }, env)).json<any[]>();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Sassicaia');

    const delRes = await app.request(`/api/wishlist/${created.id}`, { method: 'DELETE', headers: auth }, env);
    expect(delRes.status).toBe(200);
    const listAfter = await (await app.request(`/api/cellars/${cellarId}/wishlist`, { headers: auth }, env)).json<any[]>();
    expect(listAfter).toHaveLength(0);
  });

  it('keeps one wish per wine (a second add updates the target price) and validates the input', async () => {
    const auth = signup('w2@b.com');
    const cellarId = await myCellarId(auth);
    const post = (body: object) => app.request(`/api/cellars/${cellarId}/wishlist`, { method: 'POST', body: JSON.stringify(body), headers: { ...auth, 'content-type': 'application/json' } }, env);
    const first = await (await post({ wineId })).json<any>();
    const again = await (await post({ wineId, targetPrice: 45.5 })).json<any>();
    expect(again.id).toBe(first.id);
    expect(again.target_price).toBe(45.5);
    const list = await (await app.request(`/api/cellars/${cellarId}/wishlist`, { headers: auth }, env)).json<any[]>();
    expect(list).toHaveLength(1);
    expect((await post({ wineId: 999999 })).status).toBe(404);
    for (const bad of [{}, { wineId: 'x' }, { wineId, targetPrice: -1 }, { wineId, targetPrice: 'tanto' }]) {
      expect((await post(bad)).status, JSON.stringify(bad)).toBe(400);
    }
  });

  it('rejects a non-member with 403 on GET, POST, and 404 on DELETE', async () => {
    const authA = await signup('owner10@b.com');
    const cellarId = await myCellarId(authA);
    const authB = await signup('stranger10@b.com');

    const getRes = await app.request(`/api/cellars/${cellarId}/wishlist`, { headers: authB }, env);
    expect(getRes.status).toBe(403);

    const postRes = await app.request(
      `/api/cellars/${cellarId}/wishlist`,
      { method: 'POST', body: JSON.stringify({ wineId, targetPrice: 100 }), headers: { ...authB, 'content-type': 'application/json' } },
      env,
    );
    expect(postRes.status).toBe(403);

    const created = await (
      await app.request(
        `/api/cellars/${cellarId}/wishlist`,
        { method: 'POST', body: JSON.stringify({ wineId, targetPrice: 100 }), headers: { ...authA, 'content-type': 'application/json' } },
        env,
      )
    ).json<{ id: number }>();

    const delRes = await app.request(`/api/wishlist/${created.id}`, { method: 'DELETE', headers: authB }, env);
    expect(delRes.status).toBe(404);

    const list = await (await app.request(`/api/cellars/${cellarId}/wishlist`, { headers: authA }, env)).json<any[]>();
    expect(list).toHaveLength(1);
  });
});
