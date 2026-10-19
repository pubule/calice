import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../src/index';

function signup(email: string) {
  return { 'X-Calice-Dev-Email': email };
}

beforeEach(async () => {
  await env.DB.exec(
    'DELETE FROM cellar_members; DELETE FROM cellars; DELETE FROM users;',
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

  it('a second user creates their own cellar via POST', async () => {
    const auth = signup('two@b.com');
    const res = await app.request(
      '/api/cellars',
      { method: 'POST', body: JSON.stringify({ name: 'Cantina in campagna' }), headers: { ...auth, 'content-type': 'application/json' } },
      env,
    );
    expect(res.status).toBe(200);
    const list = await (await app.request('/api/cellars', { headers: auth }, env)).json<any[]>();
    expect(list.map((c: any) => c.name).sort()).toEqual(['Cantina in campagna', 'Casa']);
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
