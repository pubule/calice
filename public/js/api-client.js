// Same origin as the frontend now (both served by one Worker behind
// Cloudflare Access) — no more cross-origin CORS/cookie dance.
async function request(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers: body instanceof FormData ? {} : { 'content-type': 'application/json' },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = new Error(`${method} ${path} failed: ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

// Reads are kept in memory so moving around the app never waits on the
// network (the start-up loader, js/warmup.js, fills this up front). An answer
// younger than FRESH_MS is reused as is; an older one is still answered at
// once, and fetched again behind the scenes for the next time. Any write
// empties the whole memory, so what the user just changed is always read
// fresh. Searches are never kept: they depend on what is being typed.
const FRESH_MS = 30_000;
const NO_CACHE = /\/search|\/lookup|\/recognize|debug/;
const cache = new Map(); // path → { at, promise, ok, refreshing }

function get(path) {
  if (NO_CACHE.test(path)) return request('GET', path);
  const hit = cache.get(path);
  if (hit && (Date.now() - hit.at < FRESH_MS || hit.refreshing)) return hit.promise;
  const fresh = request('GET', path);
  if (hit?.ok) {
    hit.refreshing = true;
    fresh.then(
      (data) => { if (cache.get(path) === hit) cache.set(path, { at: Date.now(), promise: Promise.resolve(data), ok: true }); },
      () => { hit.refreshing = false; },
    );
    return hit.promise;
  }
  const entry = { at: Date.now(), promise: fresh, ok: false };
  cache.set(path, entry);
  fresh.then(() => { entry.ok = true; }, () => { if (cache.get(path) === entry) cache.delete(path); });
  return fresh;
}

async function write(method, path, body) {
  cache.clear();
  try {
    return await request(method, path, body);
  } finally {
    cache.clear(); // a read that started meanwhile may hold the old data
  }
}

export const api = {
  get,
  post: (path, body) => write('POST', path, body),
  patch: (path, body) => write('PATCH', path, body),
  put: (path, body) => write('PUT', path, body),
  del: (path) => write('DELETE', path),
};
