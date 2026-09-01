import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../src/index';

async function signup(email: string) {
  const res = await app.request(
    '/api/auth/signup',
    { method: 'POST', body: JSON.stringify({ email, password: 'secret123', name: email }), headers: { 'content-type': 'application/json' } },
    env,
  );
  return res.headers.get('set-cookie')!.split(';')[0];
}

async function myCellarId(cookie: string) {
  const cellars = await (await app.request('/api/cellars', { headers: { cookie } }, env)).json<any[]>();
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
    const cookie = await signup('w1@b.com');
    const cellars = await (await app.request('/api/cellars', { headers: { cookie } }, env)).json<any[]>();
    const cellarId = cellars[0].id;

    const created = await (
      await app.request(
        `/api/cellars/${cellarId}/wishlist`,
        { method: 'POST', body: JSON.stringify({ wineId, targetPrice: 140 }), headers: { cookie, 'content-type': 'application/json' } },
        env,
      )
    ).json<{ id: number }>();

    const list = await (await app.request(`/api/cellars/${cellarId}/wishlist`, { headers: { cookie } }, env)).json<any[]>();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Sassicaia');

    const delRes = await app.request(`/api/wishlist/${created.id}`, { method: 'DELETE', headers: { cookie } }, env);
    expect(delRes.status).toBe(200);
    const listAfter = await (await app.request(`/api/cellars/${cellarId}/wishlist`, { headers: { cookie } }, env)).json<any[]>();
    expect(listAfter).toHaveLength(0);
  });

  it('rejects a non-member with 403 on GET, POST, and 404 on DELETE', async () => {
    const cookieA = await signup('owner10@b.com');
    const cellarId = await myCellarId(cookieA);
    const cookieB = await signup('stranger10@b.com');

    const getRes = await app.request(`/api/cellars/${cellarId}/wishlist`, { headers: { cookie: cookieB } }, env);
    expect(getRes.status).toBe(403);

    const postRes = await app.request(
      `/api/cellars/${cellarId}/wishlist`,
      { method: 'POST', body: JSON.stringify({ wineId, targetPrice: 100 }), headers: { cookie: cookieB, 'content-type': 'application/json' } },
      env,
    );
    expect(postRes.status).toBe(403);

    const created = await (
      await app.request(
        `/api/cellars/${cellarId}/wishlist`,
        { method: 'POST', body: JSON.stringify({ wineId, targetPrice: 100 }), headers: { cookie: cookieA, 'content-type': 'application/json' } },
        env,
      )
    ).json<{ id: number }>();

    const delRes = await app.request(`/api/wishlist/${created.id}`, { method: 'DELETE', headers: { cookie: cookieB } }, env);
    expect(delRes.status).toBe(404);

    const list = await (await app.request(`/api/cellars/${cellarId}/wishlist`, { headers: { cookie: cookieA } }, env)).json<any[]>();
    expect(list).toHaveLength(1);
  });
});
