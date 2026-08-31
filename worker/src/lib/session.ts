import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import { verifySession } from './auth';
import type { Env } from '../index';

export const requireAuth = createMiddleware<{ Bindings: Env; Variables: { userId: number } }>(
  async (c, next) => {
    const token = getCookie(c, 'session');
    const userId = token ? await verifySession(token, c.env.SESSION_SECRET) : null;
    if (userId === null) return c.json({ error: 'unauthorized' }, 401);
    c.set('userId', userId);
    await next();
  },
);
