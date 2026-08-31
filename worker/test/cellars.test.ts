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
  await env.DB.exec(
    'DELETE FROM cellar_invites; DELETE FROM cellar_members; DELETE FROM cellars; DELETE FROM users;',
  );
});

describe('cellars', () => {
  it('signup creates one cellar, listed for that user', async () => {
    const cookie = await signup('one@b.com');
    const res = await app.request('/api/cellars', { headers: { cookie } }, env);
    const body = await res.json<any[]>();
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe('Casa');
  });

  it('a second user creates their own cellar via POST', async () => {
    const cookie = await signup('two@b.com');
    const res = await app.request(
      '/api/cellars',
      { method: 'POST', body: JSON.stringify({ name: 'Cantina in campagna' }), headers: { cookie, 'content-type': 'application/json' } },
      env,
    );
    expect(res.status).toBe(200);
    const list = await (await app.request('/api/cellars', { headers: { cookie } }, env)).json<any[]>();
    expect(list.map((c: any) => c.name).sort()).toEqual(['Cantina in campagna', 'Casa']);
  });

  it('invite + accept adds the second user as a member', async () => {
    const cookieA = await signup('owner@b.com');
    const cellars = await (await app.request('/api/cellars', { headers: { cookie: cookieA } }, env)).json<any[]>();
    const cellarId = cellars[0].id;

    const inviteRes = await app.request(`/api/cellars/${cellarId}/invite`, { method: 'POST', headers: { cookie: cookieA } }, env);
    const { code } = await inviteRes.json<{ code: string }>();

    const cookieB = await signup('friend@b.com');
    const acceptRes = await app.request(`/api/invites/${code}/accept`, { method: 'POST', headers: { cookie: cookieB } }, env);
    expect(acceptRes.status).toBe(200);

    const listB = await (await app.request('/api/cellars', { headers: { cookie: cookieB } }, env)).json<any[]>();
    expect(listB.some((c: any) => c.id === cellarId)).toBe(true);
  });

  it('accepting a bad code returns 404', async () => {
    const cookie = await signup('lonely@b.com');
    const res = await app.request('/api/invites/does-not-exist/accept', { method: 'POST', headers: { cookie } }, env);
    expect(res.status).toBe(404);
  });
});
