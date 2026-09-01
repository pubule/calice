import { Hono } from 'hono';
import { requireAuth } from '../lib/session';
import type { Env } from '../index';

export const wineRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
wineRoutes.use('*', requireAuth);

wineRoutes.get('/search', async (c) => {
  const barcode = c.req.query('barcode');
  if (barcode) {
    const rows = await c.env.DB.prepare('select * from wines where barcode = ? limit 20').bind(barcode).all();
    return c.json(rows.results);
  }
  const q = `%${c.req.query('q') ?? ''}%`;
  const rows = await c.env.DB
    .prepare('select * from wines where name like ? or producer like ? or region like ? limit 20')
    .bind(q, q, q)
    .all();
  return c.json(rows.results);
});

wineRoutes.post('/', async (c) => {
  const body = await c.req.json<{ name: string; producer: string; region?: string; country: string; type: string; vintage?: number; barcode?: string }>();
  const wine = await c.env.DB
    .prepare(
      `insert into wines (name, producer, region, country, type, vintage, barcode, source, created_by)
       values (?, ?, ?, ?, ?, ?, ?, 'custom', ?) returning *`,
    )
    .bind(body.name, body.producer, body.region ?? null, body.country, body.type, body.vintage ?? null, body.barcode ?? null, c.get('userId'))
    .first();
  return c.json(wine);
});
