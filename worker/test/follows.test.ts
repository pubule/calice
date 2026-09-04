import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../src/index';

async function signup(email: string) {
  const auth = { 'X-Calice-Dev-Email': email };
  const me = await (await app.request('/api/auth/me', { headers: auth }, env)).json<{ id: number }>();
  return { auth, userId: me.id };
}

beforeEach(async () => {
  await env.DB.exec(
    'DELETE FROM activity_feed; DELETE FROM follows; DELETE FROM bottles; DELETE FROM wines; DELETE FROM cellar_members; DELETE FROM cellars; DELETE FROM users;',
  );
});

describe('follows + activity feed', () => {
  it('GET /lookup finds a user by exact email, case-insensitively, 404s when not found', async () => {
    const a = await signup('lookupa@b.com');
    const b = await signup('LookupB@b.com');

    const found = await app.request('/api/follows/lookup?email=LOOKUPB%40B.COM', { headers: a.auth }, env);
    expect(found.status).toBe(200);
    expect(await found.json()).toMatchObject({ id: b.userId, name: 'LookupB' });

    const missing = await app.request('/api/follows/lookup?email=nobody@b.com', { headers: a.auth }, env);
    expect(missing.status).toBe(404);
  });

  it('cannot follow yourself', async () => {
    const a = await signup('selfa@b.com');
    const res = await app.request(`/api/follows/${a.userId}`, { method: 'POST', headers: a.auth }, env);
    expect(res.status).toBe(400);
    const list = await (await app.request('/api/follows', { headers: a.auth }, env)).json<any[]>();
    expect(list).toHaveLength(0);
  });

  it('follow then unfollow', async () => {
    const a = await signup('fa@b.com');
    const b = await signup('fb@b.com');
    const followRes = await app.request(`/api/follows/${b.userId}`, { method: 'POST', headers: a.auth }, env);
    expect(followRes.status).toBe(200);
    const unfollowRes = await app.request(`/api/follows/${b.userId}`, { method: 'DELETE', headers: a.auth }, env);
    expect(unfollowRes.status).toBe(200);
  });

  it('GET / lists followees and reflects unfollow', async () => {
    const a = await signup('lista@b.com');
    const b = await signup('listb@b.com');
    await app.request(`/api/follows/${b.userId}`, { method: 'POST', headers: a.auth }, env);

    const afterFollow = await (await app.request('/api/follows', { headers: a.auth }, env)).json<any[]>();
    expect(afterFollow).toHaveLength(1);
    expect(afterFollow[0]).toMatchObject({ id: b.userId, name: 'listb' });

    await app.request(`/api/follows/${b.userId}`, { method: 'DELETE', headers: a.auth }, env);
    const afterUnfollow = await (await app.request('/api/follows', { headers: a.auth }, env)).json<any[]>();
    expect(afterUnfollow).toHaveLength(0);
  });

  it('activity feed shows a followed user\'s bottle-add', async () => {
    const a = await signup('feeda@b.com');
    const b = await signup('feedb@b.com');
    await app.request(`/api/follows/${b.userId}`, { method: 'POST', headers: a.auth }, env);

    const bCellarId = (await (await app.request('/api/cellars', { headers: b.auth }, env)).json<any[]>())[0].id;
    const wine = await env.DB.prepare(`insert into wines (name, producer, country, type, source) values ('Franciacorta Brut', 'Ca'' del Bosco', 'Italia', 'bollicine', 'catalog') returning id`).first<{ id: number }>();
    await app.request(
      `/api/cellars/${bCellarId}/bottles`,
      { method: 'POST', body: JSON.stringify({ wineId: wine!.id, quantity: 2 }), headers: { ...b.auth, 'content-type': 'application/json' } },
      env,
    );

    // unrelated user x: a neither follows x nor shares a cellar with x
    const x = await signup('feedx@b.com');
    const xCellarId = (await (await app.request('/api/cellars', { headers: x.auth }, env)).json<any[]>())[0].id;
    const otherWine = await env.DB.prepare(`insert into wines (name, producer, country, type, source) values ('Barolo Riserva', 'Altro', 'Italia', 'rosso', 'catalog') returning id`).first<{ id: number }>();
    await app.request(
      `/api/cellars/${xCellarId}/bottles`,
      { method: 'POST', body: JSON.stringify({ wineId: otherWine!.id, quantity: 1 }), headers: { ...x.auth, 'content-type': 'application/json' } },
      env,
    );

    const feed = await (await app.request('/api/me/activity', { headers: a.auth }, env)).json<any[]>();
    expect(feed).toHaveLength(1);
    expect(feed[0].wine_name).toBe('Franciacorta Brut');
    expect(feed[0].actor_name).toBe('feedb');
    expect(feed.some((row) => row.wine_name === 'Barolo Riserva')).toBe(false);
  });
});
