import { describe, it, expect, vi, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../src/index';
import { runNotificationScan, checkPhotoStorageUsage, checkSearchUsage } from '../src/cron';

async function signup(email: string) {
  const auth = { 'X-Calice-Dev-Email': email };
  const me = await (await app.request('/api/auth/me', { headers: auth }, env)).json<{ id: number }>();
  return { auth, userId: me.id };
}

beforeEach(async () => {
  await env.DB.exec(
    'DELETE FROM push_subscriptions; DELETE FROM bottles; DELETE FROM wines; DELETE FROM cellar_members; DELETE FROM cellars; DELETE FROM users; DELETE FROM tavily_usage;',
  );
});

describe('runNotificationScan', () => {
  it('sends one push per subscribed user with a bottle in its drink window', async () => {
    const user = await signup('cron@b.com');
    const cellarId = (await (await app.request('/api/cellars', { headers: user.auth }, env)).json<any[]>())[0].id;
    const wine = await env.DB.prepare(`insert into wines (name, producer, country, type, source) values ('Barolo DOCG', 'Elio Altare', 'Italia', 'rosso', 'catalog') returning id`).first<{ id: number }>();
    await env.DB
      .prepare(`insert into bottles (cellar_id, wine_id, quantity, drink_from, drink_until, added_by) values (?, ?, 1, date('now','-1 day'), date('now','+30 day'), ?)`)
      .bind(cellarId, wine!.id, user.userId)
      .run();
    await app.request(
      '/api/push/subscribe',
      { method: 'POST', body: JSON.stringify({ endpoint: 'https://push.example/xyz', keys: { p256dh: 'k', auth: 'a' } }), headers: { ...user.auth, 'content-type': 'application/json' } },
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

  it('keeps scanning past a dead subscription: the other subscriber still gets notified, and the dead row is removed', async () => {
    const wine = await env.DB.prepare(`insert into wines (name, producer, country, type, source) values ('Barolo DOCG', 'Elio Altare', 'Italia', 'rosso', 'catalog') returning id`).first<{ id: number }>();

    const dead = await signup('dead@b.com');
    const deadCellarId = (await (await app.request('/api/cellars', { headers: dead.auth }, env)).json<any[]>())[0].id;
    await env.DB
      .prepare(`insert into bottles (cellar_id, wine_id, quantity, drink_from, drink_until, added_by) values (?, ?, 1, date('now','-1 day'), date('now','+30 day'), ?)`)
      .bind(deadCellarId, wine!.id, dead.userId)
      .run();
    await app.request(
      '/api/push/subscribe',
      { method: 'POST', body: JSON.stringify({ endpoint: 'https://push.example/dead', keys: { p256dh: 'k', auth: 'a' } }), headers: { ...dead.auth, 'content-type': 'application/json' } },
      env,
    );

    const alive = await signup('alive@b.com');
    const aliveCellarId = (await (await app.request('/api/cellars', { headers: alive.auth }, env)).json<any[]>())[0].id;
    await env.DB
      .prepare(`insert into bottles (cellar_id, wine_id, quantity, drink_from, drink_until, added_by) values (?, ?, 1, date('now','-1 day'), date('now','+30 day'), ?)`)
      .bind(aliveCellarId, wine!.id, alive.userId)
      .run();
    await app.request(
      '/api/push/subscribe',
      { method: 'POST', body: JSON.stringify({ endpoint: 'https://push.example/alive', keys: { p256dh: 'k', auth: 'a' } }), headers: { ...alive.auth, 'content-type': 'application/json' } },
      env,
    );

    const sendFn = vi.fn().mockImplementation((subscription: { endpoint: string }) => {
      if (subscription.endpoint === 'https://push.example/dead') return Promise.reject(new Error('410 Gone'));
      return Promise.resolve(undefined);
    });

    const result = await runNotificationScan(env as any, sendFn);
    expect(result.notified).toBe(1);
    expect(sendFn).toHaveBeenCalledTimes(2);

    const remaining = await env.DB.prepare('select endpoint from push_subscriptions').all<{ endpoint: string }>();
    expect(remaining.results.map((r) => r.endpoint)).toEqual(['https://push.example/alive']);
  });
});

describe('checkPhotoStorageUsage', () => {
  it('does nothing when usage is below the 80% warning threshold', async () => {
    const sendFn = vi.fn();
    const result = await checkPhotoStorageUsage(env as any, sendFn);
    expect(result.warned).toBe(false);
    expect(sendFn).not.toHaveBeenCalled();
  });

  it('warns every subscriber once usage crosses 80% of the 10GB free tier', async () => {
    const user = await signup('storage@b.com');
    await app.request(
      '/api/push/subscribe',
      { method: 'POST', body: JSON.stringify({ endpoint: 'https://push.example/storage', keys: { p256dh: 'k', auth: 'a' } }), headers: { ...user.auth, 'content-type': 'application/json' } },
      env,
    );

    // Fakes only the R2 .list() call so the test doesn't need to actually
    // store 9GB of objects — checkPhotoStorageUsage never reads object
    // bodies, only the sizes list() reports.
    const bigBucketEnv = { ...env, PHOTOS: { list: vi.fn().mockResolvedValue({ objects: [{ size: 9 * 1024 ** 3 }], truncated: false }) } };
    const sendFn = vi.fn().mockResolvedValue(undefined);
    const result = await checkPhotoStorageUsage(bigBucketEnv as any, sendFn);

    expect(result.warned).toBe(true);
    expect(sendFn).toHaveBeenCalledTimes(1);
    const [subscription, payload] = sendFn.mock.calls[0];
    expect(subscription.endpoint).toBe('https://push.example/storage');
    expect(JSON.parse(payload).body).toContain('9.0 GB');
  });
});

describe('checkSearchUsage', () => {
  it('does nothing when usage is below the 80% warning threshold', async () => {
    await env.DB.prepare('insert into tavily_usage (credits) values (?)').bind(100).run();
    const sendFn = vi.fn();
    const result = await checkSearchUsage(env as any, sendFn);
    expect(result.warned).toBe(false);
    expect(sendFn).not.toHaveBeenCalled();
  });

  it('warns every subscriber once usage crosses 80% of the 1000 free monthly credits', async () => {
    const user = await signup('search@b.com');
    await app.request(
      '/api/push/subscribe',
      { method: 'POST', body: JSON.stringify({ endpoint: 'https://push.example/search', keys: { p256dh: 'k', auth: 'a' } }), headers: { ...user.auth, 'content-type': 'application/json' } },
      env,
    );
    await env.DB.prepare('insert into tavily_usage (credits) values (?)').bind(850).run();

    const sendFn = vi.fn().mockResolvedValue(undefined);
    const result = await checkSearchUsage(env as any, sendFn);

    expect(result.warned).toBe(true);
    expect(sendFn).toHaveBeenCalledTimes(1);
    const [subscription, payload] = sendFn.mock.calls[0];
    expect(subscription.endpoint).toBe('https://push.example/search');
    expect(JSON.parse(payload).body).toContain('850');
  });

  it('ignores credits logged before the start of the current month', async () => {
    await env.DB.prepare(`insert into tavily_usage (credits, created_at) values (?, date('now', 'start of month', '-1 day'))`).bind(900).run();
    const sendFn = vi.fn();
    const result = await checkSearchUsage(env as any, sendFn);
    expect(result.totalCredits).toBe(0);
    expect(result.warned).toBe(false);
    expect(sendFn).not.toHaveBeenCalled();
  });
});
