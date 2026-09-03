import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../src/index';

function signup(email: string) {
  return { 'X-Calice-Dev-Email': email };
}

beforeEach(async () => {
  await env.DB.exec(
    'DELETE FROM cellar_invites; DELETE FROM cellar_members; DELETE FROM cellars; DELETE FROM users;',
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

  it('invite + accept adds the second user as a member', async () => {
    const authA = signup('owner@b.com');
    const cellars = await (await app.request('/api/cellars', { headers: authA }, env)).json<any[]>();
    const cellarId = cellars[0].id;

    const inviteRes = await app.request(`/api/cellars/${cellarId}/invite`, { method: 'POST', headers: authA }, env);
    const { code } = await inviteRes.json<{ code: string }>();

    const authB = signup('friend@b.com');
    const acceptRes = await app.request(`/api/invites/${code}/accept`, { method: 'POST', headers: authB }, env);
    expect(acceptRes.status).toBe(200);

    const listB = await (await app.request('/api/cellars', { headers: authB }, env)).json<any[]>();
    expect(listB.some((c: any) => c.id === cellarId)).toBe(true);
  });

  it('accepting a bad code returns 404', async () => {
    const auth = signup('lonely@b.com');
    const res = await app.request('/api/invites/does-not-exist/accept', { method: 'POST', headers: auth }, env);
    expect(res.status).toBe(404);
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
