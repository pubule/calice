import { Hono } from 'hono';
import { requireAuth } from '../lib/session';
import { detectImageType } from './photos';
import { BACKUP_PREFIX } from '../lib/backup';
import { ensureCellar } from '../lib/cellars';
import type { Env } from '../index';

// "Scarica backup" / "Ripristina da backup" in Profilo: everything about the
// caller's cellars (wines, bottles, places, elements, every note, wishlist,
// photos) plus their own tastings, as one file the user keeps. The photos'
// bytes are added by the client (it downloads `files`), so this JSON stays
// small; on restore the client re-uploads only the photos R2 no longer has.
// Restore replaces (choice R1): the user's one cellar goes back exactly as
// in the file. It never deletes anything from R2, and it first saves the current
// state under restore-safety/<userId>/, so a restore can itself be undone.

const FORMAT = 'calice-user-backup';
const WINE_IMAGE = '/api/wine-images/';
const SAFETY_PREFIX = 'restore-safety/';
const SAFETY_KEEP = 5;
const MAX_FILE_BYTES = 5_000_000;
const COLUMN = /^[a-z_][a-z0-9_]*$/;

type Row = Record<string, unknown>;
const TABLES = ['cellars', 'cellar_elements', 'bottles', 'bottle_places', 'tasting_notes', 'photos', 'wishlist_items', 'wines', 'tastings', 'users'] as const;
type Table = (typeof TABLES)[number];
export type UserBackup = {
  format: typeof FORMAT;
  version: 1;
  createdAt: string;
  user: { email: string; name: string };
  files: { key: string; url: string }[];
} & Record<Table, Row[]>;

const MINE = 'select cellar_id from cellar_members where user_id = ?1';
const MY_BOTTLES = `select id from bottles where cellar_id in (${MINE})`;

export async function buildUserBackup(db: D1Database, userId: number): Promise<UserBackup> {
  const q = (sql: string) => db.prepare(sql).bind(userId);
  const results = await db.batch<Row>([
    q(`select * from cellars where id in (${MINE}) order by id`),
    q(`select * from cellar_elements where cellar_id in (${MINE}) order by id`),
    q(`select * from bottles where cellar_id in (${MINE}) order by id`),
    q(`select * from bottle_places where bottle_id in (${MY_BOTTLES}) order by id`),
    q(`select * from tasting_notes where bottle_id in (${MY_BOTTLES}) order by id`),
    q(`select * from photos where bottle_id in (${MY_BOTTLES}) order by id`),
    q(`select * from wishlist_items where cellar_id in (${MINE}) order by id`),
    q(`select * from wines where id in (select wine_id from bottles where cellar_id in (${MINE})
                                      union select wine_id from wishlist_items where cellar_id in (${MINE})) order by id`),
    q('select * from tastings where user_id = ?1 order by id'),
  ]);
  const t = Object.fromEntries(TABLES.filter((n) => n !== 'users').map((name, i) => [name, results[i].results])) as Record<Table, Row[]>;
  // Everyone the rows point at, to match them by email on restore.
  const people = new Set<unknown>([userId, ...t.tasting_notes.map((r) => r.user_id), ...t.bottles.map((r) => r.added_by),
    ...t.wishlist_items.map((r) => r.added_by), ...t.photos.map((r) => r.uploaded_by), ...t.cellars.map((r) => r.owner_id)]);
  t.users = (await db.prepare('select id, email, name from users where id in (select value from json_each(?))').bind(JSON.stringify([...people])).all<Row>()).results;
  for (const w of t.wines) delete w.search_text; // derived, rebuilt by the search
  const me = t.users.find((u) => u.id === userId)!;
  const files = new Map<string, string>();
  for (const p of t.photos) files.set(String(p.r2_key), `/api/photos/${encodeURIComponent(String(p.r2_key))}`);
  for (const w of t.wines) {
    const url = String(w.image_url ?? '');
    if (url.startsWith(WINE_IMAGE)) files.set(decodeURIComponent(url.slice(WINE_IMAGE.length)), url);
  }
  return {
    format: FORMAT, version: 1, createdAt: new Date().toISOString(),
    user: { email: String(me.email), name: String(me.name) },
    files: [...files].map(([key, url]) => ({ key, url })),
    ...t,
  };
}

// A file from the user: only plain rows of plain values get through.
function readBackup(body: unknown): UserBackup | null {
  const b = body as Partial<UserBackup> | null;
  if (!b || b.format !== FORMAT || b.version !== 1 || typeof b.user?.email !== 'string') return null;
  for (const name of TABLES) {
    const rows = b[name] ?? [];
    if (!Array.isArray(rows)) return null;
    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
      for (const [k, v] of Object.entries(row)) {
        if (!COLUMN.test(k) || !(v === null || typeof v === 'string' || typeof v === 'number')) return null;
      }
    }
    (b as Record<string, unknown>)[name] = rows;
  }
  return b as UserBackup;
}

const ids = (rows: Row[], key = 'id') => JSON.stringify(rows.map((r) => r[key]));
const wineImageKey = (url: unknown) => (typeof url === 'string' && url.startsWith(WINE_IMAGE) ? decodeURIComponent(url.slice(WINE_IMAGE.length)) : null);

// A backup file is the caller's own input: its R2 keys and links are trusted
// only when they have the shape the app itself writes. A photo row pointing
// at "backups/<date>.json" would otherwise let the caller read the whole
// database through /api/photos, or delete any file by deleting the bottle.
export const isBottlePhotoKey = (key: string) => /^bottles\/[^/]+\/[^/]+$/.test(key) && !key.split('/').includes('..');
const isWineImageKey = (key: string) => /^wines\/[^/]+\/[^/]+$/.test(key) && !key.split('/').includes('..');
function safeWineLinks(w: Row): Row {
  const http = (v: unknown) => {
    try {
      return typeof v === 'string' && ['http:', 'https:'].includes(new URL(v).protocol) ? v : null;
    } catch {
      return null;
    }
  };
  const key = (() => { try { return wineImageKey(w.image_url); } catch { return null; } })();
  return { producer_url: http(w.producer_url), image_url: key ? (isWineImageKey(key) ? w.image_url : null) : http(w.image_url) };
}

export async function saveSafetyCopy(env: Env, userId: number) {
  const prefix = `${SAFETY_PREFIX}${userId}/`;
  await env.PHOTOS.put(`${prefix}${new Date().toISOString()}.json`, JSON.stringify(await buildUserBackup(env.DB, userId)), {
    httpMetadata: { contentType: 'application/json' },
  });
  const keys = (await env.PHOTOS.list({ prefix })).objects.map((o) => o.key).sort();
  const old = keys.slice(0, Math.max(0, keys.length - SAFETY_KEEP));
  if (old.length) await env.PHOTOS.delete(old);
}

export async function restoreUserBackup(env: Env, userId: number, b: UserBackup) {
  const db = env.DB;
  const target = await ensureCellar(db, userId);
  const fileKeys = JSON.stringify(b.photos.map((p) => String(p.r2_key)));
  const [meRes, maxRes, winesRes, sharedRes, takenRes] = await db.batch<Row>([
    db.prepare('select email from users where id = ?').bind(userId),
    db.prepare(`select ${['cellars', 'cellar_elements', 'bottles', 'bottle_places', 'tasting_notes', 'photos', 'wishlist_items', 'wines', 'tastings']
      .map((t) => `(select coalesce(max(id), 0) from ${t}) as ${t}`).join(', ')}`),
    db.prepare('select id, name, producer from wines where id in (select value from json_each(?))').bind(ids(b.wines)),
    // Catalog wines someone else has: the file must not rewrite them.
    db.prepare(`select wine_id from bottles where cellar_id != ?1 and wine_id in (select value from json_each(?2))
                union select wine_id from wishlist_items where cellar_id != ?1 and wine_id in (select value from json_each(?2))`).bind(target, ids(b.wines)),
    // Photo files that belong to another cellar's bottles.
    db.prepare(`select r2_key from photos where r2_key in (select value from json_each(?2))
                and bottle_id not in (select id from bottles where cellar_id = ?1)`).bind(target, fileKeys),
  ]);
  const shared = new Set(sharedRes.results.map((r) => Number(r.wine_id)));
  const taken = new Set(takenRes.results.map((r) => String(r.r2_key)));
  const myEmail = String(meRes.results[0].email);
  const max = maxRes.results[0] as Record<string, number>;
  const next = (table: string) => ++max[table];

  // Who is who: the file's owner becomes the caller. Nobody else: a file
  // could otherwise write notes signed by another real user (one cellar per
  // user, so every row of a cellar is its owner's).
  const userMap = new Map<unknown, number>();
  for (const u of b.users) if (String(u.email) === b.user.email || String(u.email) === myEmail) userMap.set(u.id, userId);
  const userOr = (old: unknown, fallback: number | null) => userMap.get(old) ?? fallback;

  const stmts: D1PreparedStatement[] = [];
  const insert = (table: string, row: Row, override: Row, upsert = false) => {
    const data: Row = { ...row, ...override };
    const cols = Object.keys(data).filter((c) => COLUMN.test(c));
    const conflict = upsert ? ` on conflict(id) do update set ${cols.filter((c) => c !== 'id').map((c) => `"${c}" = excluded."${c}"`).join(', ')}` : '';
    stmts.push(db.prepare(`insert into ${table} (${cols.map((c) => `"${c}"`).join(', ')}) values (${cols.map(() => '?').join(', ')})${conflict}`)
      .bind(...cols.map((c) => data[c] ?? null)));
  };

  // One cellar per user: whatever the file holds goes into the caller's
  // cellar, emptied first (an old file with several cellars is merged).
  const cellarMap = new Map<unknown, number>(b.cellars.map((c) => [c.id, target]));
  const replaced = [target];
  if (!cellarMap.size) return { error: 'Nel file non c\'è nessuna cantina.' } as const;

  // Children first (foreign keys), parents last.
  const R = JSON.stringify(replaced);
  const inR = 'select value from json_each(?)';
  const rBottles = `select id from bottles where cellar_id in (${inR})`;
  const sameUser = b.user.email === myEmail;
  stmts.unshift(
    db.prepare(`delete from bottle_places where bottle_id in (${rBottles})`).bind(R),
    db.prepare(`delete from photos where bottle_id in (${rBottles})`).bind(R),
    db.prepare(`delete from tasting_notes where bottle_id in (${rBottles})`).bind(R),
    db.prepare(`delete from bottles where cellar_id in (${inR})`).bind(R),
    db.prepare(`delete from wishlist_items where cellar_id in (${inR})`).bind(R),
    db.prepare(`delete from cellar_elements where cellar_id in (${inR})`).bind(R),
    ...(sameUser ? [db.prepare('delete from tastings where user_id = ?').bind(userId)] : []),
  );
  stmts.push(db.prepare('update cellars set name = ? where id = ?').bind(String(b.cellars[0].name ?? '') || 'Casa', target));

  // Wines are shared rows: the same id is updated when it is still that wine
  // (or free), otherwise the file's wine comes back under a new id. A wine
  // another user has stays as it is (the caller's bottles point at it).
  const existing = new Map(winesRes.results.map((w) => [Number(w.id), w]));
  const wineMap = new Map<unknown, number>();
  for (const w of b.wines) {
    const now = existing.get(Number(w.id));
    const same = !now || (now.name === w.name && now.producer === w.producer);
    const id = same ? Number(w.id) : next('wines');
    wineMap.set(w.id, id);
    if (same && now && shared.has(id)) continue;
    insert('wines', w, { id, created_by: userOr(w.created_by, null), search_text: null, ...safeWineLinks(w) }, same);
  }

  const elementMap = new Map<unknown, number>();
  for (const e of b.cellar_elements) {
    const cellar = cellarMap.get(e.cellar_id);
    if (cellar == null) continue;
    const id = next('cellar_elements');
    elementMap.set(e.id, id);
    insert('cellar_elements', e, { id, cellar_id: cellar });
  }
  const bottleMap = new Map<unknown, number>();
  for (const bt of b.bottles) {
    const cellar = cellarMap.get(bt.cellar_id);
    const wine = wineMap.get(bt.wine_id);
    if (cellar == null || wine == null) continue;
    const id = next('bottles');
    bottleMap.set(bt.id, id);
    // The old one-place columns point at old element ids: places are in bottle_places.
    insert('bottles', bt, { id, cellar_id: cellar, wine_id: wine, added_by: userOr(bt.added_by, userId), element_id: null, slot_tier: null, slot_col: null, slot_depth: null });
  }
  for (const p of b.bottle_places) {
    const bottle = bottleMap.get(p.bottle_id);
    const element = elementMap.get(p.element_id);
    if (bottle != null && element != null) insert('bottle_places', p, { id: next('bottle_places'), bottle_id: bottle, element_id: element });
  }
  let notes = 0;
  for (const n of b.tasting_notes) {
    const bottle = bottleMap.get(n.bottle_id);
    const user = userOr(n.user_id, null);
    if (bottle == null || user == null) continue; // a friend who is not on this database
    insert('tasting_notes', n, { id: next('tasting_notes'), bottle_id: bottle, user_id: user });
    notes++;
  }
  const photoKeys: string[] = [];
  for (const p of b.photos) {
    const bottle = bottleMap.get(p.bottle_id);
    const key = String(p.r2_key);
    if (bottle == null || !isBottlePhotoKey(key) || taken.has(key)) continue;
    insert('photos', p, { id: next('photos'), bottle_id: bottle, uploaded_by: userOr(p.uploaded_by, userId) });
    photoKeys.push(String(p.r2_key));
  }
  for (const w of b.wishlist_items) {
    const cellar = cellarMap.get(w.cellar_id);
    const wine = wineMap.get(w.wine_id);
    if (cellar != null && wine != null) insert('wishlist_items', w, { id: next('wishlist_items'), cellar_id: cellar, wine_id: wine, added_by: userOr(w.added_by, userId) });
  }
  if (sameUser) for (const t of b.tastings) insert('tastings', t, { id: next('tastings'), user_id: userId });

  await saveSafetyCopy(env, userId);
  await db.batch(stmts); // one transaction: all or nothing

  const keys = new Set([...photoKeys, ...b.wines.map((w) => { try { return wineImageKey(safeWineLinks(w).image_url); } catch { return null; } }).filter((k): k is string => !!k)]);
  const missingFiles: string[] = [];
  for (const key of keys) if (!(await env.PHOTOS.head(key))) missingFiles.push(key);
  return { wines: bottleMap.size, notes, missingFiles } as const;
}

// May the caller put this photo back? Only a key a row of their cellars
// points at, and only when R2 has lost it.
async function fileWanted(env: Env, key: string, userId: number) {
  if (!isBottlePhotoKey(key) && !isWineImageKey(key)) return false;
  const row = await env.DB
    .prepare(
      `select 1 from photos where r2_key = ?2 and bottle_id in (${MY_BOTTLES})
       union select 1 from wines where image_url = ?3 and id in (select wine_id from bottles where cellar_id in (${MINE})
                                                       union select wine_id from wishlist_items where cellar_id in (${MINE}))`,
    )
    .bind(userId, key, WINE_IMAGE + encodeURIComponent(key))
    .first();
  return row !== null;
}

export const backupRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
backupRoutes.use('*', requireAuth);

backupRoutes.get('/', async (c) => c.json(await buildUserBackup(c.env.DB, c.get('userId'))));

// For the row in Profilo: the newest weekly copy (whole database; `automatic`
// is its day YYYY-MM-DD, `automaticAt` the moment it was written, ISO UTC) and
// when this user last saved a file on the phone.
backupRoutes.get('/status', async (c) => {
  const objects = (await c.env.PHOTOS.list({ prefix: BACKUP_PREFIX })).objects.sort((a, b) => (a.key < b.key ? -1 : 1));
  const newest = objects.at(-1);
  const me = await c.env.DB.prepare('select last_backup_at from users where id = ?').bind(c.get('userId')).first<{ last_backup_at: string | null }>();
  return c.json({
    automatic: newest?.key.slice(BACKUP_PREFIX.length, BACKUP_PREFIX.length + 10) ?? null,
    automaticAt: newest?.uploaded.toISOString() ?? null,
    saved: me?.last_backup_at ?? null,
  });
});

backupRoutes.post('/saved', async (c) => {
  await c.env.DB.prepare(`update users set last_backup_at = datetime('now') where id = ?`).bind(c.get('userId')).run();
  return c.json({ ok: true });
});

backupRoutes.post('/restore', async (c) => {
  const backup = readBackup(await c.req.json().catch(() => null));
  if (!backup) return c.json({ error: 'Questo file non è un backup di Calice.' }, 400);
  const result = await restoreUserBackup(c.env, c.get('userId'), backup);
  if ('error' in result) return c.json({ error: result.error }, 400);
  return c.json(result);
});

backupRoutes.put('/files/:key', async (c) => {
  const key = decodeURIComponent(c.req.param('key'));
  const userId = c.get('userId');
  if (!(await fileWanted(c.env, key, userId))) return c.json({ error: 'not found' }, 404);
  if (await c.env.PHOTOS.head(key)) return c.json({ ok: true }); // never overwrite
  const bytes = await c.req.arrayBuffer();
  if (bytes.byteLength > MAX_FILE_BYTES) return c.json({ error: 'too big' }, 400);
  const type = detectImageType(bytes);
  if (!type) return c.json({ error: 'not an image' }, 400);
  await c.env.PHOTOS.put(key, bytes, { httpMetadata: { contentType: type } });
  return c.json({ ok: true });
});
