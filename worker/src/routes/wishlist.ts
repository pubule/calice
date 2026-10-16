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
      `select wishlist_items.*, wines.name, wines.producer, wines.region, wines.country, wines.type, wines.vintage, wines.image_url
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
  const body = await c.req.json<{ wineId: number; targetPrice?: number | null }>();
  if (!Number.isInteger(body.wineId)) return c.json({ error: 'wineId is required' }, 400);
  if (body.targetPrice != null && !(typeof body.targetPrice === 'number' && body.targetPrice >= 0 && body.targetPrice <= 100000)) {
    return c.json({ error: 'targetPrice must be a number between 0 and 100000' }, 400);
  }
  const wine = await c.env.DB.prepare('select id from wines where id = ?').bind(body.wineId).first();
  if (!wine) return c.json({ error: 'wine not found' }, 404);
  // The same wine twice in one cellar's wishlist is one wish: adding it again
  // only updates the target price (when one is given).
  const existing = await c.env.DB
    .prepare('select id from wishlist_items where cellar_id = ? and wine_id = ? limit 1')
    .bind(cellarId, body.wineId)
    .first<{ id: number }>();
  if (existing) {
    const item = await c.env.DB
      .prepare('update wishlist_items set target_price = coalesce(?, target_price) where id = ? returning *')
      .bind(body.targetPrice ?? null, existing.id)
      .first();
    return c.json(item);
  }
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
