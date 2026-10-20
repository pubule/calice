import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../src/index';

// Every user sees and changes only their own data: Bob, signed in, tries each
// route on Alice's cellar, bottles, places, notes, photos, wishlist and wines.
// Each must be refused, and Alice's data must stay as it was.

const alice = { 'X-Calice-Dev-Email': 'alice@iso.test' };
const bob = { 'X-Calice-Dev-Email': 'bob@iso.test' };

const call = (auth: Record<string, string>, method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: { ...auth, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
const json = async <T = any>(auth: Record<string, string>, method: string, path: string, body?: unknown) => (await call(auth, method, path, body)).json<T>();

let a: { cellar: number; wine: number; bottle: number; element: number; place: number; note: number; wish: number };

beforeEach(async () => {
  await env.DB.exec(
    'DELETE FROM photos; DELETE FROM tasting_notes; DELETE FROM bottle_places; DELETE FROM cellar_elements; DELETE FROM wishlist_items; DELETE FROM bottles; DELETE FROM wines; DELETE FROM cellar_members; DELETE FROM cellars; DELETE FROM users;',
  );
  const cellar = (await json<any[]>(alice, 'GET', '/api/cellars'))[0].id;
  const wine = (await json(alice, 'POST', '/api/wines', { name: 'Vino di Alice', producer: 'Casa Alice', country: 'Italia', type: 'rosso', vintage: 2020 })).id;
  const bottle = (await json(alice, 'POST', `/api/cellars/${cellar}/bottles`, { wineId: wine, quantity: 2 })).id;
  const element = (await json(alice, 'POST', `/api/cellars/${cellar}/elements`, { kind: 'Scaffale', name: 'Scaffale Alice', tiers: 2, cols: 2, depth: 1 })).id;
  const place = (await json(alice, 'POST', `/api/bottles/${bottle}/places`, { elementId: element, tier: 1, col: 0, depth: 1 })).places[0].id;
  const note = (await json(alice, 'POST', `/api/bottles/${bottle}/notes`, { rating: 4, text: 'segreto di Alice' })).id;
  const wish = (await json(alice, 'POST', `/api/cellars/${cellar}/wishlist`, { wineId: wine })).id;
  a = { cellar, wine, bottle, element, place, note, wish };
  // A setup that silently failed would make every refusal below pass for nothing.
  for (const [k, v] of Object.entries(a)) expect(Number.isInteger(v), k).toBe(true);
  await call(bob, 'GET', '/api/cellars'); // Bob exists, with his own cellar
});

describe('two users never see or touch each other\'s data', () => {
  it('Bob\'s own lists hold nothing of Alice', async () => {
    const cellars = await json<any[]>(bob, 'GET', '/api/cellars');
    expect(cellars).toHaveLength(1);
    expect(cellars[0].id).not.toBe(a.cellar);
    const mine = cellars[0].id;
    expect(await json(bob, 'GET', `/api/cellars/${mine}/bottles`)).toEqual([]);
    expect(await json(bob, 'GET', `/api/cellars/${mine}/elements`)).toEqual([]);
    expect(await json(bob, 'GET', `/api/cellars/${mine}/wishlist`)).toEqual([]);
    const backup = await json(bob, 'GET', '/api/backup');
    expect(JSON.stringify(backup)).not.toContain('segreto di Alice');
    expect(JSON.stringify(backup)).not.toContain('Scaffale Alice');
  });

  it('every read of Alice\'s things is refused', async () => {
    for (const path of [
      `/api/cellars/${a.cellar}/bottles`,
      `/api/cellars/${a.cellar}/elements`,
      `/api/cellars/${a.cellar}/wishlist`,
      `/api/bottles/${a.bottle}/photos`,
    ]) expect([403, 404], path).toContain((await call(bob, 'GET', path)).status);
    const notes = await json<any[]>(bob, 'GET', `/api/bottles/${a.bottle}/notes`);
    expect(notes).toEqual([]);
  });

  it('every write on Alice\'s things is refused and changes nothing', async () => {
    const writes: [string, string, unknown?][] = [
      ['PATCH', `/api/cellars/${a.cellar}`, { name: 'Rubata' }],
      ['POST', `/api/cellars/${a.cellar}/bottles`, { wineId: a.wine, quantity: 1 }],
      ['POST', `/api/cellars/${a.cellar}/elements`, { kind: 'Rack', name: 'X', tiers: 1, cols: 1, depth: 1 }],
      ['POST', `/api/cellars/${a.cellar}/wishlist`, { wineId: a.wine }],
      ['PATCH', `/api/bottles/${a.bottle}`, { quantity: 0 }],
      ['POST', `/api/bottles/${a.bottle}/places`, { elementId: a.element, tier: 2, col: 1, depth: 1 }],
      ['POST', `/api/bottles/${a.bottle}/vintage`, { vintage: 2019, quantity: 1 }],
      ['POST', `/api/bottles/${a.bottle}/notes`, { rating: 1, text: 'di Bob' }],
      ['PATCH', `/api/bottles/${a.bottle}/notes/${a.note}`, { rating: 1, text: 'di Bob' }],
      ['PUT', `/api/bottles/${a.bottle}/my-rating`, { rating: 1 }],
      ['POST', `/api/bottles/${a.bottle}/photos`],
      ['PATCH', `/api/places/${a.place}`, { elementId: a.element, tier: 2, col: 1, depth: 1 }],
      ['DELETE', `/api/places/${a.place}`],
      ['PATCH', `/api/elements/${a.element}`, { name: 'Rubato' }],
      ['DELETE', `/api/elements/${a.element}`],
      ['DELETE', `/api/wishlist/${a.wish}`],
      ['PATCH', `/api/wines/${a.wine}`, { name: 'Rubato', producer: 'Bob', country: 'Italia', type: 'bianco' }],
      ['PUT', `/api/wines/${a.wine}/image`, { url: 'https://example.com/x.jpg' }],
      ['DELETE', `/api/wines/${a.wine}/image`],
      ['DELETE', `/api/bottles/${a.bottle}`],
      ['DELETE', `/api/cellars/${a.cellar}`],
    ];
    for (const [method, path, body] of writes) {
      const res = await call(bob, method, path, body);
      expect([400, 403, 404], `${method} ${path}`).toContain(res.status);
    }

    // Alice's data, untouched.
    const cellars = await json<any[]>(alice, 'GET', '/api/cellars');
    expect(cellars.map((c) => [c.id, c.name])).toEqual([[a.cellar, cellars[0].name]]);
    expect(cellars[0].name).not.toBe('Rubata');
    const bottles = await json<any[]>(alice, 'GET', `/api/cellars/${a.cellar}/bottles`);
    expect(bottles.map((b) => [b.id, b.quantity, b.name, b.places.length])).toEqual([[a.bottle, 2, 'Vino di Alice', 1]]);
    const elements = await json<any[]>(alice, 'GET', `/api/cellars/${a.cellar}/elements`);
    expect(elements.map((e) => e.name)).toEqual(['Scaffale Alice']);
    expect((await json<any[]>(alice, 'GET', `/api/cellars/${a.cellar}/wishlist`)).map((w) => w.id)).toEqual([a.wish]);
    const notes = await json<any[]>(alice, 'GET', `/api/bottles/${a.bottle}/notes`);
    expect(notes.map((n) => [n.text, n.rating])).toEqual([['segreto di Alice', 4]]);
  });

  it('Bob cannot put his own bottle on Alice\'s shelf', async () => {
    const mine = (await json<any[]>(bob, 'GET', '/api/cellars'))[0].id;
    const bottle = (await json(bob, 'POST', `/api/cellars/${mine}/bottles`, { wineId: a.wine, quantity: 1 })).id;
    expect((await call(bob, 'POST', `/api/bottles/${bottle}/places`, { elementId: a.element, tier: 2, col: 1, depth: 1 })).status).toBe(400);
    // Adding Alice's wine gave Bob his own copy, never Alice's row.
    const [row] = await json<any[]>(bob, 'GET', `/api/cellars/${mine}/bottles`);
    expect(row.wine_id).not.toBe(a.wine);
  });
});
