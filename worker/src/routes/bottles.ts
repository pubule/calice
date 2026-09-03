import { Hono } from 'hono';
import { requireAuth } from '../lib/session';
import { isCellarMember } from '../lib/cellars';
import type { Env } from '../index';

export const cellarBottleRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
cellarBottleRoutes.use('*', requireAuth);

cellarBottleRoutes.get('/:cellarId/bottles', async (c) => {
  const cellarId = Number(c.req.param('cellarId'));
  if (!(await isCellarMember(c.env.DB, cellarId, c.get('userId')))) return c.json({ error: 'not a member' }, 403);
  const rows = await c.env.DB
    .prepare(
      `select bottles.*, wines.name, wines.producer, wines.region, wines.country, wines.type, wines.vintage,
              (select avg(rating) from tasting_notes where tasting_notes.bottle_id = bottles.id) as score,
              cellar_elements.name as element_name, cellar_elements.kind as element_kind
       from bottles
         join wines on wines.id = bottles.wine_id
         left join cellar_elements on cellar_elements.id = bottles.element_id
       where bottles.cellar_id = ?
       order by bottles.added_at desc`,
    )
    .bind(cellarId)
    .all();
  return c.json(rows.results);
});

cellarBottleRoutes.post('/:cellarId/bottles', async (c) => {
  const cellarId = Number(c.req.param('cellarId'));
  const userId = c.get('userId');
  if (!(await isCellarMember(c.env.DB, cellarId, userId))) return c.json({ error: 'not a member' }, 403);
  const body = await c.req.json<{ wineId: number; quantity: number; pricePaid?: number; shelfLocation?: string; drinkFrom?: string; drinkUntil?: string }>();
  const bottle = await c.env.DB
    .prepare(
      `insert into bottles (cellar_id, wine_id, quantity, price_paid, shelf_location, drink_from, drink_until, added_by)
       values (?, ?, ?, ?, ?, ?, ?, ?) returning *`,
    )
    .bind(cellarId, body.wineId, body.quantity, body.pricePaid ?? null, body.shelfLocation ?? null, body.drinkFrom ?? null, body.drinkUntil ?? null, userId)
    .first();
  await c.env.DB
    .prepare('insert into activity_feed (user_id, cellar_id, wine_id, action) values (?, ?, ?, ?)')
    .bind(userId, cellarId, body.wineId, 'added')
    .run();
  return c.json(bottle);
});

export const bottleRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
bottleRoutes.use('*', requireAuth);

async function assertBottleAccess(env: Env, bottleId: number, userId: number): Promise<boolean> {
  const bottle = await env.DB.prepare('select cellar_id from bottles where id = ?').bind(bottleId).first<{ cellar_id: number }>();
  if (!bottle) return false;
  return isCellarMember(env.DB, bottle.cellar_id, userId);
}

bottleRoutes.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!(await assertBottleAccess(c.env, id, c.get('userId')))) return c.json({ error: 'not found' }, 404);
  const body = await c.req.json<Partial<{ quantity: number; pricePaid: number; shelfLocation: string; drinkFrom: string; drinkUntil: string }>>();
  const bottle = await c.env.DB
    .prepare(
      `update bottles set
         quantity = coalesce(?, quantity),
         price_paid = coalesce(?, price_paid),
         shelf_location = coalesce(?, shelf_location),
         drink_from = coalesce(?, drink_from),
         drink_until = coalesce(?, drink_until)
       where id = ? returning *`,
    )
    .bind(body.quantity ?? null, body.pricePaid ?? null, body.shelfLocation ?? null, body.drinkFrom ?? null, body.drinkUntil ?? null, id)
    .first();
  return c.json(bottle);
});

// Full overwrite (nulls included) rather than the coalesce pattern above —
// unassigning an element or clearing a slot is a real, valid state, not an
// omitted field.
bottleRoutes.patch('/:id/location', async (c) => {
  const id = Number(c.req.param('id'));
  if (!(await assertBottleAccess(c.env, id, c.get('userId')))) return c.json({ error: 'not found' }, 404);
  const body = await c.req.json<{ elementId: number | null; tier?: number | null; col?: number | null; depth?: number | null }>();
  if (body.elementId != null) {
    const bottleCellar = await c.env.DB.prepare('select cellar_id from bottles where id = ?').bind(id).first<{ cellar_id: number }>();
    const element = await c.env.DB.prepare('select cellar_id from cellar_elements where id = ?').bind(body.elementId).first<{ cellar_id: number }>();
    if (!element || element.cellar_id !== bottleCellar!.cellar_id) return c.json({ error: 'element not in this cellar' }, 400);
  }
  const bottle = await c.env.DB
    .prepare('update bottles set element_id = ?, slot_tier = ?, slot_col = ?, slot_depth = ? where id = ? returning *')
    .bind(body.elementId, body.tier ?? null, body.col ?? null, body.depth ?? null, id)
    .first();
  return c.json(bottle);
});

bottleRoutes.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!(await assertBottleAccess(c.env, id, c.get('userId')))) return c.json({ error: 'not found' }, 404);

  // D1 enforces the (non-cascading) FKs from tasting_notes/photos to bottles,
  // so deleting a bottle that still has either would 500 with a FOREIGN KEY
  // constraint failure. Clear the children first — photos also own an R2
  // object that has no FK of its own, so it has to be cleaned up explicitly
  // or it's orphaned storage forever.
  const photos = await c.env.DB.prepare('select r2_key from photos where bottle_id = ?').bind(id).all<{ r2_key: string }>();
  for (const photo of photos.results) {
    await c.env.PHOTOS.delete(photo.r2_key);
  }
  await c.env.DB.prepare('delete from photos where bottle_id = ?').bind(id).run();
  await c.env.DB.prepare('delete from tasting_notes where bottle_id = ?').bind(id).run();
  await c.env.DB.prepare('delete from bottles where id = ?').bind(id).run();
  return c.json({ ok: true });
});
