import { fetchWithTimeout } from './fetch-timeout';
import { detectImageType } from '../routes/photos';
import { ZONES, type Zone } from './landscape-zones';

// A photo of vineyards for a wine's area, shown behind the bottle in the
// detail sheet. First the hand-picked photos of a known zone
// (landscape-zones.ts), one per wine. Otherwise a search on Wikimedia Commons
// (free, no key, free licences only), remembered per search term in
// `landscapes`, so each area costs one search ever. The most specific term
// goes first: the denomination ("Barolo"), then the region ("Piemonte"), then
// the country. Every photo is served from our R2 (the user's choice: no links
// to other sites), under landscapes/.

export const LANDSCAPE_IMAGE = '/api/landscape-images/';
const ownUrl = (key: string) => LANDSCAPE_IMAGE + encodeURIComponent(key);

const TIMEOUT_MS = 6000;
// One of Wikimedia's standard thumbnail widths: those are already generated
// and cached at the edge, so they arrive fast (other widths are rendered on
// demand, slowly, and may be refused). Enough for a phone at 2-3x.
const THUMB_WIDTH = 960;
// Rows saved with another width are served at this one.
const atWidth = (url: string) => url.replace(/\/\d+px-([^/]+)$/, `/${THUMB_WIDTH}px-$1`);
const RETRY_DAYS = 30; // an area with nothing usable is searched again after this
const API = 'https://commons.wikimedia.org/w/api.php';
// Wikimedia asks API clients to identify themselves.
const UA = 'Calice/1.0 (personal wine cellar app; https://github.com/pubule/calice)';

const COUNTRY_EN: Record<string, string> = {
  italia: 'Italy', francia: 'France', spagna: 'Spain', germania: 'Germany', 'stati uniti': 'United States',
  australia: 'Australia', portogallo: 'Portugal', argentina: 'Argentina', cile: 'Chile', sudafrica: 'South Africa',
  austria: 'Austria', 'nuova zelanda': 'New Zealand', grecia: 'Greece', ungheria: 'Hungary', slovenia: 'Slovenia',
};

const fold = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Classification words say nothing about the place: "Franciacorta DOCG" and
// "Saint-Émilion Grand Cru" are searched as "Franciacorta" and "Saint-Émilion".
export function placeOf(denomination: string): string {
  return denomination
    .replace(/\b(DOCG|DOC|DOCa|DOQ|DO|IGT|IGP|AOC|AOP|AVA|QbA|VdP|Grand Cru Class[ée]|Grand Cru|Premier Cru|1er Cru|Riserva|Superiore|Reserva|Gran Reserva)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim();
}

export type Area = { denomination?: string | null; region?: string | null; country?: string | null };

// Search terms, most specific first, each with the key it is remembered by.
export function landscapeTerms(a: Area): { key: string; query: string }[] {
  const out: { key: string; query: string }[] = [];
  const add = (q: string | null | undefined) => {
    const query = (q ?? '').trim();
    const key = fold(query);
    if (key.length > 1 && !out.some((t) => t.key === key)) out.push({ key, query });
  };
  if (a.denomination) add(placeOf(a.denomination));
  add(a.region);
  if (a.country) add(COUNTRY_EN[fold(a.country).trim()] ?? a.country);
  return out;
}

// The hand-picked zone for an area: the denomination decides, else the region.
export function zoneFor(a: Area): Zone | null {
  for (const text of [a.denomination, a.region]) {
    const t = fold(text ?? '');
    if (!t) continue;
    const zone = ZONES.find((z) => z.match.test(t));
    if (zone) return zone;
  }
  return null;
}

// Always the same photo for the same wine, spread over the zone's photos.
export function zonePhoto(zone: Zone, seed: string): Zone['photos'][number] {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return zone.photos[(h >>> 0) % zone.photos.length];
}

export type Landscape = { url: string; pageUrl: string; author: string; license: string; licenseUrl: string | null; file: string };

type Page = {
  title: string; index?: number;
  imageinfo?: { thumburl?: string; url?: string; descriptionurl?: string; width?: number; height?: number; mime?: string;
    extmetadata?: Record<string, { value?: string } | undefined> }[];
};

const VINE = /vine|vign|vigne|vino|wine|weinberg|weinbau|reben|vi[nñ]edo|vinha|wijn/i;
const OFF = /\b(map|mappa|karte|carte|label|etichetta|bottle|bottiglia|logo|sign|cartello|cellar|cantina|barrel|botti|museum|museo|menu|glass|bicchiere|harvest machine|tractor|trattore)\b/i;
const FREE = /^(cc0|cc[ -]by(-sa)?(\s[\d.]+)?|public domain|pd\b)/i;

const strip = (html: string | undefined) => (html ?? '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#039;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

// The best usable photo among a search's results, or null. Usable: a wide
// JPEG, big enough for a phone at 3x, under a free licence that allows
// reuse (no NC/ND), about vineyards (title, description or categories),
// and not a map, a label or a bottle.
export function pickLandscape(pages: Page[], query: string): Landscape | null {
  const words = fold(query).split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  let best: { score: number; l: Landscape } | null = null;
  for (const p of pages) {
    const ii = p.imageinfo?.[0];
    const m = ii?.extmetadata ?? {};
    if (!ii?.thumburl || ii.mime !== 'image/jpeg' || !ii.width || !ii.height) continue;
    const ratio = ii.width / ii.height;
    if (ii.width < 1600 || ratio < 1.25 || ratio > 2.4) continue;
    const license = strip(m.LicenseShortName?.value);
    if (!FREE.test(license) || /\b(nc|nd)\b/i.test(license)) continue;
    const title = p.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, '');
    const cats = strip(m.Categories?.value);
    const about = `${title} ${strip(m.ImageDescription?.value)} ${cats}`;
    if (!VINE.test(about) || OFF.test(title)) continue;
    // The photo must name the place: a vineyard anywhere is not this area's.
    if (words.length && !words.some((w) => fold(about).includes(w))) continue;
    let score = 10 - (p.index ?? 0) * 0.3;
    if (VINE.test(title)) score += 3;
    if (/quality images|featured pictures|valued images/i.test(cats)) score += 3;
    if (words.some((w) => fold(title).includes(w))) score += 2;
    const author = strip(m.Artist?.value).slice(0, 120) || 'Autore sconosciuto';
    const l: Landscape = { url: ii.thumburl, pageUrl: ii.descriptionurl ?? '', author, license, licenseUrl: strip(m.LicenseUrl?.value) || null, file: p.title };
    if (!best || score > best.score) best = { score, l };
  }
  return best?.l ?? null;
}

// The search's results, or null when Commons could not be reached.
export async function searchCommons(query: string, fetchImpl: typeof fetch = fetch): Promise<Page[] | null> {
  const params = new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', generator: 'search',
    gsrsearch: `${query} vineyard filetype:bitmap`, gsrnamespace: '6', gsrlimit: '20',
    prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: String(THUMB_WIDTH),
    iiextmetadatafilter: 'Artist|LicenseShortName|LicenseUrl|Categories|ImageDescription',
  });
  const res = await fetchWithTimeout(`${API}?${params}`, TIMEOUT_MS, fetchImpl, { headers: { 'user-agent': UA, 'api-user-agent': UA } });
  if (!res?.ok) return null;
  const data = await res.json().catch(() => null) as { query?: { pages?: Page[] } } | null;
  return data ? data.query?.pages ?? [] : null;
}

type Row = { file: string | null; url: string | null; page_url: string | null; author: string | null; license: string | null; license_url: string | null; fresh: number };

// The photo for a wine's area: a hand-picked one (seed: the wine, so each
// wine of a zone keeps its own), else a remembered or new search. A term
// with nothing usable is remembered too (file null) and skipped for
// RETRY_DAYS. A Commons error is not remembered: it is tried again next time.
// A row from before the photos lived in R2 (url on Commons) is searched again.
export async function findLandscape(env: { DB: D1Database; PHOTOS: R2Bucket }, area: Area, fetchImpl: typeof fetch = fetch, seed = ''): Promise<Landscape | null> {
  const zone = zoneFor(area);
  if (zone) {
    const p = zonePhoto(zone, seed || fold(`${area.denomination ?? ''}|${area.region ?? ''}`));
    return { file: p.file, url: ownUrl(p.key), pageUrl: p.pageUrl, author: p.author, license: p.license, licenseUrl: p.licenseUrl };
  }
  for (const { key, query } of landscapeTerms(area)) {
    const row = await env.DB
      .prepare(`select file, url, page_url, author, license, license_url, checked_at > datetime('now', ?) as fresh from landscapes where term = ?`)
      .bind(`-${RETRY_DAYS} days`, key)
      .first<Row>();
    if (row?.file && row.url?.startsWith(LANDSCAPE_IMAGE)) {
      return { file: row.file, url: row.url, pageUrl: row.page_url ?? '', author: row.author ?? '', license: row.license ?? '', licenseUrl: row.license_url };
    }
    if (row && !row.file && row.fresh) continue;
    const pages = await searchCommons(query, fetchImpl);
    if (!pages) return null; // Commons unreachable: nothing remembered, retried next time
    const picked = pickLandscape(pages, query);
    const found = picked && (await copyToR2(env.PHOTOS, picked, fetchImpl));
    if (picked && !found) return null; // download failed: retried next time
    await remember(env.DB, key, found);
    if (found) return found;
  }
  return null;
}

// The photo's bytes into R2, or null when they could not be fetched.
async function copyToR2(photos: R2Bucket, l: Landscape, fetchImpl: typeof fetch): Promise<Landscape | null> {
  const res = await fetchWithTimeout(atWidth(l.url), TIMEOUT_MS, fetchImpl, { headers: { 'user-agent': UA } });
  const bytes = res?.ok ? await res.arrayBuffer().catch(() => null) : null;
  const type = bytes && detectImageType(bytes);
  if (!bytes || !type) return null;
  const key = `landscapes/auto/${crypto.randomUUID()}`;
  await photos.put(key, bytes, { httpMetadata: { contentType: type } });
  return { ...l, url: ownUrl(key) };
}

async function remember(db: D1Database, key: string, l: Landscape | null) {
  await db
    .prepare(`insert into landscapes (term, file, url, page_url, author, license, license_url, checked_at)
              values (?, ?, ?, ?, ?, ?, ?, datetime('now'))
              on conflict(term) do update set file = excluded.file, url = excluded.url, page_url = excluded.page_url,
                author = excluded.author, license = excluded.license, license_url = excluded.license_url, checked_at = excluded.checked_at`)
    .bind(key, l?.file ?? null, l?.url ?? null, l?.pageUrl ?? null, l?.author ?? null, l?.license ?? null, l?.licenseUrl ?? null)
    .run();
}
