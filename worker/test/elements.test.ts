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

beforeEach(async () => {
  await env.DB.exec(
    'DELETE FROM bottles; DELETE FROM cellar_elements; DELETE FROM cellar_members; DELETE FROM cellars; DELETE FROM users;',
  );
});

describe('cellar elements', () => {
  it('creates and lists elements for a cellar', async () => {
    const auth = signup('e1@b.com');
    const cellarId = await myCellarId(auth);

    const createRes = await app.request(
      `/api/cellars/${cellarId}/elements`,
      { method: 'POST', body: JSON.stringify({ kind: 'Rack', name: 'Rack ingresso', tiers: 2, cols: 6, depth: 1 }), headers: { ...auth, 'content-type': 'application/json' } },
      env,
    );
    expect(createRes.status).toBe(200);
    const created = await createRes.json<any>();
    expect(created.kind).toBe('Rack');

    const list = await (await app.request(`/api/cellars/${cellarId}/elements`, { headers: auth }, env)).json<any[]>();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Rack ingresso');
  });

  it('creates a Scatolone with no tiers/cols/depth', async () => {
    const auth = signup('e2@b.com');
    const cellarId = await myCellarId(auth);
    const res = await app.request(
      `/api/cellars/${cellarId}/elements`,
      { method: 'POST', body: JSON.stringify({ kind: 'Scatolone', name: 'Scatolone trasloco' }), headers: { ...auth, 'content-type': 'application/json' } },
      env,
    );
    const created = await res.json<any>();
    expect(created.tiers).toBeNull();
  });

  it('rejects a non-member with 403 on both list and create', async () => {
    const authA = signup('owner4@b.com');
    const cellarId = await myCellarId(authA);
    const authB = signup('stranger3@b.com');

    const listRes = await app.request(`/api/cellars/${cellarId}/elements`, { headers: authB }, env);
    expect(listRes.status).toBe(403);

    const createRes = await app.request(
      `/api/cellars/${cellarId}/elements`,
      { method: 'POST', body: JSON.stringify({ kind: 'Scatolone', name: 'Intruso' }), headers: { ...authB, 'content-type': 'application/json' } },
      env,
    );
    expect(createRes.status).toBe(403);
  });

  it('deleting an element unassigns any bottle placed in it', async () => {
    const auth = signup('e3@b.com');
    const cellarId = await myCellarId(auth);
    const wine = await env.DB
      .prepare(`insert into wines (name, producer, country, type, source) values ('Barolo DOCG', 'Elio Altare', 'Italia', 'rosso', 'catalog') returning id`)
      .first<{ id: number }>();
    const element = await (
      await app.request(
        `/api/cellars/${cellarId}/elements`,
        { method: 'POST', body: JSON.stringify({ kind: 'Scaffale', name: 'Scaffale A', tiers: 3, cols: 5, depth: 1 }), headers: { ...auth, 'content-type': 'application/json' } },
        env,
      )
    ).json<{ id: number }>();
    const bottle = await (
      await app.request(
        `/api/cellars/${cellarId}/bottles`,
        { method: 'POST', body: JSON.stringify({ wineId: wine!.id, quantity: 1 }), headers: { ...auth, 'content-type': 'application/json' } },
        env,
      )
    ).json<{ id: number }>();
    await app.request(
      `/api/bottles/${bottle.id}/location`,
      { method: 'PATCH', body: JSON.stringify({ elementId: element.id, tier: 1, col: 0, depth: 1 }), headers: { ...auth, 'content-type': 'application/json' } },
      env,
    );

    const delRes = await app.request(`/api/elements/${element.id}`, { method: 'DELETE', headers: auth }, env);
    expect(delRes.status).toBe(200);

    const bottles = await (await app.request(`/api/cellars/${cellarId}/bottles`, { headers: auth }, env)).json<any[]>();
    expect(bottles[0].element_id).toBeNull();
  });

  it('rejects an unknown kind and a non-integer dimension', async () => {
    const auth = signup('e6@b.com');
    const cellarId = await myCellarId(auth);

    const badKind = await app.request(
      `/api/cellars/${cellarId}/elements`,
      { method: 'POST', body: JSON.stringify({ kind: 'Armadio', name: 'x' }), headers: { ...auth, 'content-type': 'application/json' } },
      env,
    );
    expect(badKind.status).toBe(400);

    const badDims = await app.request(
      `/api/cellars/${cellarId}/elements`,
      { method: 'POST', body: JSON.stringify({ kind: 'Scaffale', name: 'x', tiers: 2.5, cols: 5, depth: 1 }), headers: { ...auth, 'content-type': 'application/json' } },
      env,
    );
    expect(badDims.status).toBe(400);
  });

  it('rejects deleting another cellar\'s element with 404', async () => {
    const authA = signup('owner5@b.com');
    const cellarId = await myCellarId(authA);
    const element = await (
      await app.request(
        `/api/cellars/${cellarId}/elements`,
        { method: 'POST', body: JSON.stringify({ kind: 'Scatolone', name: 'Scatolone' }), headers: { ...authA, 'content-type': 'application/json' } },
        env,
      )
    ).json<{ id: number }>();
    const authB = signup('stranger4@b.com');
    const res = await app.request(`/api/elements/${element.id}`, { method: 'DELETE', headers: authB }, env);
    expect(res.status).toBe(404);
  });
});
