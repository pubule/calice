import { api } from './api-client.js';
import { landscapeFor } from './landscape.js';

// Start-up loader: everything the app shows is fetched once, here, so that
// afterwards moving between screens and opening a wine never waits (the
// answers stay in api-client's memory; images in the browser's cache).
// Only searches still go to the network. Bounded by MAX_WAIT_MS: whatever is
// not ready by then keeps loading behind the first screen.
const MAX_WAIT_MS = 9000;

// At most `n` tasks at a time, so a big cellar does not flood the network.
async function pool(items, n, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift()).catch(() => {});
  }));
}

function preloadImage(url) {
  if (!url) return Promise.resolve();
  const img = new Image();
  img.src = url;
  return img.decode().catch(() => {});
}

export async function warmUp(onProgress = () => {}) {
  let done = 0;
  let total = 0;
  let shown = 0;
  let listsKnown = false; // until the bottles are known the total is not: the bar stops at a quarter
  const step = (p) => {
    total++;
    return Promise.resolve(p).catch(() => null).finally(() => {
      done++;
      shown = Math.max(shown, (listsKnown ? 1 : 0.25) * done / total);
      onProgress(shown);
    });
  };

  const all = (async () => {
    const [cellars] = await Promise.all([
      step(api.get('/api/cellars')),
      step(api.get('/api/me/palate')),
    ]);
    const lists = await Promise.all((cellars ?? []).map((c) => Promise.all([
      step(api.get(`/api/cellars/${c.id}/bottles`)),
      step(api.get(`/api/cellars/${c.id}/wishlist`)),
      step(api.get(`/api/cellars/${c.id}/elements`)),
    ])));
    const bottles = lists.flatMap(([b]) => b ?? []);
    listsKnown = true;

    // One landscape per area, then its photo; each bottle's own photo.
    const areas = new Map(bottles.map((b) => [JSON.stringify([b.denomination, b.region, b.country]), b]));
    const images = pool([...areas.values()], 4, (b) => step(landscapeFor(b).then((l) => preloadImage(l?.url))));
    const bottleImages = pool(bottles.filter((b) => b.image_url), 6, (b) => step(preloadImage(b.image_url)));
    // What a wine's sheet reads when opened: notes and the user's photos.
    const sheets = pool(bottles, 6, (b) => step(Promise.all([api.get(`/api/bottles/${b.id}/notes`), api.get(`/api/bottles/${b.id}/photos`)])));
    await Promise.all([images, bottleImages, sheets]);
  })();

  await Promise.race([all, new Promise((r) => setTimeout(r, MAX_WAIT_MS))]);
}
