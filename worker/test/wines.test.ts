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

  it('accepts and returns grapeVariety, denomination, and imageUrl', async () => {
    const auth = signup('c5@b.com');
    const res = await app.request(
      '/api/wines',
      {
        method: 'POST',
        body: JSON.stringify({
          name: 'Barolo Riserva', producer: 'Zio Carlo', country: 'Italia', type: 'rosso',
          grapeVariety: 'Nebbiolo', denomination: 'Barolo DOCG', imageUrl: 'https://example.com/label.jpg',
        }),
        headers: { ...auth, 'content-type': 'application/json' },
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ grape_variety: string; denomination: string; image_url: string }>();
    expect(body.grape_variety).toBe('Nebbiolo');
    expect(body.denomination).toBe('Barolo DOCG');
    expect(body.image_url).toBe('https://example.com/label.jpg');
  });

  it('creates a wine with none of the optional recognition fields, same as before', async () => {
    const auth = signup('c6@b.com');
    const res = await app.request(
      '/api/wines',
      { method: 'POST', body: JSON.stringify({ name: 'Vino semplice', producer: 'Zio Carlo', country: 'Italia', type: 'rosso' }), headers: { ...auth, 'content-type': 'application/json' } },
      env,
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ grape_variety: string | null }>();
    expect(body.grape_variety).toBeNull();
  });

  it('rejects grapeVariety longer than 200 chars with 400', async () => {
    const auth = signup('c7@b.com');
    const longString = 'a'.repeat(201);
    const res = await app.request(
      '/api/wines',
      {
        method: 'POST',
        body: JSON.stringify({ name: 'Test Wine', producer: 'Zio Carlo', country: 'Italia', type: 'rosso', grapeVariety: longString }),
        headers: { ...auth, 'content-type': 'application/json' },
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('rejects denomination longer than 200 chars with 400', async () => {
    const auth = signup('c8@b.com');
    const longString = 'a'.repeat(201);
    const res = await app.request(
      '/api/wines',
      {
        method: 'POST',
        body: JSON.stringify({ name: 'Test Wine', producer: 'Zio Carlo', country: 'Italia', type: 'rosso', denomination: longString }),
        headers: { ...auth, 'content-type': 'application/json' },
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('rejects imageUrl with non-http(s) scheme with 400', async () => {
    const auth = signup('c9@b.com');
    const res = await app.request(
      '/api/wines',
      {
        method: 'POST',
        body: JSON.stringify({ name: 'Test Wine', producer: 'Zio Carlo', country: 'Italia', type: 'rosso', imageUrl: 'javascript:alert(1)' }),
        headers: { ...auth, 'content-type': 'application/json' },
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('rejects imageUrl that is not a valid URL with 400', async () => {
    const auth = signup('c10@b.com');
    const res = await app.request(
      '/api/wines',
      {
        method: 'POST',
        body: JSON.stringify({ name: 'Test Wine', producer: 'Zio Carlo', country: 'Italia', type: 'rosso', imageUrl: 'not a url' }),
        headers: { ...auth, 'content-type': 'application/json' },
      },
      env,
    );
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/wines/:id', () => {
  async function setUpWineInACellar(email: string) {
    const auth = signup(email);
    await app.request('/api/auth/me', { headers: auth }, env); // creates the user + their first cellar
    const cellarId = (await (await app.request('/api/cellars', { headers: auth }, env)).json<any[]>())[0].id;
    const wine = await env.DB
      .prepare(`insert into wines (name, producer, region, country, type, vintage, grape_variety, denomination, source) values (?, ?, ?, ?, ?, ?, ?, ?, 'custom') returning id`)
      .bind('Le due torri rebel', 'Le Due Torri', 'Veneto', 'Italia', 'bianco', 2021, 'Garganega', 'IGT')
      .first<{ id: number }>();
    await app.request(
      `/api/cellars/${cellarId}/bottles`,
      { method: 'POST', body: JSON.stringify({ wineId: wine!.id, quantity: 1 }), headers: { ...auth, 'content-type': 'application/json' } },
      env,
    );
    return { auth, wineId: wine!.id };
  }

  it('edits every field, including clearing an optional one back to null', async () => {
    const { auth, wineId } = await setUpWineInACellar('editor1@b.com');
    const res = await app.request(
      `/api/wines/${wineId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Le due torri rebel', producer: 'Le Due Torri', country: 'Italia', region: 'Veneto', type: 'bianco', vintage: 2021, grapeVariety: 'Garganega', denomination: null }),
        headers: { ...auth, 'content-type': 'application/json' },
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ denomination: string | null; grape_variety: string }>();
    expect(body.denomination).toBeNull();
    expect(body.grape_variety).toBe('Garganega');
  });

  it('rejects a caller who has no cellar containing this wine with 404', async () => {
    const { wineId } = await setUpWineInACellar('editor2@b.com');
    const outsider = signup('outsider-edit@b.com');
    await app.request('/api/auth/me', { headers: outsider }, env);
    const res = await app.request(
      `/api/wines/${wineId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Hijacked', producer: 'x', country: 'Italia', type: 'rosso' }),
        headers: { ...outsider, 'content-type': 'application/json' },
      },
      env,
    );
    expect(res.status).toBe(404);
  });

  it('rejects a missing required field with 400', async () => {
    const { auth, wineId } = await setUpWineInACellar('editor3@b.com');
    const res = await app.request(
      `/api/wines/${wineId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ name: '', producer: 'Le Due Torri', country: 'Italia', type: 'bianco' }),
        headers: { ...auth, 'content-type': 'application/json' },
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('rejects an invalid type with 400', async () => {
    const { auth, wineId } = await setUpWineInACellar('editor4@b.com');
    const res = await app.request(
      `/api/wines/${wineId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ name: 'x', producer: 'y', country: 'Italia', type: 'not-a-type' }),
        headers: { ...auth, 'content-type': 'application/json' },
      },
      env,
    );
    expect(res.status).toBe(400);
  });
});
