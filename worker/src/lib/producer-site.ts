import { fetchWithTimeout } from './fetch-timeout';

// Looks for a wine's photo on its producer's own website (the site Vivino
// gives for the winery). There is no standard: every winery site is built
// differently, so this only gathers candidates — the page that best matches
// the wine's name, and the images that page declares or shows — and never
// decides on its own. The user picks (or nothing changes).
//
// Free: plain fetches from the Worker, at most MAX_FETCHES per call (well
// within the free plan's subrequest limit).

const MAX_FETCHES = 8;
const TIMEOUT_MS = 6000;
const MAX_PAGES = 3;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const fold = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Words of the wine's name that can identify its page. Generic words that
// every page of a winery site shares carry no signal.
const GENERIC = new Set(['vino', 'wine', 'il', 'la', 'le', 'lo', 'i', 'gli', 'di', 'del', 'della', 'dei', 'de', 'des', 'du', 'e', 'and', 'the', 'doc', 'docg', 'igt']);
export function nameTokens(name: string, producer?: string): string[] {
  const prod = new Set(fold(producer ?? '').split(/[^a-z0-9]+/).filter(Boolean));
  return [...new Set(fold(name).split(/[^a-z0-9]+/))].filter((w) => w.length > 1 && !GENERIC.has(w) && !prod.has(w));
}

// Share of the name's words found in a URL or a link text (0-1). Every word
// counts the same; a page about a different wine of the same winery scores
// low because its other words are missing.
export function matchScore(text: string, tokens: string[]): number {
  if (!tokens.length) return 0;
  const hay = ` ${fold(text).replace(/[^a-z0-9]+/g, ' ')} `;
  return tokens.filter((t) => hay.includes(` ${t} `)).length / tokens.length;
}

function absolute(href: string, base: string): string | null {
  try {
    const u = new URL(href.replace(/&amp;/g, '&').trim(), base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))?.slice(2).find((v) => v != null) ?? null;

// Same-site links of a page, with their visible text.
export function extractLinks(html: string, base: string): { url: string; text: string }[] {
  const host = new URL(base).hostname.replace(/^www\./, '');
  const out: { url: string; text: string }[] = [];
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attr(m[1], 'href');
    const url = href && absolute(href, base);
    if (!url || new URL(url).hostname.replace(/^www\./, '') !== host) continue;
    out.push({ url: url.split('#')[0], text: m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() });
  }
  return out;
}

export function parseSitemap(xml: string): { pages: string[]; sitemaps: string[] } {
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, '&'));
  const isIndex = /<sitemapindex/i.test(xml);
  return isIndex ? { pages: [], sitemaps: locs } : { pages: locs, sitemaps: [] };
}

export type ImageCandidate = { url: string; source: 'og' | 'twitter' | 'jsonld' | 'img'; score: number; alt?: string };

// Images a product page declares (og:image, twitter:image, schema.org
// Product) or shows with a name/alt that matches the wine. Logos, icons and
// tiny sprites are skipped by name.
export function extractImages(html: string, base: string, tokens: string[]): ImageCandidate[] {
  const out: ImageCandidate[] = [];
  const add = (src: string | null, source: ImageCandidate['source'], score: number, alt?: string) => {
    const url = src && absolute(src, base);
    if (!url || /\.(svg|gif|ico)(\?|$)/i.test(url) || /logo|icon|favicon|sprite|placeholder|flag/i.test(url)) return;
    if (out.some((c) => c.url === url)) return;
    out.push({ url, source, score, ...(alt ? { alt } : {}) });
  };
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const key = (attr(m[0], 'property') ?? attr(m[0], 'name') ?? '').toLowerCase();
    if (key === 'og:image' || key === 'og:image:url' || key === 'og:image:secure_url') add(attr(m[0], 'content'), 'og', 0.6);
    else if (key === 'twitter:image') add(attr(m[0], 'content'), 'twitter', 0.5);
  }
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const stack: unknown[] = [JSON.parse(m[1])];
      while (stack.length) {
        const node = stack.pop() as any;
        if (!node || typeof node !== 'object') continue;
        if (Array.isArray(node)) { stack.push(...node); continue; }
        const type = String(node['@type'] ?? '');
        if (/product/i.test(type)) {
          for (const img of [node.image].flat()) add(typeof img === 'string' ? img : img?.url ?? null, 'jsonld', 0.8);
        }
        if (node['@graph']) stack.push(node['@graph']);
      }
    } catch {
      // malformed JSON-LD: ignore
    }
  }
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const src = attr(m[0], 'data-src') ?? attr(m[0], 'data-lazy-src') ?? attr(m[0], 'src');
    const srcset = attr(m[0], 'srcset');
    const best = srcset ? srcset.split(',').map((s) => s.trim().split(/\s+/)[0]).pop() ?? src : src;
    const alt = attr(m[0], 'alt') ?? '';
    const score = Math.max(matchScore(alt, tokens), matchScore(decodeURIComponent((best ?? '').split('/').pop() ?? ''), tokens));
    if (score >= 0.5) add(best, 'img', score * 0.9, alt || undefined);
  }
  return out.sort((a, b) => b.score - a.score);
}

export type ProducerReport = {
  site: string; wine: string; tokens: string[];
  home: { status: number | null; links: number };
  sitemap: { found: boolean; pages: number };
  pages: { url: string; score: number; status: number | null; images: ImageCandidate[] }[];
  fetches: number;
};

// The whole search, for the diagnostic endpoint (and later the photo picker).
export async function findProducerImages(site: string, name: string, producer: string | undefined, fetchImpl: typeof fetch = fetch): Promise<ProducerReport> {
  const tokens = nameTokens(name, producer);
  let fetches = 0;
  const get = async (url: string) => {
    if (fetches >= MAX_FETCHES) return null;
    fetches++;
    const res = await fetchWithTimeout(url, TIMEOUT_MS, fetchImpl, { headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/xml' }, redirect: 'follow' });
    if (!res) return { status: null, text: '', url };
    const text = res.ok ? (await res.text().catch(() => '')).slice(0, 1_500_000) : '';
    return { status: res.status, text, url: res.url || url };
  };

  const report: ProducerReport = { site, wine: name, tokens, home: { status: null, links: 0 }, sitemap: { found: false, pages: 0 }, pages: [], fetches: 0 };
  const home = await get(site);
  report.home.status = home?.status ?? null;
  const base = home?.url || site;
  const candidates = new Map<string, number>();
  const consider = (url: string, text = '') => {
    const s = Math.max(matchScore(url, tokens), matchScore(text, tokens));
    if (s > 0 && s > (candidates.get(url) ?? 0)) candidates.set(url, s);
  };
  if (home?.text) {
    const links = extractLinks(home.text, base);
    report.home.links = links.length;
    links.forEach((l) => consider(l.url, l.text));
  }
  // The sitemap lists every page, including wines not linked from the home.
  let sm = await get(new URL('/sitemap.xml', base).toString());
  if (sm?.text && /<(urlset|sitemapindex)/i.test(sm.text)) {
    report.sitemap.found = true;
    let { pages, sitemaps } = parseSitemap(sm.text);
    // A sitemap index (WordPress, Yoast…): open the product/page ones first.
    sitemaps.sort((a, b) => Number(/product|prodott|vin|wine/i.test(b)) - Number(/product|prodott|vin|wine/i.test(a)));
    for (const child of sitemaps.slice(0, 2)) {
      sm = await get(child);
      if (sm?.text) pages = pages.concat(parseSitemap(sm.text).pages);
    }
    report.sitemap.pages = pages.length;
    pages.forEach((u) => consider(u));
  }
  const best = [...candidates.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_PAGES);
  for (const [url, score] of best) {
    const page = await get(url);
    report.pages.push({ url, score: Math.round(score * 100) / 100, status: page?.status ?? null, images: page?.text ? extractImages(page.text, page.url || url, tokens).slice(0, 8) : [] });
  }
  report.fetches = fetches;
  return report;
}
