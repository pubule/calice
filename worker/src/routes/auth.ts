import { Hono } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import { hashPassword, verifyPassword, signSession } from '../lib/auth';
import { requireAuth } from '../lib/session';
import type { Env } from '../index';

export const authRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();

async function setSessionCookie(c: any, userId: number) {
  const token = await signSession(userId, c.env.SESSION_SECRET);
  setCookie(c, 'session', token, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: 60 * 60 * 24 * 30 });
}

authRoutes.post('/signup', async (c) => {
  const { email, password, name } = await c.req.json<{ email: string; password: string; name: string }>();
  const existing = await c.env.DB.prepare('select id from users where email = ?').bind(email).first();
  if (existing) return c.json({ error: 'email already registered' }, 409);

  const passwordHash = await hashPassword(password);
  const userResult = await c.env.DB
    .prepare('insert into users (email, password_hash, name) values (?, ?, ?) returning id')
    .bind(email, passwordHash, name)
    .first<{ id: number }>();
  const userId = userResult!.id;

  const cellarResult = await c.env.DB
    .prepare('insert into cellars (name, owner_id) values (?, ?) returning id')
    .bind('Casa', userId)
    .first<{ id: number }>();
  await c.env.DB
    .prepare('insert into cellar_members (cellar_id, user_id, role) values (?, ?, ?)')
    .bind(cellarResult!.id, userId, 'owner')
    .run();

  await setSessionCookie(c, userId);
  return c.json({ id: userId, email, name });
});

authRoutes.post('/login', async (c) => {
  const { email, password } = await c.req.json<{ email: string; password: string }>();
  const user = await c.env.DB
    .prepare('select id, password_hash from users where email = ?')
    .bind(email)
    .first<{ id: number; password_hash: string }>();
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return c.json({ error: 'invalid credentials' }, 401);
  }
  await setSessionCookie(c, user.id);
  return c.json({ id: user.id });
});

authRoutes.post('/logout', (c) => {
  deleteCookie(c, 'session', { path: '/' });
  return c.json({ ok: true });
});

authRoutes.get('/me', requireAuth, async (c) => {
  const user = await c.env.DB
    .prepare('select id, email, name from users where id = ?')
    .bind(c.get('userId'))
    .first();
  return c.json(user);
});
