import { Hono } from 'hono';
import { requireAuth } from '../lib/session';
import type { Env } from '../index';

export const followRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
followRoutes.use('*', requireAuth);

followRoutes.post('/:userId', async (c) => {
  const followeeId = Number(c.req.param('userId'));
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
