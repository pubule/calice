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
  await env.DB.exec(
    'DELETE FROM activity_feed; DELETE FROM photos; DELETE FROM tasting_notes; DELETE FROM bottle_places; DELETE FROM bottles; DELETE FROM wines; DELETE FROM cellar_members; DELETE FROM cellars; DELETE FROM users;',
  );
  const wine = await env.DB
    .prepare(
      `insert into wines (name, producer, country, type, source, image_url, grape_variety, denomination)
       values ('Barolo DOCG', 'Elio Altare', 'Italia', 'rosso', 'catalog', 'https://x/barolo.jpg', 'Nebbiolo', 'Barolo DOCG') returning id`,
    )
    .first<{ id: number }>();
  wineId = wine!.id;
});

describe('bottles', () => {
  it('creates, lists (with null score), and the list includes activity feed side effect', async () => {
    const auth = signup('b1@b.com');
    const cellarId = await myCellarId(auth);

    const createRes = await app.request(
      `/api/cellars/${cellarId}/bottles`,
      { method: 'POST', body: JSON.stringify({ wineId, quantity: 3, pricePaid: 24, shelfLocation: 'Scaffale A3' }), headers: { ...auth, 'content-type': 'application/json' } },
      env,
    );
    expect(createRes.status).toBe(200);

    const listRes = await app.request(`/api/cellars/${cellarId}/bottles`, { headers: auth }, env);
    const bottles = await listRes.json<any[]>();
    expect(bottles).toHaveLength(1);
    expect(bottles[0].score).toBeNull();
    expect(bottles[0].name).toBe('Barolo DOCG');
    expect(bottles[0].image_url).toBe('https://x/barolo.jpg');
    // Needed so the "Modifica" edit sheet can pre-fill every wine field, not
    // just the ones already selected here before this feature existed.
    expect(bottles[0].grape_variety).toBe('Nebbiolo');
    expect(bottles[0].denomination).toBe('Barolo DOCG');

    const feed = await env.DB.prepare('select count(*) as n from activity_feed where action = ?').bind('added').first<{ n: number }>();
    expect(feed!.n).toBe(1);
  });

  it('computes score as the average tasting_notes rating', async () => {
    const auth = signup('b2@b.com');
    const cellarId = await myCellarId(auth);
    const created = await (
      await app.request(
        `/api/cellars/${cellarId}/bottles`,
        { method: 'POST', body: JSON.stringify({ wineId, quantity: 1 }), headers: { ...auth, 'content-type': 'application/json' } },
        env,
      )
    ).json<{ id: number }>();

    const userId = (await app.request('/api/auth/me', { headers: auth }, env).then((r) => r.json<{ id: number }>())).id;
    await env.DB.prepare('insert into tasting_notes (bottle_id, user_id, rating, text) values (?, ?, ?, ?)').bind(created.id, userId, 4, 'buono').run();
    await env.DB.prepare('insert into tasting_notes (bottle_id, user_id, rating, text) values (?, ?, ?, ?)').bind(created.id, userId, 5, 'ottimo').run();

    const bottles = await (await app.request(`/api/cellars/${cellarId}/bottles`, { headers: auth }, env)).json<any[]>();
    expect(bottles[0].score).toBe(4.5);
  });

  it('rejects a non-member with 403', async () => {
    const authA = signup('owner2@b.com');
    const cellarId = await myCellarId(authA);
    const authB = signup('stranger@b.com');
    const res = await app.request(`/api/cellars/${cellarId}/bottles`, { headers: authB }, env);
    expect(res.status).toBe(403);
  });

  it('updates and deletes a bottle', async () => {
    const auth = signup('b3@b.com');
    const cellarId = await myCellarId(auth);
    const created = await (
      await app.request(
        `/api/cellars/${cellarId}/bottles`,
        { method: 'POST', body: JSON.stringify({ wineId, quantity: 1 }), headers: { ...auth, 'content-type': 'application/json' } },
        env,
      )
    ).json<{ id: number }>();

    const patchRes = await app.request(
      `/api/bottles/${created.id}`,
      { method: 'PATCH', body: JSON.stringify({ quantity: 5, shelfLocation: 'Frigo' }), headers: { ...auth, 'content-type': 'application/json' } },
      env,
    );
    expect(patchRes.status).toBe(200);

    const delRes = await app.request(`/api/bottles/${created.id}`, { method: 'DELETE', headers: auth }, env);
    expect(delRes.status).toBe(200);
    const bottles = await (await app.request(`/api/cellars/${cellarId}/bottles`, { headers: auth }, env)).json<any[]>();
    expect(bottles).toHaveLength(0);
  });

  it('sets, keeps and clears the price paid', async () => {
    const auth = signup('price@b.com');
    const cellarId = await myCellarId(auth);
    const post = await app.request(`/api/cellars/${cellarId}/bottles`, { method: 'POST', body: JSON.stringify({ wineId, quantity: 1, pricePaid: 18.5 }), headers: { ...auth, 'content-type': 'application/json' } }, env);
    const created = await post.json<any>();
    expect(created.price_paid).toBe(18.5);
    const patch = (body: object) => app.request(`/api/bottles/${created.id}`, { method: 'PATCH', body: JSON.stringify(body), headers: { ...auth, 'content-type': 'application/json' } }, env);
    expect((await (await patch({ quantity: 2 })).json<any>()).price_paid).toBe(18.5);
    expect((await (await patch({ pricePaid: 22 })).json<any>()).price_paid).toBe(22);
    expect((await (await patch({ pricePaid: null })).json<any>()).price_paid).toBeNull();
    expect((await patch({ pricePaid: -3 })).status).toBe(400);
    expect((await patch({ pricePaid: 'tanto' })).status).toBe(400);
    expect((await (await patch({ quantity: 0 })).json<any>()).quantity).toBe(0);
    expect((await (await patch({ quantity: 6 })).json<any>()).quantity).toBe(6);
    for (const bad of [-1, 1.5, 'tre']) expect((await patch({ quantity: bad })).status, String(bad)).toBe(400);
    const badPost = await app.request(`/api/cellars/${cellarId}/bottles`, { method: 'POST', body: JSON.stringify({ wineId, quantity: 0 }), headers: { ...auth, 'content-type': 'application/json' } }, env);
    expect(badPost.status).toBe(400);
  });

  it('deletes a bottle that has a tasting note and a photo without 500ing, and cleans up both', async () => {
    const auth = signup('b4@b.com');
    const cellarId = await myCellarId(auth);
    const created = await (
      await app.request(
        `/api/cellars/${cellarId}/bottles`,
        { method: 'POST', body: JSON.stringify({ wineId, quantity: 1 }), headers: { ...auth, 'content-type': 'application/json' } },
        env,
      )
    ).json<{ id: number }>();

    await app.request(
      `/api/bottles/${created.id}/notes`,
      { method: 'POST', body: JSON.stringify({ rating: 4, text: 'buono' }), headers: { ...auth, 'content-type': 'application/json' } },
      env,
    );

    const JPEG_MAGIC = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const form = new FormData();
    form.append('file', new Blob([JPEG_MAGIC], { type: 'image/jpeg' }), 'label.jpg');
    await app.request(`/api/bottles/${created.id}/photos`, { method: 'POST', body: form, headers: auth }, env);

    const notesBefore = await env.DB.prepare('select count(*) as n from tasting_notes where bottle_id = ?').bind(created.id).first<{ n: number }>();
    const photosBefore = await env.DB.prepare('select count(*) as n from photos where bottle_id = ?').bind(created.id).first<{ n: number }>();
    expect(notesBefore!.n).toBe(1);
    expect(photosBefore!.n).toBe(1);

    const delRes = await app.request(`/api/bottles/${created.id}`, { method: 'DELETE', headers: auth }, env);
    expect(delRes.status).toBe(200);

    const notesAfter = await env.DB.prepare('select count(*) as n from tasting_notes where bottle_id = ?').bind(created.id).first<{ n: number }>();
    const photosAfter = await env.DB.prepare('select count(*) as n from photos where bottle_id = ?').bind(created.id).first<{ n: number }>();
    expect(notesAfter!.n).toBe(0);
    expect(photosAfter!.n).toBe(0);
  });

  const json = (auth: Record<string, string>, method: string, body: unknown) => ({ method, body: JSON.stringify(body), headers: { ...auth, 'content-type': 'application/json' } });

  async function setup(email: string, quantity: number) {
    const auth = signup(email);
    const cellarId = await myCellarId(auth);
    const created = await (await app.request(`/api/cellars/${cellarId}/bottles`, json(auth, 'POST', { wineId, quantity }), env)).json<{ id: number }>();
    const element = await (await app.request(`/api/cellars/${cellarId}/elements`, json(auth, 'POST', { kind: 'Scaffale', name: 'Scaffale A', tiers: 3, cols: 5, depth: 1 }), env)).json<{ id: number }>();
    return { auth, cellarId, bottleId: created.id, elementId: element.id };
  }

  it('puts each bottle of a wine in its own slot, up to the number of bottles', async () => {
    const { auth, cellarId, bottleId, elementId } = await setup('b5@b.com', 2);
    const first = await app.request(`/api/bottles/${bottleId}/places`, json(auth, 'POST', { elementId, tier: 1, col: 0, depth: 1 }), env);
    expect(first.status).toBe(200);
    const second = await app.request(`/api/bottles/${bottleId}/places`, json(auth, 'POST', { elementId, tier: 1, col: 1, depth: 1 }), env);
    expect((await second.json<any>()).places.map((p: any) => p.slot_col)).toEqual([0, 1]);
    const third = await app.request(`/api/bottles/${bottleId}/places`, json(auth, 'POST', { elementId, tier: 1, col: 2, depth: 1 }), env);
    expect(third.status).toBe(409);

    const bottles = await (await app.request(`/api/cellars/${cellarId}/bottles`, { headers: auth }, env)).json<any[]>();
    expect(bottles[0].places).toHaveLength(2);
    expect(bottles[0].places[0]).toMatchObject({ element_name: 'Scaffale A', element_kind: 'Scaffale', slot_tier: 1, slot_col: 0, slot_depth: 1 });
    expect(bottles[0].element_id).toBeUndefined();
  });

  it('refuses a taken slot or one outside the element, moves and frees a place', async () => {
    const { auth, bottleId, elementId } = await setup('b9@b.com', 2);
    const { places } = await (await app.request(`/api/bottles/${bottleId}/places`, json(auth, 'POST', { elementId, tier: 1, col: 0, depth: 1 }), env)).json<any>();
    expect((await app.request(`/api/bottles/${bottleId}/places`, json(auth, 'POST', { elementId, tier: 1, col: 0, depth: 1 }), env)).status).toBe(409);
    expect((await app.request(`/api/bottles/${bottleId}/places`, json(auth, 'POST', { elementId, tier: 4, col: 0, depth: 1 }), env)).status).toBe(400);

    const moved = await (await app.request(`/api/places/${places[0].id}`, json(auth, 'PATCH', { elementId, tier: 2, col: 3, depth: 1 }), env)).json<any>();
    expect(moved.places[0]).toMatchObject({ slot_tier: 2, slot_col: 3 });
    const freed = await (await app.request(`/api/places/${places[0].id}`, { method: 'DELETE', headers: auth }, env)).json<any>();
    expect(freed).toEqual({ bottleId, places: [] });
  });

  it('sets and clears the drinking window, refusing bad dates', async () => {
    const { auth, bottleId } = await setup('b11@b.com', 1);
    const set = await (await app.request(`/api/bottles/${bottleId}`, json(auth, 'PATCH', { drinkFrom: '2028-01-01', drinkUntil: '2040-12-31' }), env)).json<any>();
    expect([set.drink_from, set.drink_until]).toEqual(['2028-01-01', '2040-12-31']);
    const other = await (await app.request(`/api/bottles/${bottleId}`, json(auth, 'PATCH', { pricePaid: 20 }), env)).json<any>();
    expect(other.drink_from).toBe('2028-01-01');
    expect((await app.request(`/api/bottles/${bottleId}`, json(auth, 'PATCH', { drinkFrom: '2040-01-01', drinkUntil: '2030-12-31' }), env)).status).toBe(400);
    expect((await app.request(`/api/bottles/${bottleId}`, json(auth, 'PATCH', { drinkFrom: 'domani', drinkUntil: null }), env)).status).toBe(400);
    const cleared = await (await app.request(`/api/bottles/${bottleId}`, json(auth, 'PATCH', { drinkFrom: null, drinkUntil: null }), env)).json<any>();
    expect([cleared.drink_from, cleared.drink_until]).toEqual([null, null]);
  });

  it('frees the latest places when the number of bottles goes down', async () => {
    const { auth, bottleId, elementId } = await setup('b10@b.com', 2);
    await app.request(`/api/bottles/${bottleId}/places`, json(auth, 'POST', { elementId, tier: 1, col: 0, depth: 1 }), env);
    await app.request(`/api/bottles/${bottleId}/places`, json(auth, 'POST', { elementId, tier: 1, col: 1, depth: 1 }), env);
    const after = await (await app.request(`/api/bottles/${bottleId}`, json(auth, 'PATCH', { quantity: 1 }), env)).json<any>();
    expect(after.places.map((p: any) => p.slot_col)).toEqual([0]);
  });

  it('rejects placing a bottle in an element from a different cellar', async () => {
    const { auth: authA, bottleId } = await setup('b7@b.com', 1);
    const authB = signup('b8@b.com');
    const cellarB = await myCellarId(authB);
    const foreign = await (await app.request(`/api/cellars/${cellarB}/elements`, json(authB, 'POST', { kind: 'Scatolone', name: 'Altrui' }), env)).json<{ id: number }>();
    const res = await app.request(`/api/bottles/${bottleId}/places`, json(authA, 'POST', { elementId: foreign.id }), env);
    expect(res.status).toBe(400);
    const notMine = await app.request(`/api/bottles/${bottleId}/places`, json(authB, 'POST', { elementId: foreign.id }), env);
    expect(notMine.status).toBe(404);
  });
});
