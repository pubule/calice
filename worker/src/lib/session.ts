import { createMiddleware } from 'hono/factory';
import { emailFromJwt } from './access';
import type { Env } from '../index';

async function getOrCreateUser(db: D1Database, email: string): Promise<number> {
  const existing = await db.prepare('select id from users where email = ?').bind(email).first<{ id: number }>();
  if (existing) return existing.id;

  const name = email.split('@')[0];
  const user = await db.prepare('insert into users (email, name) values (?, ?) returning id').bind(email, name).first<{ id: number }>();
  const userId = user!.id;

  const cellar = await db
    .prepare('insert into cellars (name, owner_id) values (?, ?) returning id')
    .bind('Casa', userId)
    .first<{ id: number }>();
  await db.prepare('insert into cellar_members (cellar_id, user_id, role) values (?, ?, ?)').bind(cellar!.id, userId, 'owner').run();

  return userId;
}

export const requireAuth = createMiddleware<{ Bindings: Env; Variables: { userId: number } }>(
  async (c, next) => {
    // CALICE_DEV_EMAIL exists ONLY as a `wrangler dev` --var, never in
    // wrangler.jsonc (that would be an open door in production). The header
    // override lets local/CI tests impersonate different emails without a
    // real Access JWT. Mirrors ombre-su-roccamora's OSR_DEV_EMAIL pattern.
    const email =
      (c.env.CALICE_DEV_EMAIL && c.req.header('X-Calice-Dev-Email')) ||
      c.env.CALICE_DEV_EMAIL ||
      (await emailFromJwt(c.req.header('Cf-Access-Jwt-Assertion'), { team: c.env.ACCESS_TEAM, aud: c.env.ACCESS_AUD }));
    if (!email) return c.json({ error: 'unauthorized' }, 401);
    c.set('userId', await getOrCreateUser(c.env.DB, email));
    await next();
  },
);
