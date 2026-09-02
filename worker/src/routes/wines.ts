import { Hono } from 'hono';
import { requireAuth } from '../lib/session';
import type { Env } from '../index';

export const wineRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
wineRoutes.use('*', requireAuth);

const WINE_TYPES = ['rosso', 'bianco', 'bollicine', 'rosato'];
const MAX_TEXT_LEN = 200;

function isNonEmptyShortString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= MAX_TEXT_LEN;
}

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

  if (!isNonEmptyShortString(body.name)) return c.json({ error: 'name is required (1-200 chars)' }, 400);
  if (!isNonEmptyShortString(body.producer)) return c.json({ error: 'producer is required (1-200 chars)' }, 400);
  if (!isNonEmptyShortString(body.country)) return c.json({ error: 'country is required (1-200 chars)' }, 400);
  if (!WINE_TYPES.includes(body.type)) return c.json({ error: `type must be one of ${WINE_TYPES.join(', ')}` }, 400);
  if (body.vintage != null && (!Number.isInteger(body.vintage) || body.vintage < 1900 || body.vintage > 2100)) {
    return c.json({ error: 'vintage must be an integer between 1900 and 2100' }, 400);
  }

  const wine = await c.env.DB
    .prepare(
      `insert into wines (name, producer, region, country, type, vintage, barcode, source, created_by)
       values (?, ?, ?, ?, ?, ?, ?, 'custom', ?) returning *`,
    )
    .bind(body.name, body.producer, body.region ?? null, body.country, body.type, body.vintage ?? null, body.barcode ?? null, c.get('userId'))
    .first();
  return c.json(wine);
});
