import { fetchWithTimeout } from './fetch-timeout';

export type WikidataSuggestion = { grapeVariety?: string };

// P186 ("made from material") and P527 ("has part(s)") confirmed live against
// https://www.wikidata.org/wiki/Q808584 (Barolo DOCG) while writing this
// plan: both point to Q202290, which labels as "Nebbiolo". See Task 3 in
// .superpowers/sdd/2026-09-02-wine-recognition-implementation/task-3-brief.md.
const GRAPE_VARIETY_PROPERTIES = ['P186', 'P527'];

function claimEntityId(claims: any, property: string): string | null {
  return claims?.[property]?.[0]?.mainsnak?.datavalue?.value?.id ?? null;
}

async function resolveLabel(entityId: string, fetchImpl: typeof fetch): Promise<string | null> {
  const res = await fetchWithTimeout(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${entityId}&props=labels&languages=it|en&format=json`,
    8000,
    fetchImpl,
  );
  if (!res || !res.ok) return null;
  try {
    const body: any = await res.json();
    const labels = body?.entities?.[entityId]?.labels;
    return labels?.it?.value ?? labels?.en?.value ?? null;
  } catch {
    return null;
  }
}

export async function enrichFromWikidata(name: string, producer: string | undefined, fetchImpl: typeof fetch = fetch): Promise<WikidataSuggestion | null> {
  const query = producer ? `${name} ${producer}` : name;
  const searchRes = await fetchWithTimeout(
    `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(query)}&language=it&format=json&type=item&limit=1`,
    8000,
    fetchImpl,
  );
  if (!searchRes || !searchRes.ok) return null;

  let entityId: string | null = null;
  try {
    const searchBody: any = await searchRes.json();
    entityId = searchBody?.search?.[0]?.id ?? null;
  } catch {
    return null;
  }
  if (!entityId) return null;

  const claimsRes = await fetchWithTimeout(`https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${entityId}&format=json`, 8000, fetchImpl);
  if (!claimsRes || !claimsRes.ok) return null;

  let claims: any;
  try {
    const claimsBody: any = await claimsRes.json();
    claims = claimsBody?.claims;
  } catch {
    return null;
  }
  if (!claims) return null;

  let grapeId: string | null = null;
  for (const property of GRAPE_VARIETY_PROPERTIES) {
    grapeId = claimEntityId(claims, property);
    if (grapeId) break;
  }
  if (!grapeId) return null;

  const label = await resolveLabel(grapeId, fetchImpl);
  return label ? { grapeVariety: label } : null;
}
