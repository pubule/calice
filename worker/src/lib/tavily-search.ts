import { fetchWithTimeout } from './fetch-timeout';

export type WineCandidate = { title?: string; snippet?: string; sourceUrl?: string; imageUrl?: string };
export type TavilySearchResult = { candidates: WineCandidate[]; creditsUsed: number };

const MAX_CANDIDATES = 10;
// Requested pool is bigger than what's shown, giving the relevance-filter
// below more material to work with before trimming down to what's actually
// displayed. 15 is under Tavily's max_results cap of 20.
const FETCH_POOL = 15;

// Restricting to Vivino alone rather than the open web or a multi-site list:
// confirmed live via the playground that vivino.com-only gives BOTH full
// recall for a lesser-known producer (15/15 real "Zamuner" bottles with no
// query suffix at all) AND zero non-wine junk (an unrestricted "Zamuner
// blanc" search surfaced six LinkedIn people-profiles for others who happen
// to share the surname — Vivino only ever hosts wine pages, so that whole
// failure mode is structurally impossible here). A wider multi-domain list
// was tried first and cut recall to zero for this same producer — Tavily's
// include_domains restricts its crawl scope, not just the result list, so
// more domains is not simply "more coverage".
const SEARCH_DOMAINS = ['vivino.com'];

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

// Being on vivino.com does NOT mean a result is about the searched wine —
// Tavily still returns whatever ranks reasonably within the domain
// restriction, which can be a same-category-but-different-producer wine.
// Confirmed: a "Zamuner blanc" search once surfaced "Don de Dar ...
// Sauvignon Blanc" — a completely unrelated Spanish wine that was still on
// vivino.com. Checked against title/URL only, NOT the snippet: a
// category-listing page's scraped content can enumerate hundreds of wines,
// so it will often contain the search term somewhere by sheer coincidence
// even though the page isn't about that wine. Drops anything that doesn't
// mention the distinctive query term in either — including, deliberately,
// every candidate at once on an unlucky draw (see the caller for why
// there's no fallback).
function isRelevant(word: string, candidate: WineCandidate): boolean {
  const haystack = `${candidate.title ?? ''} ${candidate.sourceUrl ?? ''}`.toLowerCase();
  return haystack.includes(word);
}

// Vivino publishes the same wine page in several languages under
// /it/, /en/, /es/ etc. on the same hostname (confirmed live — e.g.
// "Zamuner Cuvée Alessandra ... /w/12211516" appears under both /it/ and
// /es/) — include_domains can't restrict by path, only by host, so an
// Italian preference has to be a ranking nudge instead. Small relative to
// Tavily's own 0-1 score range: real gaps between different wines were
// observed around 0.02-0.08, an Italian-vs-other-language duplicate of the
// SAME wine around 0.01-0.04 — 0.05 reliably wins the latter without
// routinely reordering genuinely different (but both relevant) wines.
//
// The boost alone only ever REORDERED those duplicates, so the Spanish and
// English copies of the same bottle still took up rows in the list; what
// removes them is dedupeKey below, which also picks the Italian copy
// outright. So the boost no longer decides the language of a wine — it is
// left in only as a tie-break between DIFFERENT pages that share no wine
// id (a winery or listing page against another), where the collapse has
// nothing to group on.
const ITALIAN_PATH_BOOST = 0.05;
function isItalianVivinoUrl(sourceUrl?: string): boolean {
  if (!sourceUrl) return false;
  try {
    return new URL(sourceUrl).pathname.startsWith('/it/');
  } catch {
    return false;
  }
}

// Groups the per-language copies of one bottle. Every Vivino wine page
// carries the same numeric id in /w/<id> whatever the language prefix, so
// that id — not the URL — is the wine's identity. The vintage is part of
// the key because Vivino hangs vintages off the same wine id via ?year=,
// and two vintages are genuinely two different bottles to add.
// Returns null for anything that isn't a wine page (a grape or category
// listing, say): those have no id to group on and are left alone rather
// than collapsed together.
function dedupeKey(sourceUrl?: string): string | null {
  if (!sourceUrl) return null;
  try {
    const url = new URL(sourceUrl);
    const id = url.pathname.match(/\/w\/(\d+)/)?.[1];
    return id ? `${id}:${url.searchParams.get('year') ?? ''}` : null;
  } catch {
    return null;
  }
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
// Ranking within what survives the isRelevant filter uses Tavily's own
// `score` directly — with every result already guaranteed to be on Vivino
// (see SEARCH_DOMAINS above), there's no cross-domain trust signal left to
// layer on top. Basic search_depth (no override sent) is enough — advanced
// depth was tried too and costs 2 credits instead of basic's 1 for results
// that weren't meaningfully better.
//
// Images and results are paired by index — Tavily doesn't tie a specific
// image to a specific result, so this is a best-effort zip, good enough
// since the user visually confirms whichever candidate they tap. The zip
// happens before the score re-sort below so each candidate keeps its own
// paired image when candidates get reordered.
// The query goes out verbatim. It used to carry a " vino" suffix, which
// bought nothing once the search was already restricted to vivino.com —
// every page there is a wine page — while "vino" reads as Spanish just as
// well as Italian, so if anything it helped the Spanish copies rank. The
// no-suffix recall was the measured case anyway (see SEARCH_DOMAINS).
export async function searchWine(query: string, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<TavilySearchResult | null> {
  const res = await fetchWithTimeout('https://api.tavily.com/search', 8000, fetchImpl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, max_results: FETCH_POOL, include_images: true, include_domains: SEARCH_DOMAINS }),
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

  // No fallback to the unfiltered set when this comes up empty: Tavily's
  // own result quality varies run to run for the identical query (the same
  // "Zamuner blanc" search has come back both excellent and all-irrelevant
  // across repeated test calls), so on an unlucky draw the "safer" choice
  // is an honest empty list — the caller already renders "nessun risultato"
  // for that — rather than resurrecting off-topic candidates that looked
  // enough like a real Zamuner bottle to fool someone into saving the
  // wrong wine.
  const distinctiveWord = keyWord(queryWords(query));
  const filtered = distinctiveWord ? built.filter((b) => isRelevant(distinctiveWord, b.candidate)) : built;

  // Stable sort: candidates that tie on score keep Tavily's own relevance
  // order relative to each other.
  const ranked = filtered
    .map((b) => ({ candidate: b.candidate, rankScore: b.tavilyScore + (isItalianVivinoUrl(b.candidate.sourceUrl) ? ITALIAN_PATH_BOOST : 0) }))
    .sort((a, b) => b.rankScore - a.rankScore);

  // Collapse the language duplicates AFTER ranking, so a wine takes the
  // position its best-scoring copy earned. WHICH copy is kept, though, is
  // decided by language alone and not by score: inside one wine's group the
  // /it/ page always wins when Vivino has one. Leaving that to
  // ITALIAN_PATH_BOOST was not enough — the boost moves a score by 0.05, so
  // a non-Italian copy that Tavily happens to rank higher by more than that
  // survived the collapse and became the only row shown. That was tolerable
  // while the boost merely reordered and the Italian row stayed on screen
  // anyway; once the collapse removes the losers it is not.
  const positionByKey = new Map<string, number>();
  const deduped: typeof ranked = [];
  for (const entry of ranked) {
    const key = dedupeKey(entry.candidate.sourceUrl);
    if (!key) {
      deduped.push(entry);
      continue;
    }
    const at = positionByKey.get(key);
    if (at === undefined) {
      positionByKey.set(key, deduped.length);
      deduped.push(entry);
    } else if (isItalianVivinoUrl(entry.candidate.sourceUrl) && !isItalianVivinoUrl(deduped[at].candidate.sourceUrl)) {
      deduped[at] = entry;
    }
  }

  // A basic search (what this sends — no search_depth override) is a flat
  // 1 credit per Tavily's docs, regardless of max_results; the response
  // itself carries no usage field to read it back from (confirmed against
  // a live call). Counted even when the search comes up empty — the
  // credit is spent either way, and the usage tracker (worker/src/cron.ts)
  // needs every call counted to warn before the monthly quota runs out.
  return { candidates: deduped.slice(0, MAX_CANDIDATES).map((r) => r.candidate), creditsUsed: 1 };
}
