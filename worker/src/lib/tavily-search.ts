import { fetchWithTimeout } from './fetch-timeout';

export type WineCandidate = { title?: string; snippet?: string; sourceUrl?: string; imageUrl?: string };
export type TavilySearchResult = { candidates: WineCandidate[]; creditsUsed: number };

const MAX_CANDIDATES = 10;
// Requested pool is bigger than what's shown: a producer's own site often
// ranks below retailer pages in raw relevance, so scoring needs more
// candidates to work with before trimming down to what's actually displayed.
// 15 is under Tavily's max_results cap of 20.
const FETCH_POOL = 15;

const STOPWORDS = new Set(['il', 'lo', 'la', 'i', 'gli', 'le', 'di', 'del', 'dello', 'della', 'dei', 'degli', 'delle', 'e', 'un', 'una', 'vino']);

function queryWords(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

// How many of the query's (non-stopword) words show up in the candidate's
// URL — a producer's own domain (e.g. "zamuner.it") or a page slug that
// echoes the search is a much stronger real-world signal than Tavily's
// generic relevance ranking for a specific product query.
function urlMatchScore(words: string[], sourceUrl?: string): number {
  if (!sourceUrl) return 0;
  const url = sourceUrl.toLowerCase();
  return words.reduce((score, word) => score + (url.includes(word) ? 1 : 0), 0);
}

// One call, not two like the old Google integration: Tavily returns web
// results (title/content/url) and images in the same response when
// include_images is set. Requesting several results instead of committing to
// one matters here — a specific product query (e.g. "Zamuner Riserva del
// Fondatore") often ranks a retailer's product page above the producer's own
// site, so the app can't reliably guess "the" right one. Showing a few lets
// the user pick, same principle as every other suggestion in this feature:
// nothing is trusted without a human confirming it. Images and results are
// paired by index — Tavily doesn't tie a specific image to a specific
// result, so this is a best-effort zip, good enough since the user visually
// confirms whichever candidate they tap. The zip happens before the
// URL-match re-sort below so each candidate keeps its own paired image when
// candidates get reordered.
export async function searchWine(query: string, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<TavilySearchResult | null> {
  const res = await fetchWithTimeout('https://api.tavily.com/search', 8000, fetchImpl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query: `${query} vino`, max_results: FETCH_POOL, include_images: true }),
  });
  if (!res || !res.ok) return null;

  let body: any;
  try {
    body = await res.json();
  } catch {
    return null;
  }

  const results: any[] = Array.isArray(body?.results) ? body.results : [];
  const images: any[] = Array.isArray(body?.images) ? body.images : [];
  const candidates: WineCandidate[] = [];
  for (let i = 0; i < Math.min(FETCH_POOL, results.length); i++) {
    const r = results[i];
    const candidate: WineCandidate = {};
    if (typeof r?.title === 'string' && r.title.trim()) candidate.title = r.title.trim();
    if (typeof r?.content === 'string' && r.content.trim()) candidate.snippet = r.content.trim();
    if (typeof r?.url === 'string' && r.url.trim()) candidate.sourceUrl = r.url.trim();
    const rawImage = images[i];
    const imageUrl = typeof rawImage === 'string' ? rawImage : rawImage?.url;
    if (typeof imageUrl === 'string' && imageUrl.trim()) candidate.imageUrl = imageUrl.trim();
    if (Object.keys(candidate).length) candidates.push(candidate);
  }

  // Stable sort: candidates that tie on URL-match score (the common case —
  // most score 0) keep Tavily's own relevance order relative to each other.
  const words = queryWords(query);
  candidates.sort((a, b) => urlMatchScore(words, b.sourceUrl) - urlMatchScore(words, a.sourceUrl));

  // A basic search (what this always sends — no search_depth override) is a
  // flat 1 credit per Tavily's docs, regardless of max_results; the response
  // itself carries no usage field to read it back from (confirmed against a
  // live call). Counted even when the search comes up empty — the credit is
  // spent either way, and the usage tracker (worker/src/cron.ts) needs every
  // call counted to warn before the monthly quota runs out.
  return { candidates: candidates.slice(0, MAX_CANDIDATES), creditsUsed: 1 };
}
