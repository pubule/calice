// Weekly copy of the whole database, kept in R2 next to the photos
// (backups/<date>.json, the newest KEEP only). It covers a bad deploy, a
// wrong edit or a deletion. The photos (bottle photos and wine photos, all in
// R2) go inside the copy as base64, same shape as the Profilo backup's
// `files`, so a lost or overwritten photo comes back too. To restore, see
// worker/scripts/backup-to-sql.ts and worker/scripts/backup-files.ts.

export const BACKUP_PREFIX = 'backups/';
const KEEP = 8;
const EVERY_DAYS = 7;
// Internal tables (D1's own bookkeeping, recreated by the migrations) and
// caches that refill by themselves.
const SKIP = /^(sqlite_|_cf_|d1_migrations$|search_cache$)/;

export type Backup = {
  format: 'calice-backup';
  version: 1;
  createdAt: string;
  migrations: string[];
  tables: Record<string, Record<string, unknown>[]>;
  files?: Record<string, { type: string; data: string }>;
};

const WINE_IMAGE = '/api/wine-images/';

function toBase64(bytes: ArrayBuffer): string {
  const u8 = new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(bin);
}

// The bytes of every photo the rows point at. A key R2 no longer has is
// simply missing from the result.
export async function dumpPhotos(photos: R2Bucket, tables: Backup['tables']): Promise<NonNullable<Backup['files']>> {
  const keys = new Set<string>();
  for (const p of tables.photos ?? []) if (p.r2_key) keys.add(String(p.r2_key));
  for (const w of tables.wines ?? []) {
    const url = String(w.image_url ?? '');
    if (url.startsWith(WINE_IMAGE)) keys.add(decodeURIComponent(url.slice(WINE_IMAGE.length)));
  }
  const files: NonNullable<Backup['files']> = {};
  for (const key of keys) {
    const object = await photos.get(key);
    if (object) files[key] = { type: object.httpMetadata?.contentType ?? 'application/octet-stream', data: toBase64(await object.arrayBuffer()) };
  }
  return files;
}

export async function dumpDatabase(db: D1Database): Promise<Backup> {
  const names = await db.prepare(`select name from sqlite_master where type = 'table' order by name`).all<{ name: string }>();
  const tables: Backup['tables'] = {};
  for (const { name } of names.results) {
    if (SKIP.test(name)) continue;
    tables[name] = (await db.prepare(`select * from "${name}"`).all<Record<string, unknown>>()).results;
  }
  const migrations = await db.prepare('select name from d1_migrations order by id').all<{ name: string }>().catch(() => ({ results: [] }));
  return { format: 'calice-backup', version: 1, createdAt: new Date().toISOString(), migrations: migrations.results.map((m) => m.name), tables };
}

// Called by the daily cron: makes a copy when the newest is a week old,
// then drops the oldest beyond KEEP. Checking the age (not the weekday)
// means a missed cron run only delays the copy by a day.
export async function runWeeklyBackup(env: { DB: D1Database; PHOTOS: R2Bucket }, now = new Date()) {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.PHOTOS.list({ prefix: BACKUP_PREFIX, cursor });
    keys.push(...page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  keys.sort(); // backups/YYYY-MM-DD.json: by name = by date

  const newest = keys.at(-1)?.slice(BACKUP_PREFIX.length, BACKUP_PREFIX.length + 10);
  const age = newest ? (now.getTime() - Date.parse(`${newest}T00:00:00Z`)) / 86_400_000 : Infinity;
  let made: string | null = null;
  if (!(age < EVERY_DAYS - 0.5)) {
    made = `${BACKUP_PREFIX}${now.toISOString().slice(0, 10)}.json`;
    const backup = await dumpDatabase(env.DB);
    backup.files = await dumpPhotos(env.PHOTOS, backup.tables);
    await env.PHOTOS.put(made, JSON.stringify(backup), { httpMetadata: { contentType: 'application/json' } });
    if (!keys.includes(made)) keys.push(made);
  }
  const old = keys.slice(0, Math.max(0, keys.length - KEEP));
  if (old.length) await env.PHOTOS.delete(old);
  return { made, deleted: old };
}

const sqlValue = (v: unknown) =>
  v == null ? 'NULL' : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? (v ? '1' : '0') : `'${String(v).replace(/'/g, "''")}'`;

// The SQL that puts a backup's rows back: every table in it is emptied and
// refilled, ids included. Run it on a database with the same migrations
// applied (`backup.migrations`).
export function backupToSql(backup: Backup): string {
  const out = ['PRAGMA defer_foreign_keys = on;'];
  const tables = Object.keys(backup.tables);
  for (const t of tables) out.push(`DELETE FROM "${t}";`);
  for (const t of tables) {
    for (const row of backup.tables[t]) {
      const cols = Object.keys(row);
      out.push(`INSERT INTO "${t}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map((c) => sqlValue(row[c])).join(', ')});`);
    }
  }
  return `${out.join('\n')}\n`;
}
