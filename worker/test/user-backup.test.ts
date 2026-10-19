import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../src/index';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function auth(email: string) {
  return { 'X-Calice-Dev-Email': email };
}
const json = (h: Record<string, string>) => ({ ...h, 'content-type': 'application/json' });

async function setup(email: string) {
  const h = auth(email);
  const me = await (await app.request('/api/auth/me', { headers: h }, env)).json<{ id: number }>();
  const cellarId = (await (await app.request('/api/cellars', { headers: h }, env)).json<any[]>())[0].id;
  const wine = await env.DB.prepare(`insert into wines (name, producer, country, type, vintage, image_url, source, owner_id)
    values ('Barolo', 'Altare', 'Italia', 'rosso', 2020, '/api/wine-images/' || ?, 'custom', ?) returning id`).bind(encodeURIComponent('wines/x/foto'), me.id).first<{ id: number }>();
  await env.PHOTOS.put('wines/x/foto', PNG);
  const element = await env.DB.prepare(`insert into cellar_elements (cellar_id, kind, name, tiers, cols, depth) values (?, 'Cella', 'Cella cucina', 2, 3, 1) returning id`).bind(cellarId).first<{ id: number }>();
  const bottle = await env.DB.prepare(`insert into bottles (cellar_id, wine_id, quantity, price_paid, added_by, disgorged_at) values (?, ?, 2, 50, ?, null) returning id`).bind(cellarId, wine!.id, me.id).first<{ id: number }>();
  await env.DB.prepare('insert into bottle_places (bottle_id, element_id, slot_tier, slot_col, slot_depth) values (?, ?, 1, 0, 1)').bind(bottle!.id, element!.id).run();
  await env.DB.prepare(`insert into tasting_notes (bottle_id, user_id, rating, text, flavor_tags) values (?, ?, 4.5, 'Elegante', '["Rosa"]')`).bind(bottle!.id, me.id).run();
  await env.DB.prepare(`insert into tastings (user_id, style, rating, text) values (?, 'rosso', 4, 'Al ristorante')`).bind(me.id).run();
  return { h, me, cellarId, wineId: wine!.id, bottleId: bottle!.id };
}

beforeEach(async () => {
  await env.DB.exec(
    'DELETE FROM bottle_places; DELETE FROM photos; DELETE FROM tasting_notes; DELETE FROM tastings; DELETE FROM wishlist_items; DELETE FROM bottles; DELETE FROM cellar_elements; DELETE FROM wines; DELETE FROM cellar_members; DELETE FROM cellars; DELETE FROM users;',
  );
  for (const o of (await env.PHOTOS.list()).objects) await env.PHOTOS.delete(o.key);
});

describe('user backup', () => {
  it('downloads everything about my cellars and lists the photos to add', async () => {
    const { h } = await setup('b1@b.com');
    const backup = await (await app.request('/api/backup', { headers: h }, env)).json<any>();
    expect(backup.format).toBe('calice-user-backup');
    expect(backup.bottles).toHaveLength(1);
    expect(backup.bottle_places).toHaveLength(1);
    expect(backup.tasting_notes[0].text).toBe('Elegante');
    expect(backup.tastings).toHaveLength(1);
    expect(backup.wines[0].search_text).toBeUndefined();
    expect(backup.files).toEqual([{ key: 'wines/x/foto', url: `/api/wine-images/${encodeURIComponent('wines/x/foto')}` }]);
  });

  it('puts my cellar back exactly as in the file, keeping a copy of before', async () => {
    const { h, me, cellarId, wineId, bottleId } = await setup('b2@b.com');
    const backup = await (await app.request('/api/backup', { headers: h }, env)).json<any>();

    // Afterwards: a bottle drunk, a price changed, a new wine, the photo gone.
    await env.DB.prepare('delete from bottle_places').run();
    await env.DB.prepare('delete from tasting_notes').run();
    await env.DB.prepare('delete from bottles where id = ?').bind(bottleId).run();
    await env.DB.prepare(`update wines set vintage = 2021 where id = ?`).bind(wineId).run();
    const other = await env.DB.prepare(`insert into wines (name, producer, country, type, source) values ('Soave', 'Pieropan', 'Italia', 'bianco', 'custom') returning id`).first<{ id: number }>();
    await env.DB.prepare('insert into bottles (cellar_id, wine_id, quantity, added_by) values (?, ?, 1, ?)').bind(cellarId, other!.id, me.id).run();
    await env.PHOTOS.delete('wines/x/foto');

    const res = await app.request('/api/backup/restore', { method: 'POST', body: JSON.stringify(backup), headers: json(h) }, env);
    expect(res.status).toBe(200);
    const result = await res.json<any>();
    expect(result.missingFiles).toEqual(['wines/x/foto']);

    const bottles = await env.DB.prepare('select bottles.*, wines.vintage from bottles join wines on wines.id = bottles.wine_id where cellar_id = ?').bind(cellarId).all<any>();
    expect(bottles.results).toHaveLength(1);
    expect(bottles.results[0]).toMatchObject({ wine_id: wineId, quantity: 2, price_paid: 50, vintage: 2020 });
    const places = await env.DB.prepare('select * from bottle_places where bottle_id = ?').bind(bottles.results[0].id).all<any>();
    expect(places.results).toHaveLength(1);
    const elements = await env.DB.prepare('select id from cellar_elements where cellar_id = ?').bind(cellarId).all<any>();
    expect(places.results[0].element_id).toBe(elements.results[0].id);
    expect((await env.DB.prepare('select text from tasting_notes').first<any>()).text).toBe('Elegante');
    expect((await env.DB.prepare('select count(*) as n from tastings').first<any>()).n).toBe(1);

    const safety = (await env.PHOTOS.list({ prefix: `restore-safety/${me.id}/` })).objects;
    expect(safety).toHaveLength(1);
    const before = await (await env.PHOTOS.get(safety[0].key))!.json<any>();
    expect(before.wines.map((w: any) => w.name)).toContain('Soave');

    // The lost photo goes back, once, and only an image.
    const url = `/api/backup/files/${encodeURIComponent('wines/x/foto')}`;
    expect((await app.request(url, { method: 'PUT', body: 'ciao', headers: h }, env)).status).toBe(400);
    expect((await app.request(url, { method: 'PUT', body: PNG, headers: h }, env)).status).toBe(200);
    expect(await env.PHOTOS.head('wines/x/foto')).not.toBeNull();
  });

  it('never touches cellars of other people, nor takes photos that are not mine', async () => {
    const alice = await setup('alice@b.com');
    const backup = await (await app.request('/api/backup', { headers: alice.h }, env)).json<any>();
    const bob = auth('bob@b.com');
    await app.request('/api/auth/me', { headers: bob }, env);

    await app.request('/api/backup/restore', { method: 'POST', body: JSON.stringify(backup), headers: json(bob) }, env);
    // Alice's cellar is untouched; Bob's one cellar got his own copy.
    expect((await env.DB.prepare('select count(*) as n from bottles where cellar_id = ?').bind(alice.cellarId).first<any>()).n).toBe(1);
    const bobCellars = await (await app.request('/api/cellars', { headers: bob }, env)).json<any[]>();
    expect(bobCellars.length).toBe(1);
    expect((await env.DB.prepare('select count(*) as n from bottles where cellar_id = ?').bind(bobCellars[0].id).first<any>()).n).toBe(1);

    const mallory = auth('mallory@b.com');
    await app.request('/api/auth/me', { headers: mallory }, env);
    const res = await app.request(`/api/backup/files/${encodeURIComponent('wines/y/altro')}`, { method: 'PUT', body: PNG, headers: mallory }, env);
    expect(res.status).toBe(404);
  });

  it('refuses a file that is not a backup', async () => {
    const h = auth('b4@b.com');
    const res = await app.request('/api/backup/restore', { method: 'POST', body: JSON.stringify({ format: 'altro' }), headers: json(h) }, env);
    expect(res.status).toBe(400);
  });

  it('remembers when the backup was saved', async () => {
    const h = auth('b5@b.com');
    await app.request('/api/backup/saved', { method: 'POST', headers: h }, env);
    await env.PHOTOS.put('backups/2026-10-12.json', '{}');
    await env.PHOTOS.put('backups/2026-10-19.json', '{}');
    const status = await (await app.request('/api/backup/status', { headers: h }, env)).json<any>();
    expect(status.automatic).toBe('2026-10-19');
    expect(new Date(status.automaticAt).toISOString()).toBe(status.automaticAt);
    expect(status.saved).toBeTruthy();
  });
});

// VAPT 2026-10-19: a backup file is the caller's own input, so it must never
// reach rows or files of other users.
describe('a crafted backup file', () => {
  async function attackerFile(h: Record<string, string>, extra: { wines?: any[]; photos?: any[] }) {
    const file = await (await app.request('/api/backup', { headers: h }, env)).json<any>();
    const bottle = file.bottles[0];
    return {
      ...file,
      wines: [...file.wines, ...(extra.wines ?? [])],
      photos: [...file.photos, ...(extra.photos ?? []).map((p, i) => ({ id: 9000 + i, bottle_id: bottle.id, uploaded_by: file.users[0].id, created_at: '2026-10-19 10:00:00', ...p }))],
    };
  }
  const restore = (h: Record<string, string>, body: unknown) =>
    app.request('/api/backup/restore', { method: 'POST', body: JSON.stringify(body), headers: json(h) }, env);

  it('cannot read or delete an R2 object that is not a bottle photo (the database backups)', async () => {
    const { h } = await setup('attacker@b.com');
    await env.PHOTOS.put('backups/2026-10-19.json', '{"users":[{"email":"victim@b.com"}]}');
    const file = await attackerFile(h, { photos: [{ r2_key: 'backups/2026-10-19.json' }, { r2_key: 'restore-safety/1/x.json' }] });
    expect((await restore(h, file)).status).toBe(200);
    const read = await app.request('/api/photos/' + encodeURIComponent('backups/2026-10-19.json'), { headers: h }, env);
    expect(read.status).toBe(404);
    await read.arrayBuffer();
    const bottles = await (await app.request(`/api/cellars/${(await (await app.request('/api/cellars', { headers: h }, env)).json<any[]>())[0].id}/bottles`, { headers: h }, env)).json<any[]>();
    for (const b of bottles) await app.request(`/api/bottles/${b.id}`, { method: 'DELETE', headers: h }, env);
    expect(await env.PHOTOS.head('backups/2026-10-19.json')).not.toBeNull();
  });

  it("cannot take over the photo of another user's bottle", async () => {
    const victim = await setup('victim@b.com');
    await env.PHOTOS.put(`bottles/${victim.bottleId}/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`, PNG);
    await env.DB.prepare('insert into photos (bottle_id, r2_key, uploaded_by) values (?, ?, ?)').bind(victim.bottleId, `bottles/${victim.bottleId}/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`, victim.me.id).run();
    const { h } = await setup('attacker2@b.com');
    const file = await attackerFile(h, { photos: [{ r2_key: `bottles/${victim.bottleId}/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa` }] });
    expect((await restore(h, file)).status).toBe(200);
    const read = await app.request('/api/photos/' + encodeURIComponent(`bottles/${victim.bottleId}/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`), { headers: h }, env);
    expect(read.status).toBe(404);
    await read.arrayBuffer();
    // Deleting the attacker's own bottles leaves the victim's photo file alone.
    const cellar = (await (await app.request('/api/cellars', { headers: h }, env)).json<any[]>())[0].id;
    for (const b of await (await app.request(`/api/cellars/${cellar}/bottles`, { headers: h }, env)).json<any[]>()) {
      await app.request(`/api/bottles/${b.id}`, { method: 'DELETE', headers: h }, env);
    }
    expect(await env.PHOTOS.head(`bottles/${victim.bottleId}/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`)).not.toBeNull();
  });

  it('cannot rewrite a catalog wine that another user has in the cellar', async () => {
    const victim = await setup('victim2@b.com');
    const { h } = await setup('attacker3@b.com');
    const w = await env.DB.prepare('select * from wines where id = ?').bind(victim.wineId).first<any>();
    const { search_text: _, ...row } = w;
    const file = await attackerFile(h, { wines: [{ ...row, denomination: 'Falso', producer_url: 'javascript:alert(1)', image_url: '/api/wine-images/' + encodeURIComponent('backups/2026-10-19.json') }] });
    expect((await restore(h, file)).status).toBe(200);
    const after = await env.DB.prepare('select denomination, producer_url, image_url from wines where id = ?').bind(victim.wineId).first<any>();
    expect(after).toEqual({ denomination: w.denomination, producer_url: w.producer_url, image_url: w.image_url });
  });

  it('keeps only safe links in the wines it brings back', async () => {
    const { h } = await setup('attacker4@b.com');
    const file = await attackerFile(h, { wines: [{ id: 99999, name: 'Nuovo', producer: 'X', country: 'Italia', type: 'rosso', source: 'custom',
      producer_url: 'javascript:alert(1)', image_url: '/api/wine-images/' + encodeURIComponent('backups/2026-10-19.json') }] });
    expect((await restore(h, file)).status).toBe(200);
    const w = await env.DB.prepare(`select producer_url, image_url from wines where name = 'Nuovo'`).first<any>();
    expect(w).toEqual({ producer_url: null, image_url: null });
  });
});


describe('a crafted backup file and other users', () => {
  it('brings back only the caller\'s own notes, never notes signed by someone else', async () => {
    const victim = await setup('victim3@b.com');
    const { h } = await setup('attacker5@b.com');
    const file = await (await app.request('/api/backup', { headers: h }, env)).json<any>();
    file.users.push({ id: 777, email: 'victim3@b.com', name: 'victim3' });
    file.tasting_notes.push({ ...file.tasting_notes[0], id: 778, user_id: 777, flavor_tags: '["Zolfo"]' });
    expect((await app.request('/api/backup/restore', { method: 'POST', body: JSON.stringify(file), headers: json(h) }, env)).status).toBe(200);
    const signed = await env.DB.prepare(`select count(*) as n from tasting_notes where user_id = ? and flavor_tags like '%Zolfo%'`).bind(victim.me.id).first<{ n: number }>();
    expect(signed!.n).toBe(0);
  });
});
