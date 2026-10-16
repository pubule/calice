import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../src/index';

async function signup(email: string) {
  const auth = { 'X-Calice-Dev-Email': email };
  const me = await (await app.request('/api/auth/me', { headers: auth }, env)).json<{ id: number }>();
  return { auth, userId: me.id };
}

let bottleId: number;
let cellarId: number;
let ownerAuth: Record<string, string>;

beforeEach(async () => {
  await env.DB.exec(
    'DELETE FROM tasting_notes; DELETE FROM follows; DELETE FROM bottle_places; DELETE FROM bottles; DELETE FROM wines; DELETE FROM cellar_members; DELETE FROM cellars; DELETE FROM users;',
  );
  const owner = await signup('owner@notes.com');
  ownerAuth = owner.auth;
  cellarId = (await (await app.request('/api/cellars', { headers: owner.auth }, env)).json<any[]>())[0].id;
  const wine = await env.DB.prepare(`insert into wines (name, producer, country, type, source) values ('Barolo DOCG', 'Elio Altare', 'Italia', 'rosso', 'catalog') returning id`).first<{ id: number }>();
  const bottle = await app.request(
    `/api/cellars/${cellarId}/bottles`,
    { method: 'POST', body: JSON.stringify({ wineId: wine!.id, quantity: 1 }), headers: { ...owner.auth, 'content-type': 'application/json' } },
    env,
  );
  bottleId = (await bottle.json<{ id: number }>()).id;
});

describe('tasting notes visibility', () => {
  it('a note is visible to its author, a follower, a cellar-mate, and hidden from a stranger', async () => {
    const author = await signup('author@notes.com');
    await env.DB.prepare('insert into cellar_members (cellar_id, user_id, role) values (?, ?, ?)').bind(cellarId, author.userId, 'member').run();

    await app.request(
      `/api/bottles/${bottleId}/notes`,
      { method: 'POST', body: JSON.stringify({ rating: 4.5, text: 'Ottimo con brasato' }), headers: { ...author.auth, 'content-type': 'application/json' } },
      env,
    );

    // author sees own note
    const authorView = await (await app.request(`/api/bottles/${bottleId}/notes`, { headers: author.auth }, env)).json<any[]>();
    expect(authorView).toHaveLength(1);

    // follower sees it
    const follower = await signup('follower@notes.com');
    await env.DB.prepare('insert into follows (follower_id, followee_id) values (?, ?)').bind(follower.userId, author.userId).run();
    const followerView = await (await app.request(`/api/bottles/${bottleId}/notes`, { headers: follower.auth }, env)).json<any[]>();
    expect(followerView).toHaveLength(1);

    // cellar-mate sees it (author is already a cellar member)
    const cellarMate = await signup('mate@notes.com');
    await env.DB.prepare('insert into cellar_members (cellar_id, user_id, role) values (?, ?, ?)').bind(cellarId, cellarMate.userId, 'member').run();
    const mateView = await (await app.request(`/api/bottles/${bottleId}/notes`, { headers: cellarMate.auth }, env)).json<any[]>();
    expect(mateView).toHaveLength(1);

    // a stranger with no relationship sees nothing
    const stranger = await signup('stranger@notes.com');
    const strangerView = await (await app.request(`/api/bottles/${bottleId}/notes`, { headers: stranger.auth }, env)).json<any[]>();
    expect(strangerView).toHaveLength(0);
  });

  it('rejects a note write from a caller who is not a member of the bottle\'s cellar', async () => {
    const outsider = await signup('outsider@notes.com');
    const res = await app.request(
      `/api/bottles/${bottleId}/notes`,
      { method: 'POST', body: JSON.stringify({ rating: 5, text: 'not my cellar' }), headers: { ...outsider.auth, 'content-type': 'application/json' } },
      env,
    );
    expect(res.status).toBe(404);
    const notes = await env.DB.prepare('select count(*) as n from tasting_notes where bottle_id = ?').bind(bottleId).first<{ n: number }>();
    expect(notes!.n).toBe(0);
  });

  it('rejects a rating outside 0-5 with 400', async () => {
    const res = await app.request(
      `/api/bottles/${bottleId}/notes`,
      { method: 'POST', body: JSON.stringify({ rating: 7, text: 'troppo entusiasta' }), headers: { ...ownerAuth, 'content-type': 'application/json' } },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('accepts an empty text alongside a tasting profile (tags/sliders/pairings are their own reason to save)', async () => {
    const res = await app.request(
      `/api/bottles/${bottleId}/notes`,
      {
        method: 'POST',
        body: JSON.stringify({
          rating: 0,
          text: '',
          flavorTags: ['Frutti di bosco', 'Prugna'],
          foodPairings: ['Manzo'],
          tasteAcidity: 35,
          tasteSweetness: 20,
          tasteTannin: 50,
          tasteBody: 78,
          tasteAlcohol: 65,
          tasteIntensity: 80,
          tasteFinish: 90,
        }),
        headers: { ...ownerAuth, 'content-type': 'application/json' },
      },
      env,
    );
    expect(res.status).toBe(200);
    const note = await res.json<any>();
    expect(note.text).toBe('');
    expect(note.flavor_tags).toEqual(['Frutti di bosco', 'Prugna']);
    expect(note.food_pairings).toEqual(['Manzo']);
    expect(note.taste_acidity).toBe(35);
    expect(note.taste_body).toBe(78);
    expect(note).toMatchObject({ taste_alcohol: 65, taste_intensity: 80, taste_finish: 90 });

    const listed = await (await app.request(`/api/bottles/${bottleId}/notes`, { headers: ownerAuth }, env)).json<any[]>();
    expect(listed[0].flavor_tags).toEqual(['Frutti di bosco', 'Prugna']);
  });

  it('rejects text over 2000 chars with 400', async () => {
    const res = await app.request(
      `/api/bottles/${bottleId}/notes`,
      { method: 'POST', body: JSON.stringify({ rating: 4, text: 'x'.repeat(2001) }), headers: { ...ownerAuth, 'content-type': 'application/json' } },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('rejects a taste axis outside 0-100 with 400', async () => {
    const res = await app.request(
      `/api/bottles/${bottleId}/notes`,
      { method: 'POST', body: JSON.stringify({ rating: 4, text: 'ok', tasteBody: 150 }), headers: { ...ownerAuth, 'content-type': 'application/json' } },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('rejects a non-array flavorTags with 400', async () => {
    const res = await app.request(
      `/api/bottles/${bottleId}/notes`,
      { method: 'POST', body: JSON.stringify({ rating: 4, text: 'ok', flavorTags: 'Prugna' }), headers: { ...ownerAuth, 'content-type': 'application/json' } },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('updates the author\'s own note in place (full overwrite), and refuses anyone else', async () => {
    const json = { ...ownerAuth, 'content-type': 'application/json' };
    const created = await (await app.request(`/api/bottles/${bottleId}/notes`, { method: 'POST', body: JSON.stringify({ rating: 3, text: 'Prima', flavorTags: ['Ciliegia'], tasteAcidity: 40 }), headers: json }, env)).json<{ id: number }>();
    const res = await app.request(`/api/bottles/${bottleId}/notes/${created.id}`, { method: 'PATCH', body: JSON.stringify({ rating: 5, text: 'Dopo', tasteAcidity: 70 }), headers: json }, env);
    expect(res.status).toBe(200);
    const updated = await res.json<any>();
    expect(updated).toMatchObject({ id: created.id, rating: 5, text: 'Dopo', taste_acidity: 70, flavor_tags: [] });
    expect((await env.DB.prepare('select count(*) as n from tasting_notes').first<{ n: number }>())?.n).toBe(1);

    const stranger = await signup('stranger@notes.com');
    const denied = await app.request(`/api/bottles/${bottleId}/notes/${created.id}`, { method: 'PATCH', body: JSON.stringify({ rating: 1, text: 'x' }), headers: { ...stranger.auth, 'content-type': 'application/json' } }, env);
    expect(denied.status).toBe(404);
    const bad = await app.request(`/api/bottles/${bottleId}/notes/${created.id}`, { method: 'PATCH', body: JSON.stringify({ rating: 9, text: 'x' }), headers: json }, env);
    expect(bad.status).toBe(400);
  });
});

describe('GET /api/me/palate', () => {
  it('counts each aroma once per note, only across the caller’s own notes', async () => {
    const json = { ...ownerAuth, 'content-type': 'application/json' };
    const post = (body: object, headers = json) => app.request(`/api/bottles/${bottleId}/notes`, { method: 'POST', body: JSON.stringify(body), headers }, env);
    await post({ rating: 4, text: 'a', flavorTags: ['Ciliegia', 'Rosa'] });
    await post({ rating: 3, text: 'b', flavorTags: ['Ciliegia'] });
    await post({ rating: 3, text: 'c' });
    const other = await signup('other@notes.com');
    await env.DB.prepare('insert into cellar_members (cellar_id, user_id, role) values (?, ?, ?)').bind(cellarId, other.userId, 'member').run();
    await post({ rating: 3, text: 'd', flavorTags: ['Rosa'] }, { ...other.auth, 'content-type': 'application/json' });

    const res = await app.request('/api/me/palate', { headers: ownerAuth }, env);
    expect(await res.json()).toEqual({ notes: 2, tags: { Ciliegia: 2, Rosa: 1 } });
  });
});

describe('my rating', () => {
  it('sets, changes and clears my score through my latest note', async () => {
    const auth = { 'X-Calice-Dev-Email': 'voto@b.com' };
    const cellars = await (await app.request('/api/cellars', { headers: auth }, env)).json<any[]>();
    const wine = await env.DB.prepare(`insert into wines (name, producer, country, type, source) values ('Campofiorin', 'Masi', 'Italia', 'rosso', 'catalog') returning id`).first<{ id: number }>();
    const bottle = await (await app.request(`/api/cellars/${cellars[0].id}/bottles`, { method: 'POST', body: JSON.stringify({ wineId: wine!.id, quantity: 2 }), headers: { ...auth, 'content-type': 'application/json' } }, env)).json<{ id: number }>();
    const put = (rating: unknown) => app.request(`/api/bottles/${bottle.id}/my-rating`, { method: 'PUT', body: JSON.stringify({ rating }), headers: { ...auth, 'content-type': 'application/json' } }, env);
    const mine = async () => (await (await app.request(`/api/cellars/${cellars[0].id}/bottles`, { headers: auth }, env)).json<any[]>())[0].my_rating;

    expect((await put(4.5)).status).toBe(200);
    expect(await mine()).toBe(4.5);
    await put(3.75);
    expect(await mine()).toBe(3.8);
    expect((await put(7)).status).toBe(400);
    await put(null);
    expect(await mine()).toBeNull();
    const { n } = (await env.DB.prepare('select count(*) as n from tasting_notes where bottle_id = ?').bind(bottle.id).first<{ n: number }>())!;
    expect(n).toBe(0);
  });
});

