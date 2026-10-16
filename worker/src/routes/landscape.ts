import { Hono } from 'hono';
import { requireAuth } from '../lib/session';
import { findLandscape } from '../lib/landscape';
import type { Env } from '../index';

export const landscapeRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
landscapeRoutes.use('*', requireAuth);

// GET /api/landscape?denomination=&region=&country= → the vineyard photo for
// the wine's area with its credit, or { landscape: null }.
landscapeRoutes.get('/', async (c) => {
  const q = (k: string) => (c.req.query(k) ?? '').slice(0, 120) || null;
  const landscape = await findLandscape(c.env.DB, { denomination: q('denomination'), region: q('region'), country: q('country') });
  // The answer only changes when an area is searched for the first time.
  c.header('cache-control', 'private, max-age=86400');
  return c.json({ landscape });
});
