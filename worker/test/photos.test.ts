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
    form.append('file', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }), 'label.jpg');

    const uploadRes = await app.request(`/api/bottles/${bottleId}/photos`, { method: 'POST', body: form, headers: { cookie } }, env);
    expect(uploadRes.status).toBe(200);
    const uploaded = await uploadRes.json<{ id: number; url: string }>();

    const listRes = await app.request(`/api/bottles/${bottleId}/photos`, { headers: { cookie } }, env);
    const list = await listRes.json<any[]>();
    expect(list).toHaveLength(1);

    const fileRes = await app.request(uploaded.url, {}, env);
    expect(fileRes.status).toBe(200);
    expect(await fileRes.arrayBuffer()).toBeTruthy();
  });
});
