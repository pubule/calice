import { Hono } from 'hono';
import { requireAuth } from '../lib/session';
import type { Env } from '../index';

export const authRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();

// Login/logout/signup don't exist here: Cloudflare Access gates the whole
// site before any request reaches the Worker. requireAuth creates the user
// row (and their first cellar) on their very first authenticated request.
authRoutes.get('/me', requireAuth, async (c) => {
  const user = await c.env.DB.prepare('select id, email, name from users where id = ?').bind(c.get('userId')).first();
  return c.json(user);
});
