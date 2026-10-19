import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../src/index';

function signup(email: string) {
  return { 'X-Calice-Dev-Email': email };
}

beforeEach(async () => {
  await env.DB.exec(
    'DELETE FROM bottle_places; DELETE FROM bottles; DELETE FROM cellar_elements; DELETE FROM wines; DELETE FROM cellar_members; DELETE FROM cellars; DELETE FROM users;',
  );
});

describe('cellars', () => {
  it('signup creates one cellar, listed for that user', async () => {
    const auth = signup('one@b.com');
    const res = await app.request('/api/cellars', { headers: auth }, env);
    const body = await res.json<any[]>();
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe('Casa');
  });

  it('one cellar per user: there is no way to create a second one', async () => {
    const auth = signup('two@b.com');
    const res = await app.request(
      '/api/cellars',
      { method: 'POST', body: JSON.stringify({ name: 'Cantina in campagna' }), headers: { ...auth, 'content-type': 'application/json' } },
      env,
    );
    expect(res.status).toBe(404);
    expect(await (await app.request('/api/cellars', { headers: auth }, env)).json<any[]>()).toHaveLength(1);
  });

  it('deleting the cellar empties it and leaves a new empty one', async () => {
    const auth = signup('del@b.com');
    const [cellar] = await (await app.request('/api/cellars', { headers: auth }, env)).json<any[]>();
    const user = await env.DB.prepare('select id from users where email = ?').bind('del@b.com').first<{ id: number }>();
    const wine = await env.DB.prepare(`insert into wines (name, producer, country, type, source, created_by) values ('Barolo', 'Altare', 'Italia', 'rosso', 'custom', ?) returning id`).bind(user!.id).first<{ id: number }>();
    await env.DB.prepare('insert into bottles (cellar_id, wine_id, quantity, added_by) values (?, ?, 2, ?)').bind(cellar.id, wine!.id, user!.id).run();
    await env.DB.prepare(`insert into cellar_elements (cellar_id, kind, name) values (?, 'Cella', 'Cucina')`).bind(cellar.id).run();

    const other = signup('other@b.com');
    expect((await app.request(`/api/cellars/${cellar.id}`, { method: 'DELETE', headers: other }, env)).status).toBe(403);

    const res = await app.request(`/api/cellars/${cellar.id}`, { method: 'DELETE', headers: auth }, env);
    expect(res.status).toBe(200);
    const fresh = await res.json<any>();
    expect(fresh.id).not.toBe(cellar.id);
    expect(await (await app.request('/api/cellars', { headers: auth }, env)).json<any[]>()).toEqual([fresh]);
    expect((await env.DB.prepare('select count(*) as n from bottles where cellar_id = ?').bind(cellar.id).first<any>()).n).toBe(0);
    expect((await env.DB.prepare('select count(*) as n from cellar_elements where cellar_id = ?').bind(cellar.id).first<any>()).n).toBe(0);
    expect((await env.PHOTOS.list({ prefix: `restore-safety/${user!.id}/` })).objects).toHaveLength(1);
    // The wine stays in the shared catalogue, no longer tied to the user.
    expect(await env.DB.prepare('select name, created_by from wines where id = ?').bind(wine!.id).first()).toEqual({ name: 'Barolo', created_by: null });
  });

  it('renames a cellar via PATCH', async () => {
    const auth = signup('renamer@b.com');
    const cellars = await (await app.request('/api/cellars', { headers: auth }, env)).json<any[]>();
    const cellarId = cellars[0].id;
    const res = await app.request(
      `/api/cellars/${cellarId}`,
      { method: 'PATCH', body: JSON.stringify({ name: 'Cantina in campagna' }), headers: { ...auth, 'content-type': 'application/json' } },
      env,
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ name: string }>();
    expect(body.name).toBe('Cantina in campagna');
  });

  it('rejects a rename from a non-member with 403', async () => {
    const authA = signup('owner3@b.com');
    const cellarId = (await (await app.request('/api/cellars', { headers: authA }, env)).json<any[]>())[0].id;
    const authB = signup('stranger2@b.com');
    const res = await app.request(
      `/api/cellars/${cellarId}`,
      { method: 'PATCH', body: JSON.stringify({ name: 'Rubata' }), headers: { ...authB, 'content-type': 'application/json' } },
      env,
    );
    expect(res.status).toBe(403);
  });
});
