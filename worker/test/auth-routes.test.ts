import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../src/index';

beforeEach(async () => {
  await env.DB.exec('DELETE FROM cellar_members; DELETE FROM cellars; DELETE FROM users;');
});

describe('POST /api/auth/signup', () => {
  it('creates a user, a default cellar, and sets a session cookie', async () => {
    const res = await app.request(
      '/api/auth/signup',
      { method: 'POST', body: JSON.stringify({ email: 'a@b.com', password: 'secret123', name: 'Fabio' }), headers: { 'content-type': 'application/json' } },
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/^session=/);
    const cellars = await env.DB.prepare('select count(*) as n from cellars').first<{ n: number }>();
    expect(cellars!.n).toBe(1);
  });

  it('rejects a duplicate email with 409', async () => {
    const body = JSON.stringify({ email: 'dup@b.com', password: 'secret123', name: 'Fabio' });
    await app.request('/api/auth/signup', { method: 'POST', body, headers: { 'content-type': 'application/json' } }, env);
    const res = await app.request('/api/auth/signup', { method: 'POST', body, headers: { 'content-type': 'application/json' } }, env);
    expect(res.status).toBe(409);
  });
});

describe('POST /api/auth/login', () => {
  it('rejects a wrong password with 401', async () => {
    const body = JSON.stringify({ email: 'a@b.com', password: 'secret123', name: 'Fabio' });
    await app.request('/api/auth/signup', { method: 'POST', body, headers: { 'content-type': 'application/json' } }, env);
    const res = await app.request(
      '/api/auth/login',
      { method: 'POST', body: JSON.stringify({ email: 'a@b.com', password: 'wrong' }), headers: { 'content-type': 'application/json' } },
      env,
    );
    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/me', () => {
  it('returns 401 without a cookie', async () => {
    const res = await app.request('/api/auth/me', {}, env);
    expect(res.status).toBe(401);
  });

  it('returns the user with a valid cookie', async () => {
    const signup = await app.request(
      '/api/auth/signup',
      { method: 'POST', body: JSON.stringify({ email: 'me@b.com', password: 'secret123', name: 'Fabio' }), headers: { 'content-type': 'application/json' } },
      env,
    );
    const cookie = signup.headers.get('set-cookie')!.split(';')[0];
    const res = await app.request('/api/auth/me', { headers: { cookie } }, env);
    expect(res.status).toBe(200);
    const body = await res.json<{ email: string }>();
    expect(body.email).toBe('me@b.com');
  });
});
