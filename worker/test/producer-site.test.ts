import { describe, it, expect } from 'vitest';
import { nameTokens, matchScore, extractLinks, parseSitemap, extractImages, findProducerImages } from '../src/lib/producer-site';

describe('producer-site helpers', () => {
  it('keeps the words that identify a wine, dropping the producer and generic ones', () => {
    expect(nameTokens('Blanc de Noirs Brut', 'Zamuner')).toEqual(['blanc', 'noirs', 'brut']);
    expect(nameTokens('Zamuner Amarone della Valpolicella', 'Zamuner')).toEqual(['amarone', 'valpolicella']);
  });

  it('scores a URL by the share of the name words it contains', () => {
    const t = ['blanc', 'noirs', 'brut'];
    expect(matchScore('https://www.zamuner.it/vini/blanc-de-noirs-brut/', t)).toBe(1);
    expect(matchScore('https://www.zamuner.it/vini/brut-rose/', t)).toBeCloseTo(1 / 3);
    expect(matchScore('https://www.zamuner.it/contatti', t)).toBe(0);
  });

  it('extracts same-site links with their text, and sitemap pages or child sitemaps', () => {
    const links = extractLinks('<a href="/vini/brut">Il <b>Brut</b></a><a href="https://other.com/x">x</a><a href="#top">su</a>', 'https://www.zamuner.it/');
    expect(links).toEqual([{ url: 'https://www.zamuner.it/vini/brut', text: 'Il Brut' }, { url: 'https://www.zamuner.it/', text: 'su' }]);
    expect(parseSitemap('<urlset><url><loc>https://a.it/x</loc></url></urlset>')).toEqual({ pages: ['https://a.it/x'], sitemaps: [] });
    expect(parseSitemap('<sitemapindex><sitemap><loc>https://a.it/p.xml</loc></sitemap></sitemapindex>')).toEqual({ pages: [], sitemaps: ['https://a.it/p.xml'] });
  });

  it('collects declared and matching images, best first, skipping logos', () => {
    const html = `
      <meta property="og:image" content="/img/og-brut.jpg">
      <script type="application/ld+json">{"@type":"Product","image":["https://cdn.x.it/brut-bottle.png"]}</script>
      <img src="/img/logo.png" alt="Zamuner">
      <img data-src="/img/blanc-de-noirs.jpg" alt="Blanc de Noirs Brut">
      <img src="/img/team.jpg" alt="La famiglia">`;
    const imgs = extractImages(html, 'https://www.zamuner.it/vini/brut/', ['blanc', 'noirs', 'brut']);
    expect(imgs.map((i) => [i.source, i.url])).toEqual([
      ['img', 'https://www.zamuner.it/img/blanc-de-noirs.jpg'],
      ['jsonld', 'https://cdn.x.it/brut-bottle.png'],
      ['og', 'https://www.zamuner.it/img/og-brut.jpg'],
    ]);
  });
});

describe('findProducerImages', () => {
  it('finds the wine page through the sitemap and returns its images, within the fetch budget', async () => {
    const pages: Record<string, string> = {
      'https://www.zamuner.it/': '<a href="/contatti">Contatti</a>',
      'https://www.zamuner.it/sitemap.xml': '<urlset><url><loc>https://www.zamuner.it/vini/blanc-de-noirs-brut/</loc></url><url><loc>https://www.zamuner.it/vini/rose/</loc></url></urlset>',
      'https://www.zamuner.it/vini/blanc-de-noirs-brut/': '<meta property="og:image" content="https://www.zamuner.it/img/bdn.jpg">',
    };
    const fake = (async (url: string) => (pages[url] ? new Response(pages[url], { status: 200 }) : new Response('nope', { status: 404 }))) as typeof fetch;
    const r = await findProducerImages('https://www.zamuner.it/', 'Blanc de Noirs Brut', 'Zamuner', fake);
    expect(r.sitemap).toEqual({ found: true, pages: 2 });
    expect(r.pages[0]).toMatchObject({ url: 'https://www.zamuner.it/vini/blanc-de-noirs-brut/', score: 1, status: 200 });
    expect(r.pages[0].images[0].url).toBe('https://www.zamuner.it/img/bdn.jpg');
    expect(r.fetches).toBeLessThanOrEqual(8);
  });

  it('reports a site that does not answer instead of failing', async () => {
    const fake = (async () => { throw new Error('down'); }) as unknown as typeof fetch;
    const r = await findProducerImages('https://nessuno.it/', 'Brut', undefined, fake);
    expect(r.home.status).toBeNull();
    expect(r.pages).toEqual([]);
  });
});
