import { Hono } from 'hono';
import { requireAuth } from '../lib/session';
import { isCellarMember } from '../lib/cellars';
import type { Env } from '../index';

export const noteRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
noteRoutes.use('*', requireAuth);

const TASTE_AXES = ['tasteAcidity', 'tasteSweetness', 'tasteTannin', 'tasteBody', 'tasteAlcohol', 'tasteIntensity', 'tasteFinish'] as const;
// The aroma and pairing lists are long (tasting-profile.js), so a thorough
// note can legitimately tick more than a handful.
export const MAX_TAGS = 40;
const MAX_TAG_LEN = 40;

// Flavour notes and food pairings are optional structured tags alongside the
// free-text note — a viewer can log just these without writing a paragraph,
// so text is no longer required (still capped, still trimmed to a string).
export function isTagArray(v: unknown): v is string[] {
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

export type NoteBody = {
  rating: number; text: string; flavorTags?: string[]; foodPairings?: string[];
  tasteAcidity?: number | null; tasteSweetness?: number | null; tasteTannin?: number | null; tasteBody?: number | null;
  tasteAlcohol?: number | null; tasteIntensity?: number | null; tasteFinish?: number | null;
};

// Shared by create and update: same rules either way.
export function validateNote(body: NoteBody): string | null {
  if (typeof body.rating !== 'number' || Number.isNaN(body.rating) || body.rating < 0 || body.rating > 5) {
    return 'rating must be a number between 0 and 5';
  }
  if (typeof body.text !== 'string' || body.text.length > 2000) return 'text must be a string up to 2000 chars';
  if (body.flavorTags != null && !isTagArray(body.flavorTags)) {
    return `flavorTags must be an array of up to ${MAX_TAGS} strings (max ${MAX_TAG_LEN} chars each)`;
  }
  if (body.foodPairings != null && !isTagArray(body.foodPairings)) {
    return `foodPairings must be an array of up to ${MAX_TAGS} strings (max ${MAX_TAG_LEN} chars each)`;
  }
  for (const axis of TASTE_AXES) {
    if (!isTasteValue(body[axis])) return `${axis} must be an integer between 0 and 100`;
  }
  return null;
}

function noteValues(body: NoteBody) {
  return [
    body.rating, body.text,
    body.flavorTags?.length ? JSON.stringify(body.flavorTags) : null,
    body.foodPairings?.length ? JSON.stringify(body.foodPairings) : null,
    body.tasteAcidity ?? null, body.tasteSweetness ?? null, body.tasteTannin ?? null, body.tasteBody ?? null,
    body.tasteAlcohol ?? null, body.tasteIntensity ?? null, body.tasteFinish ?? null,
  ];
}

noteRoutes.post('/:bottleId/notes', async (c) => {
  const bottleId = Number(c.req.param('bottleId'));
  const userId = c.get('userId');
  const bottle = await c.env.DB.prepare('select cellar_id from bottles where id = ?').bind(bottleId).first<{ cellar_id: number }>();
  if (!bottle || !(await isCellarMember(c.env.DB, bottle.cellar_id, userId))) return c.json({ error: 'not found' }, 404);
  const body = await c.req.json<NoteBody>();
  const error = validateNote(body);
  if (error) return c.json({ error }, 400);
  const note = await c.env.DB
    .prepare(
      `insert into tasting_notes (bottle_id, user_id, rating, text, flavor_tags, food_pairings, taste_acidity, taste_sweetness, taste_tannin, taste_body,
         taste_alcohol, taste_intensity, taste_finish)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) returning *`,
    )
    .bind(bottleId, userId, ...noteValues(body))
    .first();
  return c.json(parseNote(note));
});

// Saving again from the same open sheet updates the note it just created
// instead of adding a near-identical one. The client always sends the whole
// composer, so every field is overwritten (CLAUDE.md: no coalesce when the
// client sends the full form). Only the note's author, on that bottle.
noteRoutes.patch('/:bottleId/notes/:noteId', async (c) => {
  const bottleId = Number(c.req.param('bottleId'));
  const noteId = Number(c.req.param('noteId'));
  const userId = c.get('userId');
  const body = await c.req.json<NoteBody>();
  const error = validateNote(body);
  if (error) return c.json({ error }, 400);
  const note = await c.env.DB
    .prepare(
      `update tasting_notes
       set rating = ?, text = ?, flavor_tags = ?, food_pairings = ?, taste_acidity = ?, taste_sweetness = ?, taste_tannin = ?, taste_body = ?,
         taste_alcohol = ?, taste_intensity = ?, taste_finish = ?
       where id = ? and bottle_id = ? and user_id = ?
       returning *`,
    )
    .bind(...noteValues(body), noteId, bottleId, userId)
    .first();
  if (!note) return c.json({ error: 'not found' }, 404);
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

// "Il mio palato" in the aroma wheel: how often the caller picked each aroma
// across all their own notes. Counted here rather than shipping every note to
// the client; flavor_tags is a JSON array per note (see parseNote).
export const palateRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
palateRoutes.use('*', requireAuth);

palateRoutes.get('/palate', async (c) => {
  const rows = await c.env.DB
    // Notes on bottles and guided tastings (tastings.ts) both feed the palate.
    .prepare(
      `select flavor_tags, null as mouth_tags from tasting_notes where user_id = ? and flavor_tags is not null
       union all
       select flavor_tags, mouth_tags from tastings where user_id = ? and (flavor_tags is not null or mouth_tags is not null)`,
    )
    .bind(c.get('userId'), c.get('userId'))
    .all<{ flavor_tags: string | null; mouth_tags: string | null }>();
  const tags: Record<string, number> = {};
  const parse = (raw: string | null): unknown[] => {
    try {
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  };
  for (const row of rows.results) {
    // An aroma noted both on the nose and in the mouth counts once per tasting.
    for (const t of new Set([...parse(row.flavor_tags), ...parse(row.mouth_tags)])) {
      if (typeof t === 'string') tags[t] = (tags[t] ?? 0) + 1;
    }
  }
  return c.json({ notes: rows.results.length, tags });
});
