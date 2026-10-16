import { api } from './api-client.js';

// The vineyard photo for a wine's area (see /api/landscape), remembered for
// the whole session per area: the start-up loader asks for every wine in the
// cellars, so opening a wine finds it already here.
const known = new Map(); // area query → landscape or null

export function landscapeKey(bottle) {
  const params = new URLSearchParams();
  for (const k of ['denomination', 'region', 'country']) if (bottle[k]) params.set(k, bottle[k]);
  return params.toString();
}

export function knownLandscape(bottle) {
  return known.get(landscapeKey(bottle));
}

export async function landscapeFor(bottle) {
  const key = landscapeKey(bottle);
  if (!key) return null;
  if (known.has(key)) return known.get(key);
  const l = (await api.get(`/api/landscape?${key}`)).landscape ?? null;
  known.set(key, l);
  return l;
}
