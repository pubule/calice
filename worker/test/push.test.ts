import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../src/index';

function signup(email: string) {
  return { 'X-Calice-Dev-Email': email };
}

beforeEach(async () => {
  await env.DB.exec('DELETE FROM push_subscriptions; DELETE FROM cellar_members; DELETE FROM cellars; DELETE FROM users;');
});

describe('POST /api/push/subscribe', () => {
  it('stores a subscription and re-subscribing does not duplicate it', async () => {
    const auth = signup('push@b.com');
    const body = JSON.stringify({ endpoint: 'https://push.example/abc', keys: { p256dh: 'key1', auth: 'auth1' } });
    await app.request('/api/push/subscribe', { method: 'POST', body, headers: { ...auth, 'content-type': 'application/json' } }, env);
    const res2 = await app.request('/api/push/subscribe', { method: 'POST', body, headers: { ...auth, 'content-type': 'application/json' } }, env);
    expect(res2.status).toBe(200);
    const count = await env.DB.prepare('select count(*) as n from push_subscriptions').first<{ n: number }>();
    expect(count!.n).toBe(1);
  });

  it('reassigns endpoint ownership when a different user subscribes with the same endpoint', async () => {
    const auth1 = signup('push1@b.com');
    const auth2 = signup('push2@b.com');
    const endpoint = 'https://push.example/shared';
    const body = JSON.stringify({ endpoint, keys: { p256dh: 'key1', auth: 'auth1' } });

    // First user subscribes (this is also what creates their user row)
    await app.request('/api/push/subscribe', { method: 'POST', body, headers: { ...auth1, 'content-type': 'application/json' } }, env);
    const user1 = await env.DB.prepare('select id from users where email = ?').bind('push1@b.com').first<{ id: number }>();

    // Second user subscribes with same endpoint
    await app.request('/api/push/subscribe', { method: 'POST', body, headers: { ...auth2, 'content-type': 'application/json' } }, env);
    const user2 = await env.DB.prepare('select id from users where email = ?').bind('push2@b.com').first<{ id: number }>();

    // Should still be one row
    const count = await env.DB.prepare('select count(*) as n from push_subscriptions').first<{ n: number }>();
    expect(count!.n).toBe(1);

    // But user_id should be user2's id
    const sub = await env.DB.prepare('select user_id from push_subscriptions where endpoint = ?').bind(endpoint).first<{ user_id: number }>();
    expect(sub!.user_id).toBe(user2!.id);
    expect(user1!.id).not.toBe(user2!.id);
  });
});
