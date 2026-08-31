import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { requireAuth } from '../src/lib/session';
import { signSession } from '../src/lib/auth';

function buildApp() {
  const app = new Hono<{ Bindings: { SESSION_SECRET: string } }>();
  app.use('/protected', requireAuth);
  app.get('/protected', (c) => c.json({ userId: c.get('userId' as never) }));
  return app;
}

describe('requireAuth', () => {
  const env = { SESSION_SECRET: 'test-secret' } as any;

  it('rejects a request with no cookie', async () => {
    const res = await buildApp().request('/protected', {}, env);
    expect(res.status).toBe(401);
  });

  it('accepts a request with a valid session cookie', async () => {
    const token = await signSession(7, env.SESSION_SECRET);
    const res = await buildApp().request('/protected', { headers: { cookie: `session=${token}` } }, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: 7 });
  });
});
