import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../src/index';

async function signup(email: string) {
  const res = await app.request(
    '/api/auth/signup',
    { method: 'POST', body: JSON.stringify({ email, password: 'secret123', name: email }), headers: { 'content-type': 'application/json' } },
    env,
  );
  return res.headers.get('set-cookie')!.split(';')[0];
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
    const cookie = await signup('s1@b.com');
    const res = await app.request('/api/wines/search?q=barolo', { headers: { cookie } }, env);
    const results = await res.json<any[]>();
    expect(results).toHaveLength(1);
    expect(results[0].producer).toBe('Elio Altare');
  });

  it('matches an exact barcode', async () => {
    const cookie = await signup('s2@b.com');
    const res = await app.request('/api/wines/search?barcode=8001234500019', { headers: { cookie } }, env);
    const results = await res.json<any[]>();
    expect(results).toHaveLength(1);
  });
});

describe('POST /api/wines', () => {
  it('creates a custom wine', async () => {
    const cookie = await signup('c1@b.com');
    const res = await app.request(
      '/api/wines',
      {
        method: 'POST',
        body: JSON.stringify({ name: 'Vino di famiglia', producer: 'Zio Carlo', region: 'Umbria', country: 'Italia', type: 'rosso', vintage: 2020 }),
        headers: { cookie, 'content-type': 'application/json' },
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ source: string }>();
    expect(body.source).toBe('custom');
  });

  it('rejects an invalid type with 400', async () => {
    const cookie = await signup('c2@b.com');
    const res = await app.request(
      '/api/wines',
      {
        method: 'POST',
        body: JSON.stringify({ name: 'Vino strano', producer: 'Zio Carlo', country: 'Italia', type: 'not-a-real-type' }),
        headers: { cookie, 'content-type': 'application/json' },
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('rejects an out-of-range vintage with 400', async () => {
    const cookie = await signup('c3@b.com');
    const res = await app.request(
      '/api/wines',
      {
        method: 'POST',
        body: JSON.stringify({ name: 'Vino del futuro', producer: 'Zio Carlo', country: 'Italia', type: 'rosso', vintage: 3050 }),
        headers: { cookie, 'content-type': 'application/json' },
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('rejects an empty name with 400', async () => {
    const cookie = await signup('c4@b.com');
    const res = await app.request(
      '/api/wines',
      {
        method: 'POST',
        body: JSON.stringify({ name: '', producer: 'Zio Carlo', country: 'Italia', type: 'rosso' }),
        headers: { cookie, 'content-type': 'application/json' },
      },
      env,
    );
    expect(res.status).toBe(400);
  });
});
