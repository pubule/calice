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

// Detects real image type from magic bytes — never trust the client-supplied File.type,
// it's fully attacker-controlled and was the vector for a stored-XSS finding.
const IMAGE_SIGNATURES: { type: string; magic: number[]; offset?: number }[] = [
  { type: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
  { type: 'image/png', magic: [0x89, 0x50, 0x4e, 0x47] },
  { type: 'image/gif', magic: [0x47, 0x49, 0x46, 0x38] },
  { type: 'image/webp', magic: [0x57, 0x45, 0x42, 0x50], offset: 8 }, // RIFF....WEBP
];

function detectImageType(bytes: ArrayBuffer): string | null {
  const view = new Uint8Array(bytes);
  for (const { type, magic, offset = 0 } of IMAGE_SIGNATURES) {
    if (view.length >= offset + magic.length && magic.every((b, i) => view[offset + i] === b)) return type;
  }
  return null;
}

photoRoutes.post('/:bottleId/photos', async (c) => {
  const bottleId = Number(c.req.param('bottleId'));
  const userId = c.get('userId');
  if (!(await assertBottleAccess(c.env, bottleId, userId))) return c.json({ error: 'not found' }, 404);
  const form = await c.req.formData();
  const file = form.get('file') as File | null;
  if (!file) return c.json({ error: 'file required' }, 400);

  const bytes = await file.arrayBuffer();
  const detectedType = detectImageType(bytes);
  if (!detectedType) return c.json({ error: 'invalid image' }, 400);

  const key = `bottles/${bottleId}/${crypto.randomUUID()}`;
  await c.env.PHOTOS.put(key, bytes, { httpMetadata: { contentType: detectedType } });

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

export const photoFileRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
photoFileRoutes.use('*', requireAuth);

photoFileRoutes.get('/:key', async (c) => {
  const key = decodeURIComponent(c.req.param('key'));
  const photo = await c.env.DB.prepare('select bottle_id from photos where r2_key = ?').bind(key).first<{ bottle_id: number }>();
  if (!photo || !(await assertBottleAccess(c.env, photo.bottle_id, c.get('userId')))) return c.notFound();

  const object = await c.env.PHOTOS.get(key);
  if (!object) return c.notFound();
  return new Response(object.body, {
    headers: {
      'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'x-content-type-options': 'nosniff',
    },
  });
});
