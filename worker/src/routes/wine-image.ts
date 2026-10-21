import { Hono } from 'hono';
import { requireAuth } from '../lib/session';
import { fetchWithTimeout } from '../lib/fetch-timeout';
import { detectImageType } from './photos';
import { ownsWine } from '../lib/wine-owner';
import type { Env } from '../index';

// The wine's main photo (wines.image_url, the one in the wine's sheet and in
// the lists), chosen by the user when the one from Vivino is missing or
// generic: a photo from the phone, or an image copied from the web (sent as
// the image itself or as its link, which the Worker downloads). Stored in R2
// under wines/<id>/…, served by /api/wine-images/<key>.

const MAX_BYTES = 5_000_000;
// A small copy for the lists, made by the phone and saved next to the photo
// as <key>.thumb (the Worker cannot resize images for free).
const THUMB = '.thumb';
const MAX_THUMB_BYTES = 300_000;
const PREFIX = '/api/wine-images/';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

// Each user changes only their own wines' photo (wines.owner_id).
const hasWineAccess = (env: Env, wineId: number, userId: number) => ownsWine(env.DB, wineId, userId);

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

// Every photo lives in our R2, never as a link to someone else's site (the
// user's choice: a link can die, and the backups would miss it). A wine saved
// with a web image (Vivino, Open Food Facts) gets a copy here; if the download
// fails the link stays and the daily cron tries again. The update only lands
// if the link is still the wine's photo, so a photo chosen meanwhile wins.
export async function copyImageToR2(env: Pick<Env, 'DB' | 'PHOTOS'>, wineId: number, url: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const got = await downloadImage(url, fetchImpl).catch(() => 'download failed');
  if (typeof got === 'string') return false;
  const type = detectImageType(got);
  if (!type) return false;
  const key = `wines/${wineId}/${crypto.randomUUID()}`;
  await env.PHOTOS.put(key, got, { httpMetadata: { contentType: type } });
  const done = await env.DB.prepare('update wines set image_url = ? where id = ? and image_url = ?').bind(PREFIX + encodeURIComponent(key), wineId, url).run();
  if (!done.meta.changes) await env.PHOTOS.delete(key);
  return !!done.meta.changes;
}

// Daily cron: the wines still showing a web link (download failed when saved).
export async function copyExternalImages(env: Pick<Env, 'DB' | 'PHOTOS'>, fetchImpl: typeof fetch = fetch, limit = 25) {
  const rows = await env.DB.prepare(`select id, image_url from wines where image_url like 'http%' order by id limit ?`).bind(limit).all<{ id: number; image_url: string }>();
  let copied = 0;
  for (const w of rows.results) if (await copyImageToR2(env, w.id, w.image_url, fetchImpl)) copied++;
  return { copied, left: rows.results.length - copied };
}

export const wineImageRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
wineImageRoutes.use('*', requireAuth);

async function dropOwnImage(env: Env, wineId: number) {
  const row = await env.DB.prepare('select image_url from wines where id = ?').bind(wineId).first<{ image_url: string | null }>();
  if (!row?.image_url?.startsWith(PREFIX)) return;
  // Another vintage of the same wine can share the photo (copied with it):
  // the file goes only when no other wine still shows it.
  // Compared as decoded keys: the same key written with another encoding
  // ("/" vs "%2F") is still the same file.
  const keyOf = (url: string) => { try { return decodeURIComponent(url.slice(PREFIX.length)); } catch { return null; } };
  const key = keyOf(row.image_url);
  if (!key?.startsWith('wines/')) return;
  const others = await env.DB.prepare(`select image_url from wines where image_url like '/api/wine-images/%' and id != ?`).bind(wineId).all<{ image_url: string }>();
  if (!others.results.some((w) => keyOf(w.image_url) === key)) await env.PHOTOS.delete([key, key + THUMB]);
}

// PUT /api/wines/:id/image — multipart "file" (and optionally "thumb"), or JSON { url }.
wineImageRoutes.put('/:id/image', async (c) => {
  const id = Number(c.req.param('id'));
  if (!(await hasWineAccess(c.env, id, c.get('userId')))) return c.json({ error: 'not found' }, 404);
  let bytes: ArrayBuffer;
  let thumb: ArrayBuffer | null = null;
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
    const small = form?.get('thumb');
    if (small && typeof small !== 'string') {
      thumb = await small.arrayBuffer();
      if (thumb.byteLength > MAX_THUMB_BYTES || !detectImageType(thumb)) return c.json({ error: 'bad thumb' }, 400);
    }
  }
  const type = detectImageType(bytes);
  if (!type) return c.json({ error: 'not an image' }, 400);
  await dropOwnImage(c.env, id);
  const key = `wines/${id}/${crypto.randomUUID()}`;
  await c.env.PHOTOS.put(key, bytes, { httpMetadata: { contentType: type } });
  if (thumb) await c.env.PHOTOS.put(key + THUMB, thumb, { httpMetadata: { contentType: detectImageType(thumb)! } });
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
// ?thumb=1 serves the small copy; while it does not exist yet, the photo
// itself, cached briefly (X-Thumb: 0) so the small copy shows once made.
wineImageFileRoutes.get('/:key', async (c) => {
  const key = decodeURIComponent(c.req.param('key'));
  if (!key.startsWith('wines/') || key.endsWith(THUMB)) return c.notFound();
  const small = c.req.query('thumb') ? await c.env.PHOTOS.get(key + THUMB) : null;
  const object = small ?? (await c.env.PHOTOS.get(key));
  if (!object) return c.notFound();
  const headers: Record<string, string> = {
    'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
    'cache-control': c.req.query('thumb') && !small ? 'private, max-age=60' : 'private, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
  };
  if (c.req.query('thumb')) headers['x-thumb'] = small ? '1' : '0';
  return new Response(object.body, { headers });
});
