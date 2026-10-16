import { Hono } from 'hono';
import { requireAuth } from '../lib/session';
import { fetchWithTimeout } from '../lib/fetch-timeout';
import { detectImageType } from './photos';
import type { Env } from '../index';

// The wine's main photo (wines.image_url, the one in the wine's sheet and in
// the lists), chosen by the user when the one from Vivino is missing or
// generic: a photo from the phone, or an image copied from the web (sent as
// the image itself or as its link, which the Worker downloads). Stored in R2
// under wines/<id>/…, served by /api/wine-images/<key>.

const MAX_BYTES = 5_000_000;
const PREFIX = '/api/wine-images/';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

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

// The bytes of an image link, or an error message for the user.
export async function downloadImage(url: string, fetchImpl: typeof fetch = fetch): Promise<ArrayBuffer | string> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'not a link';
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'not a link';
  const res = await fetchWithTimeout(u.href, 8000, fetchImpl, { headers: { 'user-agent': UA, accept: 'image/*' }, redirect: 'follow' });
  if (!res?.ok) return 'download failed';
  if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) return 'too big';
  const bytes = await res.arrayBuffer().catch(() => null);
  if (!bytes) return 'download failed';
  if (bytes.byteLength > MAX_BYTES) return 'too big';
  return bytes;
}

export const wineImageRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
wineImageRoutes.use('*', requireAuth);

async function dropOwnImage(env: Env, wineId: number) {
  const row = await env.DB.prepare('select image_url from wines where id = ?').bind(wineId).first<{ image_url: string | null }>();
  if (!row?.image_url?.startsWith(PREFIX)) return;
  // Another vintage of the same wine can share the photo (copied with it):
  // the file goes only when no other wine still shows it.
  const shared = await env.DB.prepare('select 1 from wines where image_url = ? and id != ? limit 1').bind(row.image_url, wineId).first();
  if (!shared) await env.PHOTOS.delete(decodeURIComponent(row.image_url.slice(PREFIX.length)));
}

// PUT /api/wines/:id/image — multipart "file", or JSON { url }.
wineImageRoutes.put('/:id/image', async (c) => {
  const id = Number(c.req.param('id'));
  if (!(await hasWineAccess(c.env, id, c.get('userId')))) return c.json({ error: 'not found' }, 404);
  let bytes: ArrayBuffer;
  if ((c.req.header('content-type') ?? '').includes('application/json')) {
    const { url } = await c.req.json<{ url?: string }>().catch(() => ({ url: undefined }));
    const got = await downloadImage(String(url ?? ''));
    if (typeof got === 'string') return c.json({ error: got }, 400);
    bytes = got;
  } else {
    const form = await c.req.formData().catch(() => null);
    const file = form?.get('file');
    if (!file || typeof file === 'string') return c.json({ error: 'file required' }, 400);
    bytes = await file.arrayBuffer();
    if (bytes.byteLength > MAX_BYTES) return c.json({ error: 'too big' }, 400);
  }
  const type = detectImageType(bytes);
  if (!type) return c.json({ error: 'not an image' }, 400);
  await dropOwnImage(c.env, id);
  const key = `wines/${id}/${crypto.randomUUID()}`;
  await c.env.PHOTOS.put(key, bytes, { httpMetadata: { contentType: type } });
  const wine = await c.env.DB.prepare('update wines set image_url = ? where id = ? returning *').bind(PREFIX + encodeURIComponent(key), id).first();
  return c.json(wine);
});

// DELETE /api/wines/:id/image — back to the placeholder of the wine's type.
wineImageRoutes.delete('/:id/image', async (c) => {
  const id = Number(c.req.param('id'));
  if (!(await hasWineAccess(c.env, id, c.get('userId')))) return c.json({ error: 'not found' }, 404);
  await dropOwnImage(c.env, id);
  const wine = await c.env.DB.prepare('update wines set image_url = null where id = ? returning *').bind(id).first();
  return c.json(wine);
});

export const wineImageFileRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
wineImageFileRoutes.use('*', requireAuth);

// The catalog is shared, so any signed-in user may see a wine's photo. A key
// is never reused (a new photo gets a new one): cached for good.
wineImageFileRoutes.get('/:key', async (c) => {
  const key = decodeURIComponent(c.req.param('key'));
  if (!key.startsWith('wines/')) return c.notFound();
  const object = await c.env.PHOTOS.get(key);
  if (!object) return c.notFound();
  return new Response(object.body, {
    headers: {
      'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'cache-control': 'private, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  });
});
