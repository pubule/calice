import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../src/index';

const me = { 'X-Calice-Dev-Email': 'taster@t.com' };
const json = { ...me, 'content-type': 'application/json' };
const post = (body: object, headers: Record<string, string> = json) =>
  app.request('/api/tastings', { method: 'POST', body: JSON.stringify(body), headers }, env);

beforeEach(async () => {
  await env.DB.exec('DELETE FROM tastings; DELETE FROM tasting_notes; DELETE FROM users;');
});

describe('guided tastings', () => {
  it('saves a tasting of a wine that is in no cellar and lists only the author’s own', async () => {
    const res = await post({ style: 'Barolo', label: ' Cannubi 2019 ', rating: 4, text: 'Elegante', flavorTags: ['Rosa', 'Catrame'], tasteTannin: 70 });
    expect(res.status).toBe(200);
    const saved = await res.json<any>();
    expect(saved).toMatchObject({ style: 'Barolo', label: 'Cannubi 2019', rating: 4, flavor_tags: ['Rosa', 'Catrame'], taste_tannin: 70, taste_acidity: null });

    await post({ style: 'Chablis', rating: 3, text: '' }, { 'X-Calice-Dev-Email': 'other@t.com', 'content-type': 'application/json' });
    const list = await (await app.request('/api/tastings', { headers: me }, env)).json<any[]>();
    expect(list.map((t) => t.style)).toEqual(['Barolo']);
  });

  it('feeds Il mio palato alongside bottle notes', async () => {
    await post({ style: 'Barolo', rating: 4, text: '', flavorTags: ['Rosa'] });
    const palate = await (await app.request('/api/me/palate', { headers: me }, env)).json();
    expect(palate).toEqual({ notes: 1, tags: { Rosa: 1 } });
  });

  it('rejects a missing style or a bad rating, and deletes only the author’s own', async () => {
    expect((await post({ rating: 4, text: '' })).status).toBe(400);
    expect((await post({ style: 'Barolo', rating: 9, text: '' })).status).toBe(400);
    const { id } = await (await post({ style: 'Barolo', rating: 4, text: '' })).json<{ id: number }>();
    const other = { 'X-Calice-Dev-Email': 'other@t.com' };
    expect((await app.request(`/api/tastings/${id}`, { method: 'DELETE', headers: other }, env)).status).toBe(404);
    expect((await app.request(`/api/tastings/${id}`, { method: 'DELETE', headers: me }, env)).status).toBe(200);
  });
});
