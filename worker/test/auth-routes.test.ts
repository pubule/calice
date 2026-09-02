import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../src/index';

beforeEach(async () => {
  await env.DB.exec('DELETE FROM cellar_members; DELETE FROM cellars; DELETE FROM users;');
});

describe('GET /api/auth/me', () => {
  it('returns 401 with no Access identity', async () => {
    const noDevEmail = { ...env, CALICE_DEV_EMAIL: undefined };
    const res = await app.request('/api/auth/me', {}, noDevEmail);
    expect(res.status).toBe(401);
  });

  it('creates a user and a default cellar on first authenticated request', async () => {
    const headers = { 'X-Calice-Dev-Email': 'me@b.com' };
    const res = await app.request('/api/auth/me', { headers }, env);
    expect(res.status).toBe(200);
    const body = await res.json<{ email: string; name: string }>();
    expect(body.email).toBe('me@b.com');
    expect(body.name).toBe('me');

    const cellars = await env.DB.prepare('select count(*) as n from cellars').first<{ n: number }>();
    expect(cellars!.n).toBe(1);
  });

  it('reuses the same user across requests instead of creating a duplicate', async () => {
    const headers = { 'X-Calice-Dev-Email': 'again@b.com' };
    const first = await (await app.request('/api/auth/me', { headers }, env)).json<{ id: number }>();
    const second = await (await app.request('/api/auth/me', { headers }, env)).json<{ id: number }>();
    expect(second.id).toBe(first.id);

    const users = await env.DB.prepare('select count(*) as n from users where email = ?').bind('again@b.com').first<{ n: number }>();
    expect(users!.n).toBe(1);
  });
});
