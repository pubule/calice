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

// SQLite's LIKE ignores case only for ASCII and never ignores accents, so
// "saten" missed "Satèn". Search runs on wines.search_text instead: the
// searchable fields folded here (accents stripped, lowercase, curly
// apostrophes made straight). Exported for the tests.
export function foldSearch(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’‘`´]/g, "'").toLowerCase().replace(/\s+/g, ' ').trim();
}

type SearchRow = { id: number; name: string; producer: string; region: string | null; denomination: string | null; grape_variety: string | null };

// Every write to a wine sets search_text back to NULL (no write path can
// forget to keep it current); this refills the NULL rows before a search.
// After the first run it touches only wines added or edited since.
async function refreshSearchText(db: D1Database) {
  const stale = await db
    .prepare('select id, name, producer, region, denomination, grape_variety from wines where search_text is null limit 500')
    .all<SearchRow>();
  if (!stale.results.length) return;
  await db.batch(stale.results.map((w) =>
    db.prepare('update wines set search_text = ? where id = ?')
      .bind(foldSearch([w.name, w.producer, w.region, w.denomination, w.grape_variety].filter(Boolean).join(' ')), w.id),
  ));
}

wineRoutes.get('/search', async (c) => {
  const barcode = c.req.query('barcode');
  if (barcode) {
    const rows = await c.env.DB.prepare('select * from wines where barcode = ? limit 20').bind(barcode).all();
    return c.json(rows.results);
  }
  // An empty q must not fall through to `like '%%'`, which matches every
  // row and hands back the whole catalogue as if it were a result set. The
  // caller asked for nothing, so nothing comes back.
  // Every word must appear, in any order ("zamuner brut"), accents ignored.
  // LIKE wildcards typed by the user are escaped, so they match literally.
  const words = foldSearch(c.req.query('q') ?? '').split(' ').filter(Boolean).slice(0, 6);
  if (!words.length) return c.json([]);
  await refreshSearchText(c.env.DB);
  const rows = await c.env.DB
    .prepare(`select * from wines where ${words.map(() => "search_text like ? escape '\\'").join(' and ')} order by name limit 20`)
    .bind(...words.map((w) => `%${w.replace(/[\\%_]/g, (ch) => '\\' + ch)}%`))
    .all<Record<string, unknown>>();
  return c.json(rows.results.map(({ search_text: _, ...wine }) => wine));
});

wineRoutes.post('/', async (c) => {
  const body = await c.req.json<{
    name: string; producer: string; region?: string; country: string; type: string; vintage?: number; barcode?: string;
    grapeVariety?: string; denomination?: string; imageUrl?: string; vivinoRating?: number; vivinoRatingsCount?: number;
  }>();

  if (!isNonEmptyShortString(body.name)) return c.json({ error: 'name is required (1-200 chars)' }, 400);
  if (!isNonEmptyShortString(body.producer)) return c.json({ error: 'producer is required (1-200 chars)' }, 400);
  if (!isNonEmptyShortString(body.country)) return c.json({ error: 'country is required (1-200 chars)' }, 400);
  // Vivino's rating comes as a pair (average 1-5, number of ratings) or not at all.
  const hasRating = body.vivinoRating != null || body.vivinoRatingsCount != null;
  if (hasRating && !(typeof body.vivinoRating === 'number' && body.vivinoRating >= 1 && body.vivinoRating <= 5
    && Number.isInteger(body.vivinoRatingsCount) && (body.vivinoRatingsCount as number) > 0)) {
    return c.json({ error: 'vivinoRating must be 1-5 with a positive integer vivinoRatingsCount' }, 400);
  }
  const vivinoRating = hasRating ? Math.round((body.vivinoRating as number) * 10) / 10 : null;
  const vivinoCount = hasRating ? body.vivinoRatingsCount as number : null;
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

  // The catalog is shared: adding the same bottle twice (or two members adding
  // the same web-search result) used to create one wine row per add, so the
  // catalog filled with copies. Same name + producer + vintage (case and
  // surrounding spaces ignored, null vintage matching null) is the same wine:
  // reuse it. Only blanks are filled from the new data — never overwrite what
  // the existing row (possibly edited by someone) already says.
  const existing = await c.env.DB
    .prepare(
      `select id from wines
       where lower(trim(name)) = lower(trim(?)) and lower(trim(producer)) = lower(trim(?)) and vintage is ?
       order by id limit 1`,
    )
    .bind(body.name, body.producer, body.vintage ?? null)
    .first<{ id: number }>();
  if (existing) {
    const wine = await c.env.DB
      .prepare(
        `update wines set region = coalesce(region, ?), barcode = coalesce(barcode, ?), grape_variety = coalesce(grape_variety, ?),
           denomination = coalesce(denomination, ?), image_url = coalesce(image_url, ?), search_text = null,
           vivino_rating = coalesce(?, vivino_rating), vivino_ratings_count = coalesce(?, vivino_ratings_count)
         where id = ? returning *`,
      )
      .bind(body.region ?? null, body.barcode ?? null, body.grapeVariety ?? null, body.denomination ?? null, body.imageUrl ?? null,
        vivinoRating, vivinoCount, existing.id)
      .first();
    return c.json(wine);
  }

  const wine = await c.env.DB
    .prepare(
      `insert into wines (name, producer, region, country, type, vintage, barcode, grape_variety, denomination, image_url,
         vivino_rating, vivino_ratings_count, source, created_by)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'custom', ?) returning *`,
    )
    .bind(
      body.name, body.producer, body.region ?? null, body.country, type, body.vintage ?? null, body.barcode ?? null,
      body.grapeVariety ?? null, body.denomination ?? null, body.imageUrl ?? null, vivinoRating, vivinoCount, c.get('userId'),
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
      `update wines set name = ?, producer = ?, region = ?, country = ?, type = ?, vintage = ?, grape_variety = ?, denomination = ?,
         search_text = null
       where id = ? returning *`,
    )
    .bind(
      body.name, body.producer, body.region ?? null, body.country, type,
      body.vintage ?? null, body.grapeVariety ?? null, body.denomination ?? null, id,
    )
    .first();
  return c.json(wine);
});
