import { api } from './api-client.js';

// Wine photos are resized here, on the phone: the Worker cannot resize
// images for free. Every photo gets a small copy for the lists (thumb),
// saved next to it and served by /api/wine-images/<key>?thumb=1.

export const PHOTO_SIDE = 900; // enough for the wine sheet at 3x
const THUMB_SIDE = 240; // the list rows at 3x

// The list rows' URL for a wine photo of ours; any other link as it is.
export const thumbOf = (url) => (url && url.startsWith('/api/wine-images/') ? `${url}?thumb=1` : url);

async function draw(blob, side) {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return { canvas, ctx };
}

// Transparent photos as WebP where the browser can write it (a fraction of a
// PNG's size), else PNG; opaque ones as JPEG.
async function encode(canvas, transparent) {
  const toBlob = (type) => new Promise((resolve) => canvas.toBlob(resolve, type, 0.86));
  if (!transparent) return toBlob('image/jpeg');
  const webp = await toBlob('image/webp');
  return webp?.type === 'image/webp' ? webp : toBlob('image/png');
}

function hasTransparency(img) {
  for (let i = 3; i < img.data.length; i += 4 * 97) if (img.data[i] < 250) return true;
  return false;
}

// The photo at PHOTO_SIDE. `clearWhite`: a shop photo of a bottle on plain
// white loses the white touching its edges, so the bottle stands on the
// landscape (only for photos the user is adding now, not old ones).
export async function shrinkPhoto(blob, { clearWhite = false } = {}) {
  const { canvas, ctx } = await draw(blob, PHOTO_SIDE);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let transparent = hasTransparency(img);
  if (clearWhite && !transparent && clearWhiteBackground(img)) {
    ctx.putImageData(img, 0, 0);
    transparent = true;
  }
  return (await encode(canvas, transparent)) ?? blob;
}

export async function makeThumb(blob) {
  const { canvas, ctx } = await draw(blob, THUMB_SIDE);
  return encode(canvas, hasTransparency(ctx.getImageData(0, 0, canvas.width, canvas.height)));
}

// Flood fill from the borders over near-white pixels, making them
// transparent. Only when all four corners are white (a white backdrop, not
// a photo that happens to have a bright patch). Returns whether it did.
function clearWhiteBackground(img) {
  const { width: w, height: h, data } = img;
  const white = (p) => data[p * 4] > 236 && data[p * 4 + 1] > 236 && data[p * 4 + 2] > 236;
  if (![0, w - 1, (h - 1) * w, h * w - 1].every(white)) return false;
  const seen = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  let cleared = 0;
  while (stack.length) {
    const p = stack.pop();
    if (seen[p] || !white(p)) continue;
    seen[p] = 1;
    data[p * 4 + 3] = 0;
    cleared++;
    const x = p % w;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (p >= w) stack.push(p - w);
    if (p < w * (h - 1)) stack.push(p + w);
  }
  // Nearly everything white: not a bottle on a backdrop, leave it alone.
  if (cleared > w * h * 0.95) {
    for (let p = 0; p < w * h; p++) data[p * 4 + 3] = 255;
    return false;
  }
  return cleared > 0;
}

// The upload body for PUT /api/wines/:id/image: the photo and its thumb.
export async function photoForm(file) {
  const form = new FormData();
  form.append('file', file, 'foto');
  const thumb = await makeThumb(file).catch(() => null);
  if (thumb) form.append('thumb', thumb, 'mini');
  return form;
}

// Once per start, in the background: every photo of the user's wines that
// has no small copy yet (saved before build 186, or copied from the web by
// the Worker) is shrunk and saved again with one. A photo still linked to
// another site (its copy failed) is copied into ours first: until then it
// loads at full size from that site. One at a time, after the screens have
// loaded; whatever is left is done at the next start.
export async function tidyPhotos(wines) {
  const seen = new Set();
  for (const w of wines) {
    let url = w.image_url;
    if (!url || seen.has(w.wine_id)) continue;
    seen.add(w.wine_id);
    try {
      if (/^https?:/.test(url)) url = (await api.put(`/api/wines/${w.wine_id}/image`, { url })).image_url;
      if (!url?.startsWith('/api/wine-images/')) continue;
      const probe = await fetch(thumbOf(url), { cache: 'no-store', credentials: 'include' });
      if (!probe.ok || probe.headers.get('x-thumb') !== '0') continue;
      const original = await probe.blob();
      const smaller = await shrinkPhoto(original);
      await api.put(`/api/wines/${w.wine_id}/image`, await photoForm(smaller.size < original.size ? smaller : original));
    } catch (err) {
      console.error('photo tidy failed', w.wine_id, err);
    }
  }
}
