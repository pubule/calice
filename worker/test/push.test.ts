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

beforeEach(async () => {
  await env.DB.exec('DELETE FROM push_subscriptions; DELETE FROM cellar_members; DELETE FROM cellars; DELETE FROM users;');
});

describe('POST /api/push/subscribe', () => {
  it('stores a subscription and re-subscribing does not duplicate it', async () => {
    const cookie = await signup('push@b.com');
    const body = JSON.stringify({ endpoint: 'https://push.example/abc', keys: { p256dh: 'key1', auth: 'auth1' } });
    await app.request('/api/push/subscribe', { method: 'POST', body, headers: { cookie, 'content-type': 'application/json' } }, env);
    const res2 = await app.request('/api/push/subscribe', { method: 'POST', body, headers: { cookie, 'content-type': 'application/json' } }, env);
    expect(res2.status).toBe(200);
    const count = await env.DB.prepare('select count(*) as n from push_subscriptions').first<{ n: number }>();
    expect(count!.n).toBe(1);
  });

  it('reassigns endpoint ownership when a different user subscribes with the same endpoint', async () => {
    const cookie1 = await signup('push1@b.com');
    const cookie2 = await signup('push2@b.com');
    const endpoint = 'https://push.example/shared';
    const body = JSON.stringify({ endpoint, keys: { p256dh: 'key1', auth: 'auth1' } });

    // First user subscribes
    const user1 = await env.DB.prepare('select id from users where email = ?').bind('push1@b.com').first<{ id: number }>();
    await app.request('/api/push/subscribe', { method: 'POST', body, headers: { cookie: cookie1, 'content-type': 'application/json' } }, env);

    // Second user subscribes with same endpoint
    const user2 = await env.DB.prepare('select id from users where email = ?').bind('push2@b.com').first<{ id: number }>();
    await app.request('/api/push/subscribe', { method: 'POST', body, headers: { cookie: cookie2, 'content-type': 'application/json' } }, env);

    // Should still be one row
    const count = await env.DB.prepare('select count(*) as n from push_subscriptions').first<{ n: number }>();
    expect(count!.n).toBe(1);

    // But user_id should be user2's id
    const sub = await env.DB.prepare('select user_id from push_subscriptions where endpoint = ?').bind(endpoint).first<{ user_id: number }>();
    expect(sub!.user_id).toBe(user2!.id);
  });
});
