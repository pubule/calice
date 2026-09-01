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

const JPEG_MAGIC = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

let bottleId: number;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM photos; DELETE FROM bottles; DELETE FROM wines; DELETE FROM cellar_members; DELETE FROM cellars; DELETE FROM users;');
  const cookie = await signup('p1@b.com');
  const cellarId = (await (await app.request('/api/cellars', { headers: { cookie } }, env)).json<any[]>())[0].id;
  const wine = await env.DB.prepare(`insert into wines (name, producer, country, type, source) values ('Barolo DOCG', 'Elio Altare', 'Italia', 'rosso', 'catalog') returning id`).first<{ id: number }>();
  const bottle = await app.request(
    `/api/cellars/${cellarId}/bottles`,
    { method: 'POST', body: JSON.stringify({ wineId: wine!.id, quantity: 1 }), headers: { cookie, 'content-type': 'application/json' } },
    env,
  );
  bottleId = (await bottle.json<{ id: number }>()).id;
});

describe('photos', () => {
  it('uploads a photo and lists it back with a fetchable url', async () => {
    const cookie = await signup('p2@b.com');
    const cellarId = (await (await app.request('/api/cellars', { headers: { cookie } }, env)).json<any[]>())[0].id;
    // give p2 access by making them a member of the same cellar as the bottle
    await env.DB.prepare('insert into cellar_members (cellar_id, user_id, role) values ((select cellar_id from bottles where id = ?), (select id from users where email = ?), ?)').bind(bottleId, 'p2@b.com', 'member').run();

    const form = new FormData();
    form.append('file', new Blob([JPEG_MAGIC], { type: 'image/jpeg' }), 'label.jpg');

    const uploadRes = await app.request(`/api/bottles/${bottleId}/photos`, { method: 'POST', body: form, headers: { cookie } }, env);
    expect(uploadRes.status).toBe(200);
    const uploaded = await uploadRes.json<{ id: number; url: string }>();

    const listRes = await app.request(`/api/bottles/${bottleId}/photos`, { headers: { cookie } }, env);
    const list = await listRes.json<any[]>();
    expect(list).toHaveLength(1);

    const fileRes = await app.request(uploaded.url, { headers: { cookie } }, env);
    expect(fileRes.status).toBe(200);
    expect(fileRes.headers.get('content-type')).toBe('image/jpeg');
    expect(fileRes.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await fileRes.arrayBuffer()).toBeTruthy();
  });

  it('rejects an upload whose bytes are not a real image, even with a spoofed content-type', async () => {
    const cookie = await signup('p3@b.com');
    await env.DB.prepare('insert into cellar_members (cellar_id, user_id, role) values ((select cellar_id from bottles where id = ?), (select id from users where email = ?), ?)').bind(bottleId, 'p3@b.com', 'member').run();

    const form = new FormData();
    form.append('file', new Blob(['<script>alert(1)</script>'], { type: 'image/jpeg' }), 'evil.jpg');

    const uploadRes = await app.request(`/api/bottles/${bottleId}/photos`, { method: 'POST', body: form, headers: { cookie } }, env);
    expect(uploadRes.status).toBe(400);

    const photoCount = await env.DB.prepare('select count(*) as n from photos where bottle_id = ?').bind(bottleId).first<{ n: number }>();
    expect(photoCount!.n).toBe(0);
  });

  it('requires a session to fetch a photo by key', async () => {
    const cookie = await signup('p4@b.com');
    await env.DB.prepare('insert into cellar_members (cellar_id, user_id, role) values ((select cellar_id from bottles where id = ?), (select id from users where email = ?), ?)').bind(bottleId, 'p4@b.com', 'member').run();

    const form = new FormData();
    form.append('file', new Blob([JPEG_MAGIC], { type: 'image/jpeg' }), 'label.jpg');
    const uploadRes = await app.request(`/api/bottles/${bottleId}/photos`, { method: 'POST', body: form, headers: { cookie } }, env);
    const uploaded = await uploadRes.json<{ id: number; url: string }>();

    const fileRes = await app.request(uploaded.url, {}, env);
    expect(fileRes.status).toBe(401);
  });

  it('hides a photo from a caller who is not a member of the bottle cellar', async () => {
    const memberCookie = await signup('p5@b.com');
    await env.DB.prepare('insert into cellar_members (cellar_id, user_id, role) values ((select cellar_id from bottles where id = ?), (select id from users where email = ?), ?)').bind(bottleId, 'p5@b.com', 'member').run();

    const form = new FormData();
    form.append('file', new Blob([JPEG_MAGIC], { type: 'image/jpeg' }), 'label.jpg');
    const uploadRes = await app.request(`/api/bottles/${bottleId}/photos`, { method: 'POST', body: form, headers: { cookie: memberCookie } }, env);
    const uploaded = await uploadRes.json<{ id: number; url: string }>();

    const outsiderCookie = await signup('outsider@b.com');
    const fileRes = await app.request(uploaded.url, { headers: { cookie: outsiderCookie } }, env);
    expect(fileRes.status).toBe(404);
  });
});
