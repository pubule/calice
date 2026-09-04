import { Hono } from 'hono';
import { requireAuth } from '../lib/session';
import type { Env } from '../index';

export const followRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
followRoutes.use('*', requireAuth);

followRoutes.get('/', async (c) => {
  const rows = await c.env.DB
    .prepare(
      `select users.id, users.name from follows
       join users on users.id = follows.followee_id
       where follows.follower_id = ?`,
    )
    .bind(c.get('userId'))
    .all();
  return c.json(rows.results);
});

// Exact-match lookup only (no partial/prefix search) — a free-text name or
// email-prefix search would let anyone enumerate the user table by typing
// single characters. Requiring the full email means the caller already
// knows who they're looking for, same trust model as "add contact by
// email" elsewhere.
followRoutes.get('/lookup', async (c) => {
  const email = c.req.query('email')?.trim().toLowerCase();
  if (!email) return c.json({ error: 'email required' }, 400);
  const user = await c.env.DB.prepare('select id, name from users where lower(email) = ?').bind(email).first<{ id: number; name: string }>();
  if (!user) return c.json({ error: 'not found' }, 404);
  return c.json(user);
});

followRoutes.post('/:userId', async (c) => {
  const followeeId = Number(c.req.param('userId'));
  if (followeeId === c.get('userId')) return c.json({ error: 'cannot follow yourself' }, 400);
  await c.env.DB
    .prepare('insert or ignore into follows (follower_id, followee_id) values (?, ?)')
    .bind(c.get('userId'), followeeId)
    .run();
  return c.json({ ok: true });
});

followRoutes.delete('/:userId', async (c) => {
  const followeeId = Number(c.req.param('userId'));
  await c.env.DB
    .prepare('delete from follows where follower_id = ? and followee_id = ?')
    .bind(c.get('userId'), followeeId)
    .run();
  return c.json({ ok: true });
});

export const activityRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
activityRoutes.use('*', requireAuth);

activityRoutes.get('/activity', async (c) => {
  const userId = c.get('userId');
  const rows = await c.env.DB
    .prepare(
      `select activity_feed.*, wines.name as wine_name, users.name as actor_name
       from activity_feed
       join wines on wines.id = activity_feed.wine_id
       join users on users.id = activity_feed.user_id
       where activity_feed.user_id = ?
          or activity_feed.user_id in (select followee_id from follows where follower_id = ?)
          or activity_feed.cellar_id in (select cellar_id from cellar_members where user_id = ?)
       order by activity_feed.created_at desc
       limit 50`,
    )
    .bind(userId, userId, userId)
    .all();
  return c.json(rows.results);
});
