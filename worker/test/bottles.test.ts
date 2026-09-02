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
    const cookie = await signup('b1@b.com');
    const cellarId = await myCellarId(cookie);

    const createRes = await app.request(
      `/api/cellars/${cellarId}/bottles`,
      { method: 'POST', body: JSON.stringify({ wineId, quantity: 3, pricePaid: 24, shelfLocation: 'Scaffale A3' }), headers: { cookie, 'content-type': 'application/json' } },
      env,
    );
    expect(createRes.status).toBe(200);

    const listRes = await app.request(`/api/cellars/${cellarId}/bottles`, { headers: { cookie } }, env);
    const bottles = await listRes.json<any[]>();
    expect(bottles).toHaveLength(1);
    expect(bottles[0].score).toBeNull();
    expect(bottles[0].name).toBe('Barolo DOCG');

    const feed = await env.DB.prepare('select count(*) as n from activity_feed where action = ?').bind('added').first<{ n: number }>();
    expect(feed!.n).toBe(1);
  });

  it('computes score as the average tasting_notes rating', async () => {
    const cookie = await signup('b2@b.com');
    const cellarId = await myCellarId(cookie);
    const created = await (
      await app.request(
        `/api/cellars/${cellarId}/bottles`,
        { method: 'POST', body: JSON.stringify({ wineId, quantity: 1 }), headers: { cookie, 'content-type': 'application/json' } },
        env,
      )
    ).json<{ id: number }>();

    const userId = (await app.request('/api/auth/me', { headers: { cookie } }, env).then((r) => r.json<{ id: number }>())).id;
    await env.DB.prepare('insert into tasting_notes (bottle_id, user_id, rating, text) values (?, ?, ?, ?)').bind(created.id, userId, 4, 'buono').run();
    await env.DB.prepare('insert into tasting_notes (bottle_id, user_id, rating, text) values (?, ?, ?, ?)').bind(created.id, userId, 5, 'ottimo').run();

    const bottles = await (await app.request(`/api/cellars/${cellarId}/bottles`, { headers: { cookie } }, env)).json<any[]>();
    expect(bottles[0].score).toBe(4.5);
  });

  it('rejects a non-member with 403', async () => {
    const cookieA = await signup('owner2@b.com');
    const cellarId = await myCellarId(cookieA);
    const cookieB = await signup('stranger@b.com');
    const res = await app.request(`/api/cellars/${cellarId}/bottles`, { headers: { cookie: cookieB } }, env);
    expect(res.status).toBe(403);
  });

  it('updates and deletes a bottle', async () => {
    const cookie = await signup('b3@b.com');
    const cellarId = await myCellarId(cookie);
    const created = await (
      await app.request(
        `/api/cellars/${cellarId}/bottles`,
        { method: 'POST', body: JSON.stringify({ wineId, quantity: 1 }), headers: { cookie, 'content-type': 'application/json' } },
        env,
      )
    ).json<{ id: number }>();

    const patchRes = await app.request(
      `/api/bottles/${created.id}`,
      { method: 'PATCH', body: JSON.stringify({ quantity: 5, shelfLocation: 'Frigo' }), headers: { cookie, 'content-type': 'application/json' } },
      env,
    );
    expect(patchRes.status).toBe(200);

    const delRes = await app.request(`/api/bottles/${created.id}`, { method: 'DELETE', headers: { cookie } }, env);
    expect(delRes.status).toBe(200);
    const bottles = await (await app.request(`/api/cellars/${cellarId}/bottles`, { headers: { cookie } }, env)).json<any[]>();
    expect(bottles).toHaveLength(0);
  });

  it('deletes a bottle that has a tasting note and a photo without 500ing, and cleans up both', async () => {
    const cookie = await signup('b4@b.com');
    const cellarId = await myCellarId(cookie);
    const created = await (
      await app.request(
        `/api/cellars/${cellarId}/bottles`,
        { method: 'POST', body: JSON.stringify({ wineId, quantity: 1 }), headers: { cookie, 'content-type': 'application/json' } },
        env,
      )
    ).json<{ id: number }>();

    await app.request(
      `/api/bottles/${created.id}/notes`,
      { method: 'POST', body: JSON.stringify({ rating: 4, text: 'buono' }), headers: { cookie, 'content-type': 'application/json' } },
      env,
    );

    const JPEG_MAGIC = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const form = new FormData();
    form.append('file', new Blob([JPEG_MAGIC], { type: 'image/jpeg' }), 'label.jpg');
    await app.request(`/api/bottles/${created.id}/photos`, { method: 'POST', body: form, headers: { cookie } }, env);

    const notesBefore = await env.DB.prepare('select count(*) as n from tasting_notes where bottle_id = ?').bind(created.id).first<{ n: number }>();
    const photosBefore = await env.DB.prepare('select count(*) as n from photos where bottle_id = ?').bind(created.id).first<{ n: number }>();
    expect(notesBefore!.n).toBe(1);
    expect(photosBefore!.n).toBe(1);

    const delRes = await app.request(`/api/bottles/${created.id}`, { method: 'DELETE', headers: { cookie } }, env);
    expect(delRes.status).toBe(200);

    const notesAfter = await env.DB.prepare('select count(*) as n from tasting_notes where bottle_id = ?').bind(created.id).first<{ n: number }>();
    const photosAfter = await env.DB.prepare('select count(*) as n from photos where bottle_id = ?').bind(created.id).first<{ n: number }>();
    expect(notesAfter!.n).toBe(0);
    expect(photosAfter!.n).toBe(0);
  });
});
