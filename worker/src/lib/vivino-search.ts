import { fetchWithTimeout } from './fetch-timeout';
export type WinePrefill = { name?: string; producer?: string; country?: string; type?: string; denomination?: string; grapeVariety?: string };
export type VivinoRating = { average: number; count: number };
export type WineCandidate = { title?: string; snippet?: string; sourceUrl?: string; imageUrl?: string; prefill?: WinePrefill; rating?: VivinoRating };

// Vivino's own wine search — the index behind the search box on
// vivino.com (Algolia, queried by the site's frontend with a public,
// search-only key). It returns the same results the user sees on
// vivino.com (on "ambrosini batud", the Batudè first), with each wine's real
// photo. It is the only web source: the paid web search used before (Tavily)
// was removed so the app never risks a bill.
//
// NOT an official API: Vivino can rotate the key or rename the index at any
// time. Every failure — network, non-200, unexpected shape, zero usable hits
// — returns null and the caller keeps just the typed name instead of an
// empty list. GET /api/wines/recognize/debug?q=… reports what this call
// actually receives, to check it from the deployed Worker.
export const VIVINO_ALGOLIA = {
  appId: '9TAKGWJUXL',
  apiKey: '60c11b2f1068885161d95ca068d3a6ae',
  index: 'WINES_prod',
};

const MAX_CANDIDATES = 10;

const TYPE_LABEL: Record<number, string> = { 1: 'Rosso', 2: 'Bianco', 3: 'Bollicine', 4: 'Rosato', 7: 'Dolce', 24: 'Fortificato' };
// The add sheet's own types (its <select>): dessert/fortified have no match,
// so they are left for the user to pick.
const APP_TYPE: Record<number, string> = { 1: 'rosso', 2: 'bianco', 3: 'bollicine', 4: 'rosato' };

// Vivino gives the country as an ISO code ("it"); the app stores the Italian
// name ("Italia"), which is also what Esplora's atlas is keyed by.
function countryName(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  if (!/^[a-z]{2}$/i.test(raw)) return raw;
  try {
    const name = new Intl.DisplayNames(['it'], { type: 'region' }).of(raw.toUpperCase());
    return name && name !== raw.toUpperCase() ? name : raw;
  } catch {
    return raw;
  }
}

function grapeNames(hit: any): string | undefined {
  const list = Array.isArray(hit?.grapes) ? hit.grapes : [];
  const names = list.map((g: any) => str(typeof g === 'string' ? g : g?.name)).filter(Boolean);
  return names.length ? names.join(', ') : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

// Vivino image URLs are protocol-relative ("//images.vivino.com/…").
function absolute(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('//')) return `https:${url}`;
  return /^https?:\/\//.test(url) ? url : undefined;
}

export function hitToCandidate(hit: any): WineCandidate | null {
  const id = typeof hit?.id === 'number' || (typeof hit?.id === 'string' && /^\d+$/.test(hit.id)) ? String(hit.id) : null;
  const name = str(hit?.name);
  if (!id || !name) return null;

  const winery = str(hit?.winery?.name);
  const title = winery && !name.toLowerCase().includes(winery.toLowerCase()) ? `${winery} ${name}` : name;

  const slug = [str(hit?.winery?.seo_name), str(hit?.seo_name)].filter(Boolean).join('-');
  // The /w/<id> marker is the stable wine id across languages and
  // what Vivino resolves the page by; the slug is cosmetic.
  const sourceUrl = slug ? `https://www.vivino.com/IT/it/${slug}/w/${id}` : `https://www.vivino.com/IT/it/w/${id}`;

  const region = str(hit?.region?.name);
  const country = countryName(str(hit?.region?.country?.name) ?? str(hit?.region?.country?.code) ?? str(hit?.region?.country));
  const type = typeof hit?.type_id === 'number' ? TYPE_LABEL[hit.type_id] : undefined;
  const snippet = [type, [region, country].filter(Boolean).join(', ')].filter(Boolean).join(' · ') || undefined;

  const imageUrl = absolute(
    str(hit?.image?.variations?.bottle_medium) ?? str(hit?.image?.variations?.bottle_large) ?? str(hit?.image?.location),
  );

  const prefill: WinePrefill = { name };
  if (winery) prefill.producer = winery;
  if (country) prefill.country = country;
  if (typeof hit?.type_id === 'number' && APP_TYPE[hit.type_id]) prefill.type = APP_TYPE[hit.type_id];
  if (region) prefill.denomination = region;
  const grapes = grapeNames(hit);
  if (grapes) prefill.grapeVariety = grapes;

  const candidate: WineCandidate = { title, sourceUrl, prefill };
  if (snippet) candidate.snippet = snippet;
  if (imageUrl) candidate.imageUrl = imageUrl;
  const rating = ratingOf(hit?.statistics);
  if (rating) candidate.rating = rating;
  return candidate;
}

// The wine's community rating across all vintages (hit.statistics). Vivino
// reports 0 when there are too few ratings to show one: that is "no rating",
// not a zero.
function ratingOf(stats: any): VivinoRating | undefined {
  const average = Number(stats?.ratings_average);
  const count = Number(stats?.ratings_count);
  if (!Number.isFinite(average) || average <= 0 || average > 5 || !Number.isInteger(count) || count <= 0) return undefined;
  return { average: Math.round(average * 10) / 10, count };
}

export type VivinoDiagnostics = { ok: boolean; status?: number; hitCount?: number; firstHitKeys?: string[]; firstHit?: unknown; error?: string; candidates: WineCandidate[] };

export async function queryVivino(query: string, fetchImpl: typeof fetch = fetch): Promise<VivinoDiagnostics> {
  const { appId, apiKey, index } = VIVINO_ALGOLIA;
  const res = await fetchWithTimeout(`https://${appId.toLowerCase()}-dsn.algolia.net/1/indexes/${index}/query`, 5000, fetchImpl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-algolia-application-id': appId,
      'x-algolia-api-key': apiKey,
      // The key may be restricted to Vivino's own pages as referrer.
      referer: 'https://www.vivino.com/',
      origin: 'https://www.vivino.com',
    },
    body: JSON.stringify({ params: new URLSearchParams({ query, hitsPerPage: String(MAX_CANDIDATES) }).toString() }),
  });
  if (!res) return { ok: false, error: 'network error or timeout', candidates: [] };
  if (!res.ok) return { ok: false, status: res.status, error: (await res.text().catch(() => '')).slice(0, 300), candidates: [] };

  let body: any;
  try {
    body = await res.json();
  } catch {
    return { ok: false, status: res.status, error: 'invalid JSON', candidates: [] };
  }
  const hits: any[] = Array.isArray(body?.hits) ? body.hits : [];
  const candidates = hits.map(hitToCandidate).filter((c): c is WineCandidate => c !== null);
  return {
    ok: true,
    status: res.status,
    hitCount: hits.length,
    firstHitKeys: hits[0] && typeof hits[0] === 'object' ? Object.keys(hits[0]).slice(0, 40) : [],
    // The raw record, to see which other fields could pre-fill the sheet.
    firstHit: hits[0],
    candidates,
  };
}

export async function searchVivino(query: string, fetchImpl: typeof fetch = fetch): Promise<WineCandidate[] | null> {
  const result = await queryVivino(query, fetchImpl);
  return result.ok && result.candidates.length ? result.candidates : null;
}
