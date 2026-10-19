import { Hono } from 'hono';
import { requireAuth } from '../lib/session';
import { isCellarMember, ensureCellar } from '../lib/cellars';
import { saveSafetyCopy } from './backup';
import type { Env } from '../index';

export { isCellarMember };

export const cellarRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
cellarRoutes.use('*', requireAuth);

cellarRoutes.get('/', async (c) => {
  await ensureCellar(c.env.DB, c.get('userId'));
  const rows = await c.env.DB
    .prepare(
      `select cellars.* from cellars
       join cellar_members on cellar_members.cellar_id = cellars.id
       where cellar_members.user_id = ?`,
    )
    .bind(c.get('userId'))
    .all();
  return c.json(rows.results);
});

// No POST: one cellar per user (lib/cellars.ts). Deleting it empties
// everything in it and leaves a new empty one; the current state is saved
// first under restore-safety/ like before a restore.
cellarRoutes.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const userId = c.get('userId');
  if (!(await isCellarMember(c.env.DB, id, userId))) return c.json({ error: 'not a member' }, 403);
  await saveSafetyCopy(c.env, userId);
  const db = c.env.DB;
  const bottles = 'select id from bottles where cellar_id = ?';
  await db.batch([
    db.prepare(`delete from bottle_places where bottle_id in (${bottles})`).bind(id),
    db.prepare(`delete from photos where bottle_id in (${bottles})`).bind(id),
    db.prepare(`delete from tasting_notes where bottle_id in (${bottles})`).bind(id),
    db.prepare('delete from bottles where cellar_id = ?').bind(id),
    db.prepare('delete from wishlist_items where cellar_id = ?').bind(id),
    db.prepare('delete from cellar_elements where cellar_id = ?').bind(id),
    db.prepare('delete from activity_feed where cellar_id = ?').bind(id),
    db.prepare('delete from cellar_invites where cellar_id = ?').bind(id),
    db.prepare('delete from cellar_members where cellar_id = ?').bind(id),
    db.prepare('delete from cellars where id = ?').bind(id),
  ]);
  const newId = await ensureCellar(db, userId);
  return c.json(await db.prepare('select * from cellars where id = ?').bind(newId).first());
});

cellarRoutes.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!(await isCellarMember(c.env.DB, id, c.get('userId')))) return c.json({ error: 'not a member' }, 403);
  const { name } = await c.req.json<{ name: string }>();
  const cellar = await c.env.DB.prepare('update cellars set name = ? where id = ? returning *').bind(name, id).first();
  return c.json(cellar);
});
