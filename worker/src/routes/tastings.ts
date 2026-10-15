import { Hono } from 'hono';
import { requireAuth } from '../lib/session';
import { validateNote, type NoteBody } from './notes';
import type { Env } from '../index';

// Assaggio guidato: tastings of a wine style that need not be in a cellar,
// private to their author. Same fields and rules as a bottle's tasting note
// (validateNote), minus food pairings, plus the style and an optional label.
export const tastingRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
tastingRoutes.use('*', requireAuth);

const MAX_LABEL_LEN = 200;

function parseTasting(row: Record<string, unknown> | null) {
  if (!row) return row;
  return { ...row, flavor_tags: row.flavor_tags ? JSON.parse(row.flavor_tags as string) : [] };
}

tastingRoutes.get('/', async (c) => {
  const rows = await c.env.DB
    .prepare('select * from tastings where user_id = ? order by created_at desc, id desc limit 100')
    .bind(c.get('userId'))
    .all();
  return c.json(rows.results.map(parseTasting));
});

tastingRoutes.post('/', async (c) => {
  const body = await c.req.json<NoteBody & { style: string; label?: string | null }>();
  if (typeof body.style !== 'string' || !body.style.trim() || body.style.length > MAX_LABEL_LEN) {
    return c.json({ error: 'style is required (1-200 chars)' }, 400);
  }
  if (body.label != null && (typeof body.label !== 'string' || body.label.length > MAX_LABEL_LEN)) {
    return c.json({ error: 'label must be a string up to 200 chars' }, 400);
  }
  const error = validateNote(body);
  if (error) return c.json({ error }, 400);
  const row = await c.env.DB
    .prepare(
      `insert into tastings (user_id, style, label, rating, text, flavor_tags,
         taste_acidity, taste_sweetness, taste_tannin, taste_body, taste_alcohol, taste_intensity, taste_finish)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) returning *`,
    )
    .bind(
      c.get('userId'), body.style.trim(), body.label?.trim() || null, body.rating, body.text,
      body.flavorTags?.length ? JSON.stringify(body.flavorTags) : null,
      body.tasteAcidity ?? null, body.tasteSweetness ?? null, body.tasteTannin ?? null, body.tasteBody ?? null,
      body.tasteAlcohol ?? null, body.tasteIntensity ?? null, body.tasteFinish ?? null,
    )
    .first();
  return c.json(parseTasting(row));
});

tastingRoutes.delete('/:id', async (c) => {
  const res = await c.env.DB
    .prepare('delete from tastings where id = ? and user_id = ?')
    .bind(Number(c.req.param('id')), c.get('userId'))
    .run();
  if (!res.meta.changes) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true });
});
