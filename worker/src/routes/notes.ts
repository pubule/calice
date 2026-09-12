import { Hono } from 'hono';
import { requireAuth } from '../lib/session';
import { isCellarMember } from '../lib/cellars';
import type { Env } from '../index';

export const noteRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
noteRoutes.use('*', requireAuth);

const TASTE_AXES = ['tasteAcidity', 'tasteSweetness', 'tasteTannin', 'tasteBody'] as const;
const MAX_TAGS = 20;
const MAX_TAG_LEN = 40;

// Flavour notes and food pairings are optional structured tags alongside the
// free-text note — a viewer can log just these without writing a paragraph,
// so text is no longer required (still capped, still trimmed to a string).
function isTagArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.length <= MAX_TAGS && v.every((t) => typeof t === 'string' && t.length > 0 && t.length <= MAX_TAG_LEN);
}
function isTasteValue(v: unknown): v is number | null | undefined {
  return v == null || (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100);
}

// flavor_tags/food_pairings are stored as JSON text (D1 has no array column
// type) — parse them back out for every response instead of leaking the raw
// string to the client.
function parseNote(row: Record<string, unknown> | null) {
  if (!row) return row;
  return {
    ...row,
    flavor_tags: row.flavor_tags ? JSON.parse(row.flavor_tags as string) : [],
    food_pairings: row.food_pairings ? JSON.parse(row.food_pairings as string) : [],
  };
}

noteRoutes.post('/:bottleId/notes', async (c) => {
  const bottleId = Number(c.req.param('bottleId'));
  const userId = c.get('userId');
  const bottle = await c.env.DB.prepare('select cellar_id from bottles where id = ?').bind(bottleId).first<{ cellar_id: number }>();
  if (!bottle || !(await isCellarMember(c.env.DB, bottle.cellar_id, userId))) return c.json({ error: 'not found' }, 404);
  const body = await c.req.json<{
    rating: number; text: string; flavorTags?: string[]; foodPairings?: string[];
    tasteAcidity?: number | null; tasteSweetness?: number | null; tasteTannin?: number | null; tasteBody?: number | null;
  }>();
  if (typeof body.rating !== 'number' || Number.isNaN(body.rating) || body.rating < 0 || body.rating > 5) {
    return c.json({ error: 'rating must be a number between 0 and 5' }, 400);
  }
  if (typeof body.text !== 'string' || body.text.length > 2000) {
    return c.json({ error: 'text must be a string up to 2000 chars' }, 400);
  }
  if (body.flavorTags != null && !isTagArray(body.flavorTags)) {
    return c.json({ error: `flavorTags must be an array of up to ${MAX_TAGS} strings (max ${MAX_TAG_LEN} chars each)` }, 400);
  }
  if (body.foodPairings != null && !isTagArray(body.foodPairings)) {
    return c.json({ error: `foodPairings must be an array of up to ${MAX_TAGS} strings (max ${MAX_TAG_LEN} chars each)` }, 400);
  }
  for (const axis of TASTE_AXES) {
    if (!isTasteValue(body[axis])) return c.json({ error: `${axis} must be an integer between 0 and 100` }, 400);
  }
  const note = await c.env.DB
    .prepare(
      `insert into tasting_notes (bottle_id, user_id, rating, text, flavor_tags, food_pairings, taste_acidity, taste_sweetness, taste_tannin, taste_body)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) returning *`,
    )
    .bind(
      bottleId, userId, body.rating, body.text,
      body.flavorTags?.length ? JSON.stringify(body.flavorTags) : null,
      body.foodPairings?.length ? JSON.stringify(body.foodPairings) : null,
      body.tasteAcidity ?? null, body.tasteSweetness ?? null, body.tasteTannin ?? null, body.tasteBody ?? null,
    )
    .first();
  return c.json(parseNote(note));
});

noteRoutes.get('/:bottleId/notes', async (c) => {
  const bottleId = Number(c.req.param('bottleId'));
  const userId = c.get('userId');
  const rows = await c.env.DB
    .prepare(
      `select tasting_notes.*, users.name as author_name
       from tasting_notes
       join users on users.id = tasting_notes.user_id
       join bottles on bottles.id = tasting_notes.bottle_id
       where tasting_notes.bottle_id = ?
         and (
           tasting_notes.user_id = ?
           or tasting_notes.user_id in (select followee_id from follows where follower_id = ?)
           or (
             tasting_notes.user_id in (select user_id from cellar_members where cellar_id = bottles.cellar_id)
             and ? in (select user_id from cellar_members where cellar_id = bottles.cellar_id)
           )
         )
       order by tasting_notes.created_at desc`,
    )
    .bind(bottleId, userId, userId, userId)
    .all();
  return c.json(rows.results.map(parseNote));
});
