import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../src/index';

async function signup(email: string) {
  const res = await app.request(
    '/api/auth/signup',
    { method: 'POST', body: JSON.stringify({ email, password: 'secret123', name: email }), headers: { 'content-type': 'application/json' } },
    env,
  );
  const cookie = res.headers.get('set-cookie')!.split(';')[0];
  const me = await (await app.request('/api/auth/me', { headers: { cookie } }, env)).json<{ id: number }>();
  return { cookie, userId: me.id };
}

beforeEach(async () => {
  await env.DB.exec(
    'DELETE FROM activity_feed; DELETE FROM follows; DELETE FROM bottles; DELETE FROM wines; DELETE FROM cellar_members; DELETE FROM cellars; DELETE FROM users;',
  );
});

describe('follows + activity feed', () => {
  it('follow then unfollow', async () => {
    const a = await signup('fa@b.com');
    const b = await signup('fb@b.com');
    const followRes = await app.request(`/api/follows/${b.userId}`, { method: 'POST', headers: { cookie: a.cookie } }, env);
    expect(followRes.status).toBe(200);
    const unfollowRes = await app.request(`/api/follows/${b.userId}`, { method: 'DELETE', headers: { cookie: a.cookie } }, env);
    expect(unfollowRes.status).toBe(200);
  });

  it('activity feed shows a followed user\'s bottle-add', async () => {
    const a = await signup('feeda@b.com');
    const b = await signup('feedb@b.com');
    await app.request(`/api/follows/${b.userId}`, { method: 'POST', headers: { cookie: a.cookie } }, env);

    const bCellarId = (await (await app.request('/api/cellars', { headers: { cookie: b.cookie } }, env)).json<any[]>())[0].id;
    const wine = await env.DB.prepare(`insert into wines (name, producer, country, type, source) values ('Franciacorta Brut', 'Ca'' del Bosco', 'Italia', 'bollicine', 'catalog') returning id`).first<{ id: number }>();
    await app.request(
      `/api/cellars/${bCellarId}/bottles`,
      { method: 'POST', body: JSON.stringify({ wineId: wine!.id, quantity: 2 }), headers: { cookie: b.cookie, 'content-type': 'application/json' } },
      env,
    );

    const feed = await (await app.request('/api/me/activity', { headers: { cookie: a.cookie } }, env)).json<any[]>();
    expect(feed).toHaveLength(1);
    expect(feed[0].wine_name).toBe('Franciacorta Brut');
    expect(feed[0].actor_name).toBe('feedb@b.com');
  });
});
