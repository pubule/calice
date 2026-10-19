import { Hono } from 'hono';
import { requireAuth } from '../lib/session';
import { isCellarMember } from '../lib/cellars';
import { validateNote, type NoteBody } from './notes';
import type { Env } from '../index';

export const cellarWishlistRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
cellarWishlistRoutes.use('*', requireAuth);

cellarWishlistRoutes.get('/:cellarId/wishlist', async (c) => {
  const cellarId = Number(c.req.param('cellarId'));
  if (!(await isCellarMember(c.env.DB, cellarId, c.get('userId')))) return c.json({ error: 'not a member' }, 403);
  const rows = await c.env.DB
    .prepare(
      `select wishlist_items.*, wines.name, wines.producer, wines.region, wines.country, wines.type, wines.vintage, wines.image_url,
              wines.denomination, wines.grape_variety, wines.alcohol, wines.producer_url, wines.vivino_rating, wines.vivino_ratings_count
       from wishlist_items join wines on wines.id = wishlist_items.wine_id
       where wishlist_items.cellar_id = ?
       order by wishlist_items.added_at desc`,
    )
    .bind(cellarId)
    .all<Record<string, unknown>>();
  return c.json(rows.results.map((r) => ({ ...r, note: parseWishNote(r.note) })));
});

cellarWishlistRoutes.post('/:cellarId/wishlist', async (c) => {
  const cellarId = Number(c.req.param('cellarId'));
  const userId = c.get('userId');
  if (!(await isCellarMember(c.env.DB, cellarId, userId))) return c.json({ error: 'not a member' }, 403);
  const body = await c.req.json<{ wineId: number; targetPrice?: number | null; note?: NoteBody | null }>();
  if (!Number.isInteger(body.wineId)) return c.json({ error: 'wineId is required' }, 400);
  if (body.targetPrice != null && !(typeof body.targetPrice === 'number' && body.targetPrice >= 0 && body.targetPrice <= 100000)) {
    return c.json({ error: 'targetPrice must be a number between 0 and 100000' }, 400);
  }
  if (body.note != null) {
    const error = validateNote(body.note);
    if (error) return c.json({ error }, 400);
  }
  const note = body.note != null ? JSON.stringify(body.note) : null;
  const wine = await c.env.DB.prepare('select id from wines where id = ?').bind(body.wineId).first();
  if (!wine) return c.json({ error: 'wine not found' }, 404);
  // The same wine twice in one cellar's wishlist is one wish: adding it again
  // only updates the target price and the note (when given).
  const existing = await c.env.DB
    .prepare('select id from wishlist_items where cellar_id = ? and wine_id = ? limit 1')
    .bind(cellarId, body.wineId)
    .first<{ id: number }>();
  if (existing) {
    const item = await c.env.DB
      .prepare('update wishlist_items set target_price = coalesce(?, target_price), note = coalesce(?, note) where id = ? returning *')
      .bind(body.targetPrice ?? null, note, existing.id)
      .first<Record<string, unknown>>();
    return c.json({ ...item, note: parseWishNote(item?.note) });
  }
  const item = await c.env.DB
    .prepare('insert into wishlist_items (cellar_id, wine_id, target_price, added_by, note) values (?, ?, ?, ?, ?) returning *')
    .bind(cellarId, body.wineId, body.targetPrice ?? null, userId, note)
    .first<Record<string, unknown>>();
  return c.json({ ...item, note: parseWishNote(item?.note) });
});

// The note of a guided tasting saved with the wish (NoteBody), or null.
function parseWishNote(raw: unknown): NoteBody | null {
  try {
    return typeof raw === 'string' ? (JSON.parse(raw) as NoteBody) : null;
  } catch {
    return null;
  }
}

export const wishlistItemRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
wishlistItemRoutes.use('*', requireAuth);

wishlistItemRoutes.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const item = await c.env.DB.prepare('select cellar_id from wishlist_items where id = ?').bind(id).first<{ cellar_id: number }>();
  if (!item || !(await isCellarMember(c.env.DB, item.cellar_id, c.get('userId')))) return c.json({ error: 'not found' }, 404);
  await c.env.DB.prepare('delete from wishlist_items where id = ?').bind(id).run();
  return c.json({ ok: true });
});
