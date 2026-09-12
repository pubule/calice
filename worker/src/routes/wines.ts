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
  const body = await c.req.json<{
    name: string; producer: string; region?: string; country: string; type: string; vintage?: number; barcode?: string;
    grapeVariety?: string; denomination?: string; imageUrl?: string;
  }>();

  if (!isNonEmptyShortString(body.name)) return c.json({ error: 'name is required (1-200 chars)' }, 400);
  if (!isNonEmptyShortString(body.producer)) return c.json({ error: 'producer is required (1-200 chars)' }, 400);
  if (!isNonEmptyShortString(body.country)) return c.json({ error: 'country is required (1-200 chars)' }, 400);
  if (body.grapeVariety != null && !isNonEmptyShortString(body.grapeVariety)) {
    return c.json({ error: 'grapeVariety must be 1-200 chars' }, 400);
  }
  if (body.denomination != null && !isNonEmptyShortString(body.denomination)) {
    return c.json({ error: 'denomination must be 1-200 chars' }, 400);
  }
  if (body.imageUrl != null) {
    if (!isNonEmptyShortString(body.imageUrl)) {
      return c.json({ error: 'imageUrl must be a valid http(s) URL' }, 400);
    }
    try {
      const url = new URL(body.imageUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return c.json({ error: 'imageUrl must be a valid http(s) URL' }, 400);
      }
    } catch {
      return c.json({ error: 'imageUrl must be a valid http(s) URL' }, 400);
    }
  }
  const type = typeof body.type === 'string' ? body.type.trim().toLowerCase() : body.type;
  if (!WINE_TYPES.includes(type)) return c.json({ error: `type must be one of ${WINE_TYPES.join(', ')}` }, 400);
  if (body.vintage != null && (!Number.isInteger(body.vintage) || body.vintage < 1900 || body.vintage > 2100)) {
    return c.json({ error: 'vintage must be an integer between 1900 and 2100' }, 400);
  }

  const wine = await c.env.DB
    .prepare(
      `insert into wines (name, producer, region, country, type, vintage, barcode, grape_variety, denomination, image_url, source, created_by)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'custom', ?) returning *`,
    )
    .bind(
      body.name, body.producer, body.region ?? null, body.country, type, body.vintage ?? null, body.barcode ?? null,
      body.grapeVariety ?? null, body.denomination ?? null, body.imageUrl ?? null, c.get('userId'),
    )
    .first();
  return c.json(wine);
});

// A wine row can be referenced by bottles across several cellars (it's a
// shared catalog entry, not per-cellar), so editing it is allowed to anyone
// who has it in a cellar they belong to — not just whoever first created it.
async function hasWineAccess(env: Env, wineId: number, userId: number): Promise<boolean> {
  const row = await env.DB
    .prepare(
      `select 1 from bottles join cellar_members on cellar_members.cellar_id = bottles.cellar_id
       where bottles.wine_id = ? and cellar_members.user_id = ? limit 1`,
    )
    .bind(wineId, userId)
    .first();
  return row !== null;
}

// Full overwrite, not the coalesce-if-provided pattern bottles.ts uses for
// its plain PATCH /:id — the edit sheet always submits the whole form, and
// an optional field (region/vintage/grapeVariety/denomination) genuinely
// blanked out needs to reach the DB as NULL, which coalesce(?, column) can
// never do (it can't tell "explicitly cleared" from "field omitted").
wineRoutes.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!(await hasWineAccess(c.env, id, c.get('userId')))) return c.json({ error: 'not found' }, 404);
  const body = await c.req.json<{
    name: string; producer: string; region?: string | null; country: string; type: string; vintage?: number | null;
    grapeVariety?: string | null; denomination?: string | null;
  }>();

  if (!isNonEmptyShortString(body.name)) return c.json({ error: 'name is required (1-200 chars)' }, 400);
  if (!isNonEmptyShortString(body.producer)) return c.json({ error: 'producer is required (1-200 chars)' }, 400);
  if (!isNonEmptyShortString(body.country)) return c.json({ error: 'country is required (1-200 chars)' }, 400);
  if (body.region != null && !isNonEmptyShortString(body.region)) return c.json({ error: 'region must be 1-200 chars' }, 400);
  if (body.grapeVariety != null && !isNonEmptyShortString(body.grapeVariety)) return c.json({ error: 'grapeVariety must be 1-200 chars' }, 400);
  if (body.denomination != null && !isNonEmptyShortString(body.denomination)) return c.json({ error: 'denomination must be 1-200 chars' }, 400);
  const type = typeof body.type === 'string' ? body.type.trim().toLowerCase() : body.type;
  if (!WINE_TYPES.includes(type)) return c.json({ error: `type must be one of ${WINE_TYPES.join(', ')}` }, 400);
  if (body.vintage != null && (!Number.isInteger(body.vintage) || body.vintage < 1900 || body.vintage > 2100)) {
    return c.json({ error: 'vintage must be an integer between 1900 and 2100' }, 400);
  }

  const wine = await c.env.DB
    .prepare(
      `update wines set name = ?, producer = ?, region = ?, country = ?, type = ?, vintage = ?, grape_variety = ?, denomination = ?
       where id = ? returning *`,
    )
    .bind(
      body.name, body.producer, body.region ?? null, body.country, type,
      body.vintage ?? null, body.grapeVariety ?? null, body.denomination ?? null, id,
    )
    .first();
  return c.json(wine);
});
