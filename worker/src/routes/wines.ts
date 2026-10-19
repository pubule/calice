import { Hono } from 'hono';
import { requireAuth } from '../lib/session';
import { wineOfVintage } from '../lib/wine-vintage';
import { copyImageToR2 } from './wine-image';
import { completeness, ownWineId, ownsWine } from '../lib/wine-owner';
import type { Env } from '../index';

export const wineRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
wineRoutes.use('*', requireAuth);

const WINE_TYPES = ['rosso', 'bianco', 'bollicine', 'rosato'];
const MAX_TEXT_LEN = 200;

function isNonEmptyShortString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= MAX_TEXT_LEN;
}

// The fields that usually come from Vivino and that the user can also edit:
// alcohol (% vol), the producer's website, Vivino's rating (1-5) and how many
// ratings it averages. Each is optional and nullable; a ratings count needs
// a rating (a hand-edited rating may have none).
type Extras = { alcohol: number | null; producerUrl: string | null; vivinoRating: number | null; vivinoCount: number | null };
function readExtras(body: { alcohol?: number | null; producerUrl?: string | null; vivinoRating?: number | null; vivinoRatingsCount?: number | null }): Extras | { error: string } {
  if (body.alcohol != null && !(typeof body.alcohol === 'number' && body.alcohol > 0 && body.alcohol <= 25)) {
    return { error: 'alcohol must be a number between 0 and 25' };
  }
  if (body.producerUrl != null && !isHttpUrl(body.producerUrl)) return { error: 'producerUrl must be a valid http(s) URL' };
  if (body.vivinoRating != null && !(typeof body.vivinoRating === 'number' && body.vivinoRating >= 1 && body.vivinoRating <= 5)) {
    return { error: 'vivinoRating must be between 1 and 5' };
  }
  if (body.vivinoRatingsCount != null && (body.vivinoRating == null || !Number.isInteger(body.vivinoRatingsCount) || body.vivinoRatingsCount <= 0)) {
    return { error: 'vivinoRatingsCount must be a positive integer, with a vivinoRating' };
  }
  return {
    alcohol: body.alcohol ?? null,
    producerUrl: body.producerUrl ?? null,
    vivinoRating: body.vivinoRating != null ? Math.round(body.vivinoRating * 10) / 10 : null,
    vivinoCount: body.vivinoRatingsCount ?? null,
  };
}

function isHttpUrl(v: unknown): boolean {
  if (!isNonEmptyShortString(v)) return false;
  try {
    const url = new URL(v);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
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
    const rows = await c.env.DB.prepare('select * from wines where barcode = ? limit 200').bind(barcode).all<Record<string, unknown>>();
    return c.json(oneWineEach(rows.results, c.get('userId')).slice(0, 20));
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
    .prepare(`select * from wines where ${words.map(() => "search_text like ? escape '\\'").join(' and ')} order by name limit 200`)
    .bind(...words.map((w) => `%${w.replace(/[\\%_]/g, (ch) => '\\' + ch)}%`))
    .all<Record<string, unknown>>();
  return c.json(oneWineEach(rows.results, c.get('userId')).slice(0, 20));
});

// The search is shared by all users (their wines are the catalogue) but each
// user has their own rows: one result per wine (name + producer + vintage),
// with the data of its most complete record. When the caller has that wine,
// the result carries the caller's own id (adding it fills its gaps, see
// ownWineId), so "already in the cellar" still recognises it.
function oneWineEach(rows: Record<string, unknown>[], userId: number) {
  const key = (w: Record<string, unknown>) => `${foldSearch(String(w.name))}|${foldSearch(String(w.producer))}|${w.vintage ?? ''}`;
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const w of rows) groups.set(key(w), [...(groups.get(key(w)) ?? []), w]);
  return [...groups.values()].map((same) => {
    const best = same.reduce((a, b) => (completeness(b) > completeness(a) ? b : a));
    const mine = same.find((w) => w.owner_id === userId);
    const { search_text: _s, owner_id: _o, created_by: _c, ...data } = best;
    return mine ? { ...data, id: mine.id } : data;
  });
}

// A web image becomes our copy before the wine goes back to the app.
async function withOwnImage(c: { env: Env }, wine: Record<string, unknown> | null) {
  const url = wine?.image_url;
  if (typeof url !== 'string' || !url.startsWith('http')) return wine;
  if (!(await copyImageToR2(c.env, Number(wine!.id), url))) return wine;
  return c.env.DB.prepare('select * from wines where id = ?').bind(wine!.id).first();
}

wineRoutes.post('/', async (c) => {
  const body = await c.req.json<{
    name: string; producer: string; region?: string; country: string; type: string; vintage?: number; barcode?: string;
    grapeVariety?: string; denomination?: string; imageUrl?: string; vivinoRating?: number; vivinoRatingsCount?: number;
    alcohol?: number; producerUrl?: string;
  }>();

  if (!isNonEmptyShortString(body.name)) return c.json({ error: 'name is required (1-200 chars)' }, 400);
  if (!isNonEmptyShortString(body.producer)) return c.json({ error: 'producer is required (1-200 chars)' }, 400);
  if (!isNonEmptyShortString(body.country)) return c.json({ error: 'country is required (1-200 chars)' }, 400);
  const extras = readExtras(body);
  if ('error' in extras) return c.json({ error: extras.error }, 400);
  const { vivinoRating, vivinoCount } = extras;
  if (body.grapeVariety != null && !isNonEmptyShortString(body.grapeVariety)) {
    return c.json({ error: 'grapeVariety must be 1-200 chars' }, 400);
  }
  if (body.denomination != null && !isNonEmptyShortString(body.denomination)) {
    return c.json({ error: 'denomination must be 1-200 chars' }, 400);
  }
  // A wine photo already in our R2 (suggested from the catalog) is kept as is,
  // but only one a catalog wine already shows: any other key could later be
  // deleted from R2 by "Rimuovi foto".
  if (isNonEmptyShortString(body.imageUrl) && body.imageUrl.startsWith('/api/wine-images/')) {
    const known = await c.env.DB.prepare('select 1 from wines where image_url = ? limit 1').bind(body.imageUrl).first();
    if (!known) return c.json({ error: 'imageUrl must be a valid http(s) URL' }, 400);
  } else if (body.imageUrl != null) {
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
       where lower(trim(name)) = lower(trim(?)) and lower(trim(producer)) = lower(trim(?)) and vintage is ? and (owner_id = ? or owner_id is null)
       order by owner_id is null, id limit 1`,
    )
    .bind(body.name, body.producer, body.vintage ?? null, c.get('userId'))
    .first<{ id: number }>();
  if (existing) {
    const wine = await c.env.DB
      .prepare(
        `update wines set region = coalesce(region, ?), barcode = coalesce(barcode, ?), grape_variety = coalesce(grape_variety, ?),
           denomination = coalesce(denomination, ?), image_url = coalesce(image_url, ?), search_text = null,
           vivino_rating = coalesce(?, vivino_rating), vivino_ratings_count = coalesce(?, vivino_ratings_count),
           alcohol = coalesce(alcohol, ?), producer_url = coalesce(producer_url, ?), owner_id = coalesce(owner_id, ?)
         where id = ? returning *`,
      )
      .bind(body.region ?? null, body.barcode ?? null, body.grapeVariety ?? null, body.denomination ?? null, body.imageUrl ?? null,
        vivinoRating, vivinoCount, extras.alcohol, extras.producerUrl, c.get('userId'), existing.id)
      .first();
    return c.json(await withOwnImage(c, wine));
  }

  const wine = await c.env.DB
    .prepare(
      `insert into wines (name, producer, region, country, type, vintage, barcode, grape_variety, denomination, image_url,
         vivino_rating, vivino_ratings_count, alcohol, producer_url, source, created_by, owner_id)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'custom', ?, ?) returning *`,
    )
    .bind(
      body.name, body.producer, body.region ?? null, body.country, type, body.vintage ?? null, body.barcode ?? null,
      body.grapeVariety ?? null, body.denomination ?? null, body.imageUrl ?? null, vivinoRating, vivinoCount,
      extras.alcohol, extras.producerUrl, c.get('userId'), c.get('userId'),
    )
    .first();
  return c.json(await withOwnImage(c, wine));
});

// Each user edits only their own wines (wines.owner_id).
const hasWineAccess = (env: Env, wineId: number, userId: number) => ownsWine(env.DB, wineId, userId);

// Full overwrite, not the coalesce-if-provided pattern bottles.ts uses for
// its plain PATCH /:id — the edit sheet always submits the whole form, and
// an optional field (region/vintage/grapeVariety/denomination) genuinely
// blanked out needs to reach the DB as NULL, which coalesce(?, column) can
// never do (it can't tell "explicitly cleared" from "field omitted").
// The same catalog wine in another vintage (adding a different year of a
// wine already in the catalog): returns that wine, copied if needed.
wineRoutes.post('/:id/vintage', async (c) => {
  const id = Number(c.req.param('id'));
  const { vintage } = await c.req.json<{ vintage: number | null }>();
  if (vintage !== null && !(Number.isInteger(vintage) && vintage >= 1900 && vintage <= 2100)) {
    return c.json({ error: 'vintage must be an integer between 1900 and 2100, or null' }, 400);
  }
  const own = await ownWineId(c.env.DB, id, c.get('userId'));
  if (own == null) return c.json({ error: 'not found' }, 404);
  const targetId = await wineOfVintage(c.env.DB, own, vintage, c.get('userId'));
  return c.json(await c.env.DB.prepare('select * from wines where id = ?').bind(targetId).first());
});

wineRoutes.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!(await hasWineAccess(c.env, id, c.get('userId')))) return c.json({ error: 'not found' }, 404);
  const body = await c.req.json<{
    name: string; producer: string; region?: string | null; country: string; type: string; vintage?: number | null;
    grapeVariety?: string | null; denomination?: string | null;
    alcohol?: number | null; producerUrl?: string | null; vivinoRating?: number | null; vivinoRatingsCount?: number | null;
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

  const extras = readExtras(body);
  if ('error' in extras) return c.json({ error: extras.error }, 400);

  const wine = await c.env.DB
    .prepare(
      `update wines set name = ?, producer = ?, region = ?, country = ?, type = ?, vintage = ?, grape_variety = ?, denomination = ?,
         alcohol = ?, producer_url = ?, vivino_rating = ?, vivino_ratings_count = ?, search_text = null
       where id = ? returning *`,
    )
    .bind(
      body.name, body.producer, body.region ?? null, body.country, type,
      body.vintage ?? null, body.grapeVariety ?? null, body.denomination ?? null,
      extras.alcohol, extras.producerUrl, extras.vivinoRating, extras.vivinoCount, id,
    )
    .first();
  return c.json(wine);
});
