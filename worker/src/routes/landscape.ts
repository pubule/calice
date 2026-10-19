import { Hono } from 'hono';
import { requireAuth } from '../lib/session';
import { findLandscape } from '../lib/landscape';
import type { Env } from '../index';

export const landscapeRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
landscapeRoutes.use('*', requireAuth);

// GET /api/landscape?denomination=&region=&country=&seed= → the vineyard
// photo for the wine's area with its credit, or { landscape: null }. `seed`
// (the wine's id) picks which of a zone's photos this wine shows.
landscapeRoutes.get('/', async (c) => {
  const q = (k: string) => (c.req.query(k) ?? '').slice(0, 120) || null;
  const area = { denomination: q('denomination'), region: q('region'), country: q('country') };
  // A search writes to the shared `landscapes` and to R2: only for the area of
  // a wine in one of the caller's cellars, never for any text sent here.
  const mine = await c.env.DB
    .prepare(
      `select 1 from bottles join wines on wines.id = bottles.wine_id
         join cellar_members on cellar_members.cellar_id = bottles.cellar_id
       where cellar_members.user_id = ? and nullif(wines.denomination, '') is ? and nullif(wines.region, '') is ? and nullif(wines.country, '') is ? limit 1`,
    )
    .bind(c.get('userId'), area.denomination, area.region, area.country)
    .first();
  const landscape = mine ? await findLandscape(c.env, area, fetch, q('seed') ?? '') : null;
  // The answer only changes when an area is searched for the first time.
  c.header('cache-control', 'private, max-age=86400');
  return c.json({ landscape });
});

export const landscapeImageRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
landscapeImageRoutes.use('*', requireAuth);

// The photos are the same for everyone and a key is never reused: cached for good.
landscapeImageRoutes.get('/:key', async (c) => {
  const key = decodeURIComponent(c.req.param('key'));
  if (!key.startsWith('landscapes/')) return c.notFound();
  const object = await c.env.PHOTOS.get(key);
  if (!object) return c.notFound();
  return new Response(object.body, {
    headers: {
      'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'cache-control': 'private, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  });
});
