import { Hono } from 'hono';
import { requireAuth } from '../lib/session';
import { isCellarMember } from '../lib/cellars';
import type { Env } from '../index';

export const cellarWishlistRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
cellarWishlistRoutes.use('*', requireAuth);

cellarWishlistRoutes.get('/:cellarId/wishlist', async (c) => {
  const cellarId = Number(c.req.param('cellarId'));
  if (!(await isCellarMember(c.env.DB, cellarId, c.get('userId')))) return c.json({ error: 'not a member' }, 403);
  const rows = await c.env.DB
    .prepare(
      `select wishlist_items.*, wines.name, wines.producer, wines.region, wines.country, wines.type
       from wishlist_items join wines on wines.id = wishlist_items.wine_id
       where wishlist_items.cellar_id = ?
       order by wishlist_items.added_at desc`,
    )
    .bind(cellarId)
    .all();
  return c.json(rows.results);
});

cellarWishlistRoutes.post('/:cellarId/wishlist', async (c) => {
  const cellarId = Number(c.req.param('cellarId'));
  const userId = c.get('userId');
  if (!(await isCellarMember(c.env.DB, cellarId, userId))) return c.json({ error: 'not a member' }, 403);
  const body = await c.req.json<{ wineId: number; targetPrice?: number }>();
  const item = await c.env.DB
    .prepare('insert into wishlist_items (cellar_id, wine_id, target_price, added_by) values (?, ?, ?, ?) returning *')
    .bind(cellarId, body.wineId, body.targetPrice ?? null, userId)
    .first();
  return c.json(item);
});

export const wishlistItemRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
wishlistItemRoutes.use('*', requireAuth);

wishlistItemRoutes.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const item = await c.env.DB.prepare('select cellar_id from wishlist_items where id = ?').bind(id).first<{ cellar_id: number }>();
  if (!item || !(await isCellarMember(c.env.DB, item.cellar_id, c.get('userId')))) return c.json({ error: 'not found' }, 404);
  await c.env.DB.prepare('delete from wishlist_items where id = ?').bind(id).run();
  return c.json({ ok: true });
});
