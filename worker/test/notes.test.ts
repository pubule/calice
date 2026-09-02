import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../src/index';

async function signup(email: string) {
  const res = await app.request(
    '/api/auth/signup',
    { method: 'POST', body: JSON.stringify({ email, password: 'secret123', name: email }), headers: { 'content-type': 'application/json' } },
    env,
  );
  const cookie = res.headers.get('set-cookie')!.split(';')[0];
  const me = await (await app.request('/api/auth/me', { headers: { cookie } }, env)).json<{ id: number }>();
  return { cookie, userId: me.id };
}

let bottleId: number;
let cellarId: number;
let ownerCookie: string;

beforeEach(async () => {
  await env.DB.exec(
    'DELETE FROM tasting_notes; DELETE FROM follows; DELETE FROM bottles; DELETE FROM wines; DELETE FROM cellar_members; DELETE FROM cellars; DELETE FROM users;',
  );
  const owner = await signup('owner@notes.com');
  ownerCookie = owner.cookie;
  cellarId = (await (await app.request('/api/cellars', { headers: { cookie: owner.cookie } }, env)).json<any[]>())[0].id;
  const wine = await env.DB.prepare(`insert into wines (name, producer, country, type, source) values ('Barolo DOCG', 'Elio Altare', 'Italia', 'rosso', 'catalog') returning id`).first<{ id: number }>();
  const bottle = await app.request(
    `/api/cellars/${cellarId}/bottles`,
    { method: 'POST', body: JSON.stringify({ wineId: wine!.id, quantity: 1 }), headers: { cookie: owner.cookie, 'content-type': 'application/json' } },
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
      { method: 'POST', body: JSON.stringify({ rating: 4.5, text: 'Ottimo con brasato' }), headers: { cookie: author.cookie, 'content-type': 'application/json' } },
      env,
    );

    // author sees own note
    const authorView = await (await app.request(`/api/bottles/${bottleId}/notes`, { headers: { cookie: author.cookie } }, env)).json<any[]>();
    expect(authorView).toHaveLength(1);

    // follower sees it
    const follower = await signup('follower@notes.com');
    await env.DB.prepare('insert into follows (follower_id, followee_id) values (?, ?)').bind(follower.userId, author.userId).run();
    const followerView = await (await app.request(`/api/bottles/${bottleId}/notes`, { headers: { cookie: follower.cookie } }, env)).json<any[]>();
    expect(followerView).toHaveLength(1);

    // cellar-mate sees it (author is already a cellar member)
    const cellarMate = await signup('mate@notes.com');
    await env.DB.prepare('insert into cellar_members (cellar_id, user_id, role) values (?, ?, ?)').bind(cellarId, cellarMate.userId, 'member').run();
    const mateView = await (await app.request(`/api/bottles/${bottleId}/notes`, { headers: { cookie: cellarMate.cookie } }, env)).json<any[]>();
    expect(mateView).toHaveLength(1);

    // a stranger with no relationship sees nothing
    const stranger = await signup('stranger@notes.com');
    const strangerView = await (await app.request(`/api/bottles/${bottleId}/notes`, { headers: { cookie: stranger.cookie } }, env)).json<any[]>();
    expect(strangerView).toHaveLength(0);
  });

  it('rejects a note write from a caller who is not a member of the bottle\'s cellar', async () => {
    const outsider = await signup('outsider@notes.com');
    const res = await app.request(
      `/api/bottles/${bottleId}/notes`,
      { method: 'POST', body: JSON.stringify({ rating: 5, text: 'not my cellar' }), headers: { cookie: outsider.cookie, 'content-type': 'application/json' } },
      env,
    );
    expect(res.status).toBe(404);
    const notes = await env.DB.prepare('select count(*) as n from tasting_notes where bottle_id = ?').bind(bottleId).first<{ n: number }>();
    expect(notes!.n).toBe(0);
  });

  it('rejects a rating outside 0-5 with 400', async () => {
    const res = await app.request(
      `/api/bottles/${bottleId}/notes`,
      { method: 'POST', body: JSON.stringify({ rating: 7, text: 'troppo entusiasta' }), headers: { cookie: ownerCookie, 'content-type': 'application/json' } },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('rejects an empty text with 400', async () => {
    const res = await app.request(
      `/api/bottles/${bottleId}/notes`,
      { method: 'POST', body: JSON.stringify({ rating: 4, text: '' }), headers: { cookie: ownerCookie, 'content-type': 'application/json' } },
      env,
    );
    expect(res.status).toBe(400);
  });
});
