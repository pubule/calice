import { Hono } from 'hono';
import { requireAuth } from '../lib/session';
import { isCellarMember } from '../lib/cellars';
import type { Env } from '../index';

const KINDS = ['Scaffale', 'Rack', 'Cella', 'Scatolone'];

export const cellarElementRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
cellarElementRoutes.use('*', requireAuth);

cellarElementRoutes.get('/:cellarId/elements', async (c) => {
  const cellarId = Number(c.req.param('cellarId'));
  if (!(await isCellarMember(c.env.DB, cellarId, c.get('userId')))) return c.json({ error: 'not a member' }, 403);
  const rows = await c.env.DB.prepare('select * from cellar_elements where cellar_id = ? order by id').bind(cellarId).all();
  return c.json(rows.results);
});

cellarElementRoutes.post('/:cellarId/elements', async (c) => {
  const cellarId = Number(c.req.param('cellarId'));
  if (!(await isCellarMember(c.env.DB, cellarId, c.get('userId')))) return c.json({ error: 'not a member' }, 403);
  const body = await c.req.json<{ kind: string; name: string; tiers?: number; cols?: number; depth?: number }>();
  if (!KINDS.includes(body.kind)) return c.json({ error: 'invalid kind' }, 400);
  if (!body.name?.trim()) return c.json({ error: 'name required' }, 400);
  for (const n of [body.tiers, body.cols, body.depth]) {
    if (n !== undefined && !Number.isInteger(n)) return c.json({ error: 'tiers/cols/depth must be integers' }, 400);
  }
  const el = await c.env.DB
    .prepare('insert into cellar_elements (cellar_id, kind, name, tiers, cols, depth) values (?, ?, ?, ?, ?, ?) returning *')
    .bind(cellarId, body.kind, body.name, body.tiers ?? null, body.cols ?? null, body.depth ?? null)
    .first();
  return c.json(el);
});

export const elementRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
elementRoutes.use('*', requireAuth);

async function assertElementAccess(env: Env, elementId: number, userId: number): Promise<boolean> {
  const el = await env.DB.prepare('select cellar_id from cellar_elements where id = ?').bind(elementId).first<{ cellar_id: number }>();
  if (!el) return false;
  return isCellarMember(env.DB, el.cellar_id, userId);
}

elementRoutes.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!(await assertElementAccess(c.env, id, c.get('userId')))) return c.json({ error: 'not found' }, 404);
  // Unassign any bottle that lived here rather than leaving a dangling FK.
  await c.env.DB
    .prepare('update bottles set element_id = null, slot_tier = null, slot_col = null, slot_depth = null where element_id = ?')
    .bind(id)
    .run();
  await c.env.DB.prepare('delete from cellar_elements where id = ?').bind(id).run();
  return c.json({ ok: true });
});
