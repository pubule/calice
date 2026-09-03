import { fetchWithTimeout } from './fetch-timeout';

export type WineCandidate = { title?: string; snippet?: string; sourceUrl?: string; imageUrl?: string };
export type TavilySearchResult = { candidates: WineCandidate[]; creditsUsed: number };

const MAX_CANDIDATES = 10;
// Requested pool is bigger than what's shown, giving the Vivino-boost
// re-sort below more material to work with before trimming down to what's
// actually displayed. 15 is under Tavily's max_results cap of 20.
const FETCH_POOL = 15;

// Wine-only retailer/rating sites. Confirmed via a real playground call
// (query "Zamuner vino", basic depth, these 8 domains): 8 of 10 results
// were genuine bottle pages (title names a specific wine), the 2 that
// weren't (a brand-landing page) still ranked below every Vivino result
// thanks to the boost below — no hotel/tourism content is possible since
// none of these domains host any.
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

// The Vivino boost below is unconditional on domain alone — a page merely
// hosted on vivino.com is NOT necessarily about the searched wine (Tavily
// still returns whatever ranks reasonably within the domain restriction,
// which can be a same-category-but-different-producer wine). Confirmed:
// a "Zamuner blanc" search once surfaced "Don de Dar ... Sauvignon Blanc"
// — a completely unrelated Spanish wine — which the boost then shoved to
// the top of the list purely for being on vivino.com. Checked against
// title/URL only, NOT the snippet: a category-listing page's scraped
// content can enumerate hundreds of wines, so it will often contain the
// search term somewhere by sheer coincidence even though the page isn't
// about that wine. Drops anything that doesn't mention the distinctive
// query term in either, unless that would wipe out every candidate (a
// loose guess beats nothing).
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
// any single retailer, so a Vivino hit is trusted over Tavily's own
// relevance score alone — the boost dwarfs the score's 0-1 range,
// guaranteeing every Vivino candidate sorts above every non-Vivino one
// while still using Tavily's score to order candidates within each group.
const VIVINO_BOOST = 1000;
function rankScore(isVivino: boolean, tavilyScore: number): number {
  return (isVivino ? VIVINO_BOOST : 0) + tavilyScore;
}

// One call, not two like the old Google integration: Tavily returns web
// results (title/content/url/score) and images in the same response when
// include_images is set. Requesting several results instead of committing
// to one matters here — a specific product query (e.g. "Zamuner Riserva
// del Fondatore") often has more than one plausible match (the producer's
// own site, a specific retailer product page, Vivino), so the app can't
// reliably guess "the" right one. Showing a few lets the user pick, same
// principle as every other suggestion in this feature: nothing is trusted
// without a human confirming it.
//
// include_domains restricts to a curated wine-retailer list (see
// TRUSTED_DOMAINS) rather than the open web — it also rules out
// company/tourism pages by construction (none of these sites host that
// kind of content). The isRelevant title/URL filter above still runs on
// top: being on a trusted domain doesn't mean a given result is actually
// about the searched wine (see its own comment), and the Vivino boost
// below would otherwise blindly promote an off-topic-but-on-domain
// result to the top. Ranking within what survives the filter uses
// Tavily's own `score`, not a hand-rolled word-match score — a much
// stronger relevance signal once the filter has already ruled out the
// clearly off-topic candidates. Basic search_depth (no override sent) is
// enough — advanced depth was tried too and costs 2 credits instead of
// basic's 1 for results that weren't meaningfully better.
//
// Images and results are paired by index — Tavily doesn't tie a specific
// image to a specific result, so this is a best-effort zip, good enough
// since the user visually confirms whichever candidate they tap. The zip
// happens before the score re-sort below so each candidate keeps its own
// paired image when candidates get reordered.
export async function searchWine(query: string, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<TavilySearchResult | null> {
  // Appending "vino" steers ranking toward wine-related pages within the
  // trusted domains — several of them (e.g. vino.com) sell more than wine.
  const res = await fetchWithTimeout('https://api.tavily.com/search', 8000, fetchImpl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query: `${query} vino`, max_results: FETCH_POOL, include_images: true, include_domains: TRUSTED_DOMAINS }),
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
  const built: { candidate: WineCandidate; tavilyScore: number }[] = [];
  for (let i = 0; i < Math.min(FETCH_POOL, results.length); i++) {
    const r = results[i];
    const candidate: WineCandidate = {};
    if (typeof r?.title === 'string' && r.title.trim()) candidate.title = r.title.trim();
    if (typeof r?.content === 'string' && r.content.trim()) candidate.snippet = cleanSnippet(r.content.trim());
    if (typeof r?.url === 'string' && r.url.trim()) candidate.sourceUrl = r.url.trim();
    const rawImage = images[i];
    const imageUrl = typeof rawImage === 'string' ? rawImage : rawImage?.url;
    if (typeof imageUrl === 'string' && imageUrl.trim()) candidate.imageUrl = imageUrl.trim();
    if (Object.keys(candidate).length) {
      built.push({ candidate, tavilyScore: typeof r?.score === 'number' ? r.score : 0 });
    }
  }

  const distinctiveWord = keyWord(queryWords(query));
  const relevant = distinctiveWord ? built.filter((b) => isRelevant(distinctiveWord, b.candidate)) : built;
  const filtered = relevant.length ? relevant : built;

  // Stable sort: candidates that tie on rank score keep Tavily's own
  // relevance order relative to each other.
  const ranked = filtered
    .map((b) => ({ candidate: b.candidate, score: rankScore(isVivinoUrl(b.candidate.sourceUrl), b.tavilyScore) }))
    .sort((a, b) => b.score - a.score);

  // A basic search (what this sends — no search_depth override) is a flat
  // 1 credit per Tavily's docs, regardless of max_results; the response
  // itself carries no usage field to read it back from (confirmed against
  // a live call). Counted even when the search comes up empty — the
  // credit is spent either way, and the usage tracker (worker/src/cron.ts)
  // needs every call counted to warn before the monthly quota runs out.
  return { candidates: ranked.slice(0, MAX_CANDIDATES).map((r) => r.candidate), creditsUsed: 1 };
}
