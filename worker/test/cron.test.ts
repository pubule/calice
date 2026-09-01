import { describe, it, expect, vi, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../src/index';
import { runNotificationScan } from '../src/cron';

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
    'DELETE FROM push_subscriptions; DELETE FROM bottles; DELETE FROM wines; DELETE FROM cellar_members; DELETE FROM cellars; DELETE FROM users;',
  );
});

describe('runNotificationScan', () => {
  it('sends one push per subscribed user with a bottle in its drink window', async () => {
    const user = await signup('cron@b.com');
    const cellarId = (await (await app.request('/api/cellars', { headers: { cookie: user.cookie } }, env)).json<any[]>())[0].id;
    const wine = await env.DB.prepare(`insert into wines (name, producer, country, type, source) values ('Barolo DOCG', 'Elio Altare', 'Italia', 'rosso', 'catalog') returning id`).first<{ id: number }>();
    await env.DB
      .prepare(`insert into bottles (cellar_id, wine_id, quantity, drink_from, drink_until, added_by) values (?, ?, 1, date('now','-1 day'), date('now','+30 day'), ?)`)
      .bind(cellarId, wine!.id, user.userId)
      .run();
    await app.request(
      '/api/push/subscribe',
      { method: 'POST', body: JSON.stringify({ endpoint: 'https://push.example/xyz', keys: { p256dh: 'k', auth: 'a' } }), headers: { cookie: user.cookie, 'content-type': 'application/json' } },
      env,
    );

    const sendFn = vi.fn().mockResolvedValue(undefined);
    const result = await runNotificationScan(env as any, sendFn);

    expect(result.notified).toBe(1);
    expect(sendFn).toHaveBeenCalledTimes(1);
    const [subscription, payload] = sendFn.mock.calls[0];
    expect(subscription.endpoint).toBe('https://push.example/xyz');
    expect(JSON.parse(payload).body).toContain('Barolo DOCG');
  });

  it('sends nothing when no bottle qualifies', async () => {
    await signup('quiet@b.com');
    const sendFn = vi.fn();
    const result = await runNotificationScan(env as any, sendFn);
    expect(result.notified).toBe(0);
    expect(sendFn).not.toHaveBeenCalled();
  });
});
