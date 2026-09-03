import { fetchWithTimeout } from './fetch-timeout';

export type WineCandidate = { title?: string; snippet?: string; sourceUrl?: string; imageUrl?: string };
export type TavilySearchResult = { candidates: WineCandidate[]; creditsUsed: number };

const MAX_CANDIDATES = 10;
// Requested pool is bigger than what's shown: a producer's own site often
// ranks below retailer pages in raw relevance, so scoring needs more
// candidates to work with before trimming down to what's actually displayed.
// 15 is under Tavily's max_results cap of 20.
const FETCH_POOL = 15;

// Tavily's ranking alone doesn't guarantee a Vivino hit shows up at all for
// a given query — reordering only reshuffles whatever came back. Restricting
// the search to a short list of trusted wine sites (via include_domains,
// a hard filter — results come ONLY from these domains) guarantees Vivino
// coverage when it exists, at the cost of losing the producer's own site and
// smaller/regional retailers that would otherwise show up on the open web.
const TRUSTED_DOMAINS = [
  'vivino.com',
  'wine-searcher.com',
  'tannico.it',
  'oltrebolla20.com',
  'callmewine.com',
  'bernabei.it',
  'vino.com',
  'xtrawine.com',
];

const STOPWORDS = new Set(['il', 'lo', 'la', 'i', 'gli', 'le', 'di', 'del', 'dello', 'della', 'dei', 'degli', 'delle', 'e', 'un', 'una', 'vino']);

function queryWords(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

// The longest query word is the best local proxy for "the distinctive
// term" (usually the producer or wine name) when there's no corpus to
// compute real term-frequency weighting from — a generic descriptor like
// "blanc"/"rosso" is typically shorter than a producer/wine name and would
// otherwise let an unrelated same-category result slip past the relevance
// filter below.
function keyWord(words: string[]): string | undefined {
  return words.slice().sort((a, b) => b.length - a.length)[0];
}

// Tavily's within-domain search can return a page that's merely
// topically adjacent (e.g. a generic "Sauvignon Blanc" grape/category
// listing on vivino.com for a "Zamuner Blanc" query) rather than one
// actually about the searched wine — include_domains guarantees the
// *site*, not the *match*. Checked against title/URL only, NOT the
// snippet: a category-listing page's scraped content can enumerate
// hundreds of wines, so it will often contain the search term
// somewhere by sheer coincidence even though the page itself isn't
// about that wine — title/URL are what actually identify what the page
// is. Drops anything that doesn't mention the distinctive query term in
// either, unless that would wipe out every candidate (a loose guess
// beats nothing).
function isRelevant(word: string, candidate: WineCandidate): boolean {
  const haystack = `${candidate.title ?? ''} ${candidate.sourceUrl ?? ''}`.toLowerCase();
  return haystack.includes(word);
}

// Tavily's scraped `content` is raw page text — often littered with
// markdown-style "#####" section separators and long runs of unrelated
// site chrome (nav labels, marketing copy). Strip the separator noise and
// cap the length so what's shown is a short, readable line instead of a
// wall of unrelated text.
const SNIPPET_MAX_LEN = 180;
function cleanSnippet(text: string): string {
  const cleaned = text.replace(/#+/g, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned.length <= SNIPPET_MAX_LEN) return cleaned;
  return cleaned.slice(0, SNIPPET_MAX_LEN).replace(/\s+\S*$/, '') + '…';
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

// Checks the actual hostname, not a raw substring match — sourceUrl comes
// from Tavily's (third-party) search results, and `.includes('vivino.com')`
// would let a spoofed URL like "evil.com/?x=vivino.com" or
// "vivino.com.evil.com" claim the trust boost below without being Vivino.
function isVivinoUrl(sourceUrl?: string): boolean {
  if (!sourceUrl) return false;
  try {
    const host = new URL(sourceUrl).hostname.toLowerCase();
    return host === 'vivino.com' || host.endsWith('.vivino.com');
  } catch {
    return false;
  }
}

// Vivino has crowd-sourced photos/vintages/ratings for far more wines than
// any single retailer, so a Vivino hit is trusted over URL-match alone — the
// boost dwarfs urlMatchScore's small integer range, guaranteeing every
// Vivino candidate sorts above every non-Vivino one while still using
// urlMatchScore to order candidates within each group.
const VIVINO_BOOST = 1000;
function rankScore(words: string[], candidate: WineCandidate): number {
  return (isVivinoUrl(candidate.sourceUrl) ? VIVINO_BOOST : 0) + urlMatchScore(words, candidate.sourceUrl);
}

// One call, not two like the old Google integration: Tavily returns web
// results (title/content/url) and images in the same response when
// include_images is set. Requesting several results instead of committing to
// one matters here — a specific product query (e.g. "Zamuner Riserva del
// Fondatore") often has more than one plausible retailer match among the
// trusted domains, so the app can't reliably guess "the" right one. Showing
// a few lets the user pick, same principle as every other suggestion in this feature:
// nothing is trusted without a human confirming it. Images and results are
// paired by index — Tavily doesn't tie a specific image to a specific
// result, so this is a best-effort zip, good enough since the user visually
// confirms whichever candidate they tap. The zip happens before the
// URL-match re-sort below so each candidate keeps its own paired image when
// candidates get reordered.
export async function searchWine(query: string, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<TavilySearchResult | null> {
  // The query used to get a " vino" suffix appended to steer Tavily's
  // open-web ranking toward wine-related pages. Now that include_domains
  // restricts the search to wine sites only, that suffix is dead weight —
  // worse, Tavily's relevance ranking treats it as a real search term,
  // diluting the weight given to the actual distinctive words (a producer
  // name) against a generic term every result on these domains matches.
  const res = await fetchWithTimeout('https://api.tavily.com/search', 8000, fetchImpl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, max_results: FETCH_POOL, include_images: true, include_domains: TRUSTED_DOMAINS }),
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
    if (typeof r?.content === 'string' && r.content.trim()) candidate.snippet = cleanSnippet(r.content.trim());
    if (typeof r?.url === 'string' && r.url.trim()) candidate.sourceUrl = r.url.trim();
    const rawImage = images[i];
    const imageUrl = typeof rawImage === 'string' ? rawImage : rawImage?.url;
    if (typeof imageUrl === 'string' && imageUrl.trim()) candidate.imageUrl = imageUrl.trim();
    if (Object.keys(candidate).length) candidates.push(candidate);
  }

  const words = queryWords(query);
  const distinctiveWord = keyWord(words);
  const relevant = distinctiveWord ? candidates.filter((c) => isRelevant(distinctiveWord, c)) : candidates;
  const filtered = relevant.length ? relevant : candidates;

  // Stable sort: candidates that tie on rank score (the common case — most
  // score 0) keep Tavily's own relevance order relative to each other.
  filtered.sort((a, b) => rankScore(words, b) - rankScore(words, a));

  // A basic search (what this always sends — no search_depth override) is a
  // flat 1 credit per Tavily's docs, regardless of max_results; the response
  // itself carries no usage field to read it back from (confirmed against a
  // live call). Counted even when the search comes up empty — the credit is
  // spent either way, and the usage tracker (worker/src/cron.ts) needs every
  // call counted to warn before the monthly quota runs out.
  return { candidates: filtered.slice(0, MAX_CANDIDATES), creditsUsed: 1 };
}
