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
    'DELETE FROM activity_feed; DELETE FROM photos; DELETE FROM tasting_notes; DELETE FROM bottles; DELETE FROM wines; DELETE FROM cellar_members; DELETE FROM cellars; DELETE FROM users;',
  );
  const wine = await env.DB
    .prepare(`insert into wines (name, producer, country, type, source) values ('Barolo DOCG', 'Elio Altare', 'Italia', 'rosso', 'catalog') returning id`)
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

  it('assigns a bottle to a cellar element slot, and the list join surfaces the element name/kind', async () => {
    const auth = signup('b5@b.com');
    const cellarId = await myCellarId(auth);
    const created = await (
      await app.request(
        `/api/cellars/${cellarId}/bottles`,
        { method: 'POST', body: JSON.stringify({ wineId, quantity: 1 }), headers: { ...auth, 'content-type': 'application/json' } },
        env,
      )
    ).json<{ id: number }>();
    const element = await (
      await app.request(
        `/api/cellars/${cellarId}/elements`,
        { method: 'POST', body: JSON.stringify({ kind: 'Scaffale', name: 'Scaffale A', tiers: 3, cols: 5, depth: 1 }), headers: { ...auth, 'content-type': 'application/json' } },
        env,
      )
    ).json<{ id: number }>();

    const patchRes = await app.request(
      `/api/bottles/${created.id}/location`,
      { method: 'PATCH', body: JSON.stringify({ elementId: element.id, tier: 1, col: 2, depth: 1 }), headers: { ...auth, 'content-type': 'application/json' } },
      env,
    );
    expect(patchRes.status).toBe(200);
    const patched = await patchRes.json<any>();
    expect(patched.element_id).toBe(element.id);
    expect(patched.slot_col).toBe(2);

    const bottles = await (await app.request(`/api/cellars/${cellarId}/bottles`, { headers: auth }, env)).json<any[]>();
    expect(bottles[0].element_name).toBe('Scaffale A');
    expect(bottles[0].element_kind).toBe('Scaffale');
  });

  it('rejects assigning a bottle to an element from a different cellar', async () => {
    const authA = signup('b7@b.com');
    const cellarA = await myCellarId(authA);
    const created = await (
      await app.request(
        `/api/cellars/${cellarA}/bottles`,
        { method: 'POST', body: JSON.stringify({ wineId, quantity: 1 }), headers: { ...authA, 'content-type': 'application/json' } },
        env,
      )
    ).json<{ id: number }>();

    const authB = signup('b8@b.com');
    const cellarB = await myCellarId(authB);
    const foreignElement = await (
      await app.request(
        `/api/cellars/${cellarB}/elements`,
        { method: 'POST', body: JSON.stringify({ kind: 'Scatolone', name: 'Altrui' }), headers: { ...authB, 'content-type': 'application/json' } },
        env,
      )
    ).json<{ id: number }>();

    const res = await app.request(
      `/api/bottles/${created.id}/location`,
      { method: 'PATCH', body: JSON.stringify({ elementId: foreignElement.id }), headers: { ...authA, 'content-type': 'application/json' } },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('clears a slot back to unassigned by sending elementId null', async () => {
    const auth = signup('b6@b.com');
    const cellarId = await myCellarId(auth);
    const created = await (
      await app.request(
        `/api/cellars/${cellarId}/bottles`,
        { method: 'POST', body: JSON.stringify({ wineId, quantity: 1 }), headers: { ...auth, 'content-type': 'application/json' } },
        env,
      )
    ).json<{ id: number }>();
    await app.request(
      `/api/bottles/${created.id}/location`,
      { method: 'PATCH', body: JSON.stringify({ elementId: null }), headers: { ...auth, 'content-type': 'application/json' } },
      env,
    );
    const bottles = await (await app.request(`/api/cellars/${cellarId}/bottles`, { headers: auth }, env)).json<any[]>();
    expect(bottles[0].element_id).toBeNull();
  });
});
