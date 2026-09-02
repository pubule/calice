import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../src/index';

function signup(email: string) {
  return { 'X-Calice-Dev-Email': email };
}

beforeEach(async () => {
  await env.DB.exec('DELETE FROM wines; DELETE FROM cellar_members; DELETE FROM cellars; DELETE FROM users;');
  await env.DB
    .prepare(`insert into wines (name, producer, region, country, type, vintage, barcode, source)
               values ('Barolo DOCG', 'Elio Altare', 'Piemonte', 'Italia', 'rosso', 2016, '8001234500019', 'catalog')`)
    .run();
});

describe('GET /api/wines/search', () => {
  it('matches by partial name', async () => {
    const auth = signup('s1@b.com');
    const res = await app.request('/api/wines/search?q=barolo', { headers: auth }, env);
    const results = await res.json<any[]>();
    expect(results).toHaveLength(1);
    expect(results[0].producer).toBe('Elio Altare');
  });

  it('matches an exact barcode', async () => {
    const auth = signup('s2@b.com');
    const res = await app.request('/api/wines/search?barcode=8001234500019', { headers: auth }, env);
    const results = await res.json<any[]>();
    expect(results).toHaveLength(1);
  });
});

describe('POST /api/wines', () => {
  it('creates a custom wine', async () => {
    const auth = signup('c1@b.com');
    const res = await app.request(
      '/api/wines',
      {
        method: 'POST',
        body: JSON.stringify({ name: 'Vino di famiglia', producer: 'Zio Carlo', region: 'Umbria', country: 'Italia', type: 'rosso', vintage: 2020 }),
        headers: { ...auth, 'content-type': 'application/json' },
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ source: string }>();
    expect(body.source).toBe('custom');
  });

  it('rejects an invalid type with 400', async () => {
    const auth = signup('c2@b.com');
    const res = await app.request(
      '/api/wines',
      {
        method: 'POST',
        body: JSON.stringify({ name: 'Vino strano', producer: 'Zio Carlo', country: 'Italia', type: 'not-a-real-type' }),
        headers: { ...auth, 'content-type': 'application/json' },
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('rejects an out-of-range vintage with 400', async () => {
    const auth = signup('c3@b.com');
    const res = await app.request(
      '/api/wines',
      {
        method: 'POST',
        body: JSON.stringify({ name: 'Vino del futuro', producer: 'Zio Carlo', country: 'Italia', type: 'rosso', vintage: 3050 }),
        headers: { ...auth, 'content-type': 'application/json' },
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('rejects an empty name with 400', async () => {
    const auth = signup('c4@b.com');
    const res = await app.request(
      '/api/wines',
      {
        method: 'POST',
        body: JSON.stringify({ name: '', producer: 'Zio Carlo', country: 'Italia', type: 'rosso' }),
        headers: { ...auth, 'content-type': 'application/json' },
      },
      env,
    );
    expect(res.status).toBe(400);
  });
});
