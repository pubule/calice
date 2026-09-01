import { Hono } from 'hono';
import { requireAuth } from '../lib/session';
import type { Env } from '../index';

export const pushRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
pushRoutes.use('*', requireAuth);

pushRoutes.post('/subscribe', async (c) => {
  const body = await c.req.json<{ endpoint: string; keys: { p256dh: string; auth: string } }>();
  await c.env.DB
    .prepare(
      `insert into push_subscriptions (user_id, endpoint, p256dh, auth) values (?, ?, ?, ?)
       on conflict(endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth`,
    )
    .bind(c.get('userId'), body.endpoint, body.keys.p256dh, body.keys.auth)
    .run();
  return c.json({ ok: true });
});
