import { Hono } from 'hono';
import { requireAuth } from '../lib/session';
import { isCellarMember } from '../lib/cellars';
import type { Env } from '../index';

export const photoRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
photoRoutes.use('*', requireAuth);

async function assertBottleAccess(env: Env, bottleId: number, userId: number): Promise<boolean> {
  const bottle = await env.DB.prepare('select cellar_id from bottles where id = ?').bind(bottleId).first<{ cellar_id: number }>();
  if (!bottle) return false;
  return isCellarMember(env.DB, bottle.cellar_id, userId);
}

photoRoutes.post('/:bottleId/photos', async (c) => {
  const bottleId = Number(c.req.param('bottleId'));
  const userId = c.get('userId');
  if (!(await assertBottleAccess(c.env, bottleId, userId))) return c.json({ error: 'not found' }, 404);
  const form = await c.req.formData();
  const file = form.get('file') as File | null;
  if (!file) return c.json({ error: 'file required' }, 400);

  const key = `bottles/${bottleId}/${crypto.randomUUID()}`;
  await c.env.PHOTOS.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });

  const row = await c.env.DB
    .prepare('insert into photos (bottle_id, r2_key, uploaded_by) values (?, ?, ?) returning *')
    .bind(bottleId, key, userId)
    .first<{ id: number }>();

  return c.json({ id: row!.id, url: `/api/photos/${encodeURIComponent(key)}` });
});

photoRoutes.get('/:bottleId/photos', async (c) => {
  const bottleId = Number(c.req.param('bottleId'));
  const userId = c.get('userId');
  if (!(await assertBottleAccess(c.env, bottleId, userId))) return c.json({ error: 'not found' }, 404);
  const rows = await c.env.DB.prepare('select id, r2_key from photos where bottle_id = ? order by created_at desc').bind(bottleId).all<{ id: number; r2_key: string }>();
  return c.json(rows.results.map((r) => ({ id: r.id, url: `/api/photos/${encodeURIComponent(r.r2_key)}` })));
});

export const photoFileRoutes = new Hono<{ Bindings: Env }>();

photoFileRoutes.get('/:key', async (c) => {
  const key = decodeURIComponent(c.req.param('key'));
  const object = await c.env.PHOTOS.get(key);
  if (!object) return c.notFound();
  return new Response(object.body, {
    headers: { 'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream' },
  });
});
