import { Hono } from 'hono';
import { requireAuth } from '../lib/session';
import { isCellarMember } from '../lib/cellars';
import type { Env } from '../index';

export const noteRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
noteRoutes.use('*', requireAuth);

noteRoutes.post('/:bottleId/notes', async (c) => {
  const bottleId = Number(c.req.param('bottleId'));
  const userId = c.get('userId');
  const bottle = await c.env.DB.prepare('select cellar_id from bottles where id = ?').bind(bottleId).first<{ cellar_id: number }>();
  if (!bottle || !(await isCellarMember(c.env.DB, bottle.cellar_id, userId))) return c.json({ error: 'not found' }, 404);
  const body = await c.req.json<{ rating: number; text: string }>();
  if (typeof body.rating !== 'number' || Number.isNaN(body.rating) || body.rating < 0 || body.rating > 5) {
    return c.json({ error: 'rating must be a number between 0 and 5' }, 400);
  }
  if (typeof body.text !== 'string' || body.text.trim().length === 0 || body.text.length > 2000) {
    return c.json({ error: 'text is required (1-2000 chars)' }, 400);
  }
  const note = await c.env.DB
    .prepare('insert into tasting_notes (bottle_id, user_id, rating, text) values (?, ?, ?, ?) returning *')
    .bind(bottleId, userId, body.rating, body.text)
    .first();
  return c.json(note);
});

noteRoutes.get('/:bottleId/notes', async (c) => {
  const bottleId = Number(c.req.param('bottleId'));
  const userId = c.get('userId');
  const rows = await c.env.DB
    .prepare(
      `select tasting_notes.*, users.name as author_name
       from tasting_notes
       join users on users.id = tasting_notes.user_id
       join bottles on bottles.id = tasting_notes.bottle_id
       where tasting_notes.bottle_id = ?
         and (
           tasting_notes.user_id = ?
           or tasting_notes.user_id in (select followee_id from follows where follower_id = ?)
           or (
             tasting_notes.user_id in (select user_id from cellar_members where cellar_id = bottles.cellar_id)
             and ? in (select user_id from cellar_members where cellar_id = bottles.cellar_id)
           )
         )
       order by tasting_notes.created_at desc`,
    )
    .bind(bottleId, userId, userId, userId)
    .all();
  return c.json(rows.results);
});
