import { Hono } from 'hono';
import { requireAuth } from '../lib/session';
import { isCellarMember } from '../lib/cellars';
import { wineOfVintage } from '../lib/wine-vintage';
import type { Env } from '../index';

export const cellarBottleRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
cellarBottleRoutes.use('*', requireAuth);

cellarBottleRoutes.get('/:cellarId/bottles', async (c) => {
  const cellarId = Number(c.req.param('cellarId'));
  if (!(await isCellarMember(c.env.DB, cellarId, c.get('userId')))) return c.json({ error: 'not a member' }, 403);
  const rows = await c.env.DB
    .prepare(
      `select bottles.*, wines.name, wines.producer, wines.region, wines.country, wines.type, wines.vintage, wines.image_url,
              wines.grape_variety, wines.denomination, wines.vivino_rating, wines.vivino_ratings_count, wines.alcohol, wines.producer_url,
              (select avg(rating) from tasting_notes where tasting_notes.bottle_id = bottles.id) as score,
              (select nullif(rating, 0) from tasting_notes where tasting_notes.bottle_id = bottles.id and tasting_notes.user_id = ?
                 order by created_at desc, id desc limit 1) as my_rating
       from bottles
         join wines on wines.id = bottles.wine_id
       where bottles.cellar_id = ?
       order by bottles.added_at desc`,
    )
    .bind(c.get('userId'), cellarId)
    .all<Record<string, unknown> & { id: number }>();
  const places = await placesWhere(c.env.DB, 'bottles.cellar_id = ?', cellarId);
  return c.json(rows.results.map((b) => ({ ...withoutLegacyPlace(b), places: places.filter((p) => p.bottle_id === b.id).map(publicPlace) })));
});

cellarBottleRoutes.post('/:cellarId/bottles', async (c) => {
  const cellarId = Number(c.req.param('cellarId'));
  const userId = c.get('userId');
  if (!(await isCellarMember(c.env.DB, cellarId, userId))) return c.json({ error: 'not a member' }, 403);
  const body = await c.req.json<{ wineId: number; quantity: number; pricePaid?: number; shelfLocation?: string; drinkFrom?: string; drinkUntil?: string; disgorgedAt?: string }>();
  if (!isPrice(body.pricePaid)) return c.json({ error: 'pricePaid must be a number between 0 and 100000' }, 400);
  if (!Number.isInteger(body.quantity) || body.quantity < 1 || body.quantity > 9999) return c.json({ error: 'quantity must be an integer between 1 and 9999' }, 400);
  if (body.disgorgedAt != null && !(typeof body.disgorgedAt === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(body.disgorgedAt))) {
    return c.json({ error: 'disgorgedAt must be YYYY-MM' }, 400);
  }
  const bottle = await c.env.DB
    .prepare(
      `insert into bottles (cellar_id, wine_id, quantity, price_paid, shelf_location, drink_from, drink_until, disgorged_at, added_by)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?) returning *`,
    )
    .bind(cellarId, body.wineId, body.quantity, body.pricePaid ?? null, body.shelfLocation ?? null, body.drinkFrom ?? null, body.drinkUntil ?? null, body.disgorgedAt ?? null, userId)
    .first();
  await c.env.DB
    .prepare('insert into activity_feed (user_id, cellar_id, wine_id, action) values (?, ?, ?, ?)')
    .bind(userId, cellarId, body.wineId, 'added')
    .run();
  return c.json(bottle);
});

// ---- where each bottle sits (bottle_places, one row per physical bottle) ----

type PlaceRow = { id: number; bottle_id: number; element_id: number; element_name: string; element_kind: string; slot_tier: number | null; slot_col: number | null; slot_depth: number | null };

async function placesWhere(db: D1Database, where: string, arg: number): Promise<PlaceRow[]> {
  const rows = await db
    .prepare(
      `select bottle_places.id, bottle_places.bottle_id, bottle_places.element_id, cellar_elements.name as element_name,
              cellar_elements.kind as element_kind, bottle_places.slot_tier, bottle_places.slot_col, bottle_places.slot_depth
       from bottle_places
         join cellar_elements on cellar_elements.id = bottle_places.element_id
         join bottles on bottles.id = bottle_places.bottle_id
       where ${where}
       order by bottle_places.id`,
    )
    .bind(arg)
    .all<PlaceRow>();
  return rows.results;
}

const publicPlace = ({ bottle_id: _b, ...p }: PlaceRow) => p;

// The old one-place-per-wine columns are no longer the truth: keep them out
// of the answers so no client reads them by mistake.
function withoutLegacyPlace<T extends Record<string, unknown>>(b: T) {
  const { element_id: _e, slot_tier: _t, slot_col: _c, slot_depth: _d, ...rest } = b;
  return rest;
}

export async function bottlePlaces(db: D1Database, bottleId: number) {
  return (await placesWhere(db, 'bottle_places.bottle_id = ?', bottleId)).map(publicPlace);
}

// A wine never has more places than bottles: when the count goes down
// (uncorked, or corrected by hand) the most recently placed ones are freed.
async function trimPlaces(db: D1Database, bottleId: number) {
  await db
    .prepare(
      `delete from bottle_places where bottle_id = ?1 and id not in (
         select id from bottle_places where bottle_id = ?1 order by id limit (select quantity from bottles where id = ?1))`,
    )
    .bind(bottleId)
    .run();
}

function isPrice(v: unknown): boolean {
  return v == null || (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100000);
}

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
  const body = await c.req.json<Partial<{ quantity: number; pricePaid: number | null; shelfLocation: string; drinkFrom: string | null; drinkUntil: string | null; disgorgedAt: string | null }>>();
  if (!isPrice(body.pricePaid)) return c.json({ error: 'pricePaid must be a number between 0 and 100000' }, 400);
  // Fields are partial (coalesce: omitted = unchanged), except the price:
  // "pricePaid": null clears it (the edit sheet's field emptied), which
  // coalesce could never do. Omitting it still leaves it as it is.
  const priceGiven = 'pricePaid' in body ? 1 : 0;
  // The drinking window too: sent as a pair from the edit sheet, null clears
  // it (back to the app's estimate). Dates as YYYY-MM-DD.
  const windowGiven = 'drinkFrom' in body || 'drinkUntil' in body ? 1 : 0;
  const isDate = (v: unknown) => v == null || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v));
  if (!isDate(body.drinkFrom) || !isDate(body.drinkUntil)) return c.json({ error: 'drinkFrom/drinkUntil must be YYYY-MM-DD or null' }, 400);
  if (body.drinkFrom && body.drinkUntil && body.drinkFrom > body.drinkUntil) return c.json({ error: 'drinkFrom must not be after drinkUntil' }, 400);
  // Disgorgement month (sparkling wines), YYYY-MM; null clears it.
  const disgorgedGiven = 'disgorgedAt' in body ? 1 : 0;
  if (body.disgorgedAt != null && !(typeof body.disgorgedAt === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(body.disgorgedAt))) {
    return c.json({ error: 'disgorgedAt must be YYYY-MM or null' }, 400);
  }
  if (body.quantity != null && !(Number.isInteger(body.quantity) && body.quantity >= 0 && body.quantity <= 9999)) {
    return c.json({ error: 'quantity must be an integer between 0 and 9999' }, 400);
  }
  const bottle = await c.env.DB
    .prepare(
      `update bottles set
         quantity = coalesce(?, quantity),
         price_paid = case when ? then ? else price_paid end,
         shelf_location = coalesce(?, shelf_location),
         drink_from = case when ? then ? else drink_from end,
         drink_until = case when ? then ? else drink_until end,
         disgorged_at = case when ? then ? else disgorged_at end
       where id = ? returning *`,
    )
    .bind(body.quantity ?? null, priceGiven, body.pricePaid ?? null, body.shelfLocation ?? null, windowGiven, body.drinkFrom ?? null, windowGiven, body.drinkUntil ?? null, disgorgedGiven, body.disgorgedAt ?? null, id)
    .first<Record<string, unknown>>();
  if (body.quantity != null) await trimPlaces(c.env.DB, id);
  return c.json({ ...withoutLegacyPlace(bottle!), places: await bottlePlaces(c.env.DB, id) });
});

type Spot = { elementId: number; tier?: number | null; col?: number | null; depth?: number | null };

// Checks a requested spot: the element belongs to the bottle's cellar, a
// slot is inside the element's grid (a box takes no coordinates), and no
// other bottle is already there. Returns an error message or null.
async function spotError(db: D1Database, cellarId: number, spot: Spot, exceptPlaceId: number | null): Promise<string | null> {
  const el = await db.prepare('select cellar_id, kind, tiers, cols, depth from cellar_elements where id = ?').bind(spot.elementId)
    .first<{ cellar_id: number; kind: string; tiers: number | null; cols: number | null; depth: number | null }>();
  if (!el || el.cellar_id !== cellarId) return 'element not in this cellar';
  if (el.kind === 'Scatolone') return null;
  const { tier, col, depth } = spot;
  const inGrid = Number.isInteger(tier) && Number.isInteger(col) && Number.isInteger(depth)
    && tier! >= 1 && tier! <= (el.tiers ?? 0) && col! >= 0 && col! < (el.cols ?? 0) && depth! >= 1 && depth! <= (el.depth ?? 0);
  if (!inGrid) return 'slot outside the element';
  const taken = await db
    .prepare('select id from bottle_places where element_id = ? and slot_tier = ? and slot_col = ? and slot_depth = ? and id is not ?')
    .bind(spot.elementId, tier, col, depth, exceptPlaceId)
    .first();
  return taken ? 'slot taken' : null;
}

// Puts one more bottle of this wine somewhere. Refused when every bottle
// already has a place.
bottleRoutes.post('/:id/places', async (c) => {
  const id = Number(c.req.param('id'));
  if (!(await assertBottleAccess(c.env, id, c.get('userId')))) return c.json({ error: 'not found' }, 404);
  const spot = await c.req.json<Spot>();
  const b = (await c.env.DB.prepare('select cellar_id, quantity, (select count(*) from bottle_places where bottle_id = bottles.id) as placed from bottles where id = ?')
    .bind(id).first<{ cellar_id: number; quantity: number; placed: number }>())!;
  const err = await spotError(c.env.DB, b.cellar_id, spot, null);
  if (err) return c.json({ error: err }, err === 'slot taken' ? 409 : 400);
  if (b.placed >= b.quantity) return c.json({ error: 'every bottle already has a place' }, 409);
  const box = (await c.env.DB.prepare('select kind from cellar_elements where id = ?').bind(spot.elementId).first<{ kind: string }>())!.kind === 'Scatolone';
  await c.env.DB
    .prepare('insert into bottle_places (bottle_id, element_id, slot_tier, slot_col, slot_depth) values (?, ?, ?, ?, ?)')
    .bind(id, spot.elementId, box ? null : spot.tier, box ? null : spot.col, box ? null : spot.depth)
    .run();
  return c.json({ places: await bottlePlaces(c.env.DB, id) });
});

export const placeRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
placeRoutes.use('*', requireAuth);

async function placeBottle(c: { env: Env; get: (k: 'userId') => number }, placeId: number) {
  const row = await c.env.DB.prepare('select bottle_id from bottle_places where id = ?').bind(placeId).first<{ bottle_id: number }>();
  if (!row || !(await assertBottleAccess(c.env, row.bottle_id, c.get('userId')))) return null;
  return row.bottle_id;
}

// Moves one placed bottle to another spot.
placeRoutes.patch('/:id', async (c) => {
  const placeId = Number(c.req.param('id'));
  const bottleId = await placeBottle(c, placeId);
  if (bottleId == null) return c.json({ error: 'not found' }, 404);
  const spot = await c.req.json<Spot>();
  const { cellar_id } = (await c.env.DB.prepare('select cellar_id from bottles where id = ?').bind(bottleId).first<{ cellar_id: number }>())!;
  const err = await spotError(c.env.DB, cellar_id, spot, placeId);
  if (err) return c.json({ error: err }, err === 'slot taken' ? 409 : 400);
  const box = (await c.env.DB.prepare('select kind from cellar_elements where id = ?').bind(spot.elementId).first<{ kind: string }>())!.kind === 'Scatolone';
  await c.env.DB
    .prepare('update bottle_places set element_id = ?, slot_tier = ?, slot_col = ?, slot_depth = ? where id = ?')
    .bind(spot.elementId, box ? null : spot.tier, box ? null : spot.col, box ? null : spot.depth, placeId)
    .run();
  return c.json({ bottleId, places: await bottlePlaces(c.env.DB, bottleId) });
});

// Frees a spot: that bottle stays in the cellar, without a place.
placeRoutes.delete('/:id', async (c) => {
  const placeId = Number(c.req.param('id'));
  const bottleId = await placeBottle(c, placeId);
  if (bottleId == null) return c.json({ error: 'not found' }, 404);
  await c.env.DB.prepare('delete from bottle_places where id = ?').bind(placeId).run();
  return c.json({ bottleId, places: await bottlePlaces(c.env.DB, bottleId) });
});

// Another vintage for this bottle only (from the edit sheet): the vintage is
// part of the wine, which other bottles (and other people) may share, so the
// bottle moves to the wine of that vintage — the existing one with the same
// name and producer, or a copy of its current wine with the new vintage.
bottleRoutes.post('/:id/vintage', async (c) => {
  const id = Number(c.req.param('id'));
  const userId = c.get('userId');
  if (!(await assertBottleAccess(c.env, id, userId))) return c.json({ error: 'not found' }, 404);
  const { vintage, quantity } = await c.req.json<{ vintage: number | null; quantity?: number }>();
  if (vintage !== null && !(Number.isInteger(vintage) && vintage >= 1900 && vintage <= 2100)) {
    return c.json({ error: 'vintage must be an integer between 1900 and 2100, or null' }, 400);
  }
  const bottle = (await c.env.DB.prepare('select * from bottles where id = ?').bind(id).first<{ quantity: number; cellar_id: number; price_paid: number | null; drink_from: string | null; drink_until: string | null }>())!;
  if (quantity != null && !(Number.isInteger(quantity) && quantity >= 1 && quantity <= bottle.quantity)) {
    return c.json({ error: 'quantity must be between 1 and the bottles in this row' }, 400);
  }
  const wine = (await c.env.DB
    .prepare('select wines.* from wines join bottles on bottles.wine_id = wines.id where bottles.id = ?')
    .bind(id)
    .first<{ id: number; name: string; producer: string; vintage: number | null }>())!;
  if ((wine.vintage ?? null) === vintage) return c.json({ wine, bottleId: id });
  const targetId = await wineOfVintage(c.env.DB, wine.id, vintage, userId);
  // Only some of the row's bottles are of the other year: they become their
  // own row (same cellar, price and window); the rest stay here, with their
  // notes and places (trimmed to the bottles left).
  if (quantity != null && quantity < bottle.quantity) {
    const created = await c.env.DB
      .prepare(
        `insert into bottles (cellar_id, wine_id, quantity, price_paid, drink_from, drink_until, added_by)
         values (?, ?, ?, ?, ?, ?, ?) returning id`,
      )
      .bind(bottle.cellar_id, targetId, quantity, bottle.price_paid, bottle.drink_from, bottle.drink_until, userId)
      .first<{ id: number }>();
    await c.env.DB.prepare('update bottles set quantity = quantity - ? where id = ?').bind(quantity, id).run();
    await trimPlaces(c.env.DB, id);
    return c.json({ wine: await c.env.DB.prepare('select * from wines where id = ?').bind(targetId).first(), bottleId: created!.id });
  }
  await c.env.DB.prepare('update bottles set wine_id = ? where id = ?').bind(targetId, id).run();
  return c.json({ wine: await c.env.DB.prepare('select * from wines where id = ?').bind(targetId).first(), bottleId: id });
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
  await c.env.DB.prepare('delete from bottle_places where bottle_id = ?').bind(id).run();
  await c.env.DB.prepare('delete from bottles where id = ?').bind(id).run();
  return c.json({ ok: true });
});
