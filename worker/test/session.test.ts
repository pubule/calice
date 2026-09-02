import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { requireAuth } from '../src/lib/session';

function buildApp() {
  const app = new Hono<{ Bindings: typeof env; Variables: { userId: number } }>();
  app.use('/protected', requireAuth);
  app.get('/protected', (c) => c.json({ userId: c.get('userId') }));
  return app;
}

beforeEach(async () => {
  await env.DB.exec('DELETE FROM cellar_members; DELETE FROM cellars; DELETE FROM users;');
});

describe('requireAuth', () => {
  it('rejects a request with no dev-email override and no Access JWT', async () => {
    const noDevEmail = { ...env, CALICE_DEV_EMAIL: undefined };
    const res = await buildApp().request('/protected', {}, noDevEmail);
    expect(res.status).toBe(401);
  });

  it('accepts the X-Calice-Dev-Email header and creates the user', async () => {
    const res = await buildApp().request('/protected', { headers: { 'X-Calice-Dev-Email': 'session@b.com' } }, env);
    expect(res.status).toBe(200);
    const user = await env.DB.prepare('select id from users where email = ?').bind('session@b.com').first<{ id: number }>();
    expect(await res.json()).toEqual({ userId: user!.id });
  });
});
