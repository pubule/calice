// Weekly copy of the whole database, kept in R2 next to the photos
// (backups/<date>.json, the newest KEEP only). It covers a bad deploy, a
// wrong edit or a deletion. Every photo the rows point at (bottle photos and
// wine photos) is also copied, once, to backup-photos/<key> (a key is never
// reused, so a copy never goes stale), and the backup lists them in `photos`.
// A copy goes when none of the KEEP backups lists it any more, so a photo
// deleted by mistake can come back for KEEP weeks. To restore, see
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
  photos?: { key: string; type: string }[];
};

export const PHOTO_COPY_PREFIX = 'backup-photos/';
const WINE_IMAGE = '/api/wine-images/';
const LANDSCAPE_IMAGE = '/api/landscape-images/';

// The photo keys the rows point at, plus `extra` (the hand-picked landscapes,
// which no row names).
export function photoKeys(tables: Backup['tables'], extra: string[] = []): string[] {
  const keys = new Set<string>(extra);
  for (const p of tables.photos ?? []) if (p.r2_key) keys.add(String(p.r2_key));
  const links: [Record<string, unknown>[] | undefined, string, string][] = [
    [tables.wines, 'image_url', WINE_IMAGE], [tables.landscapes, 'url', LANDSCAPE_IMAGE],
  ];
  for (const [rows, column, prefix] of links) {
    for (const r of rows ?? []) {
      const url = String(r[column] ?? '');
      if (!url.startsWith(prefix)) continue;
      try {
        keys.add(decodeURIComponent(url.slice(prefix.length)));
      } catch {} // a malformed link points at no file
    }
  }
  return [...keys].sort();
}

// Copies the photos not copied yet, one at a time (no size limit, little
// memory). Returns the photos that have a copy; a key R2 no longer has is left out.
async function copyPhotos(bucket: R2Bucket, keys: string[]): Promise<NonNullable<Backup['photos']>> {
  const copied: NonNullable<Backup['photos']> = [];
  for (const key of keys) {
    const done = await bucket.head(PHOTO_COPY_PREFIX + key);
    if (done) {
      copied.push({ key, type: done.httpMetadata?.contentType ?? '' });
      continue;
    }
    const object = await bucket.get(key);
    if (!object) continue;
    await bucket.put(PHOTO_COPY_PREFIX + key, await object.arrayBuffer(), { httpMetadata: object.httpMetadata });
    copied.push({ key, type: object.httpMetadata?.contentType ?? '' });
  }
  return copied;
}

async function listKeys(bucket: R2Bucket, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor });
    keys.push(...page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return keys;
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
export async function runWeeklyBackup(env: { DB: D1Database; PHOTOS: R2Bucket }, now = new Date(), extraPhotos: string[] = []) {
  const keys = await listKeys(env.PHOTOS, BACKUP_PREFIX);
  keys.sort(); // backups/YYYY-MM-DD.json: by name = by date

  const newest = keys.at(-1)?.slice(BACKUP_PREFIX.length, BACKUP_PREFIX.length + 10);
  const age = newest ? (now.getTime() - Date.parse(`${newest}T00:00:00Z`)) / 86_400_000 : Infinity;
  let made: string | null = null;
  if (!(age < EVERY_DAYS - 0.5)) {
    made = `${BACKUP_PREFIX}${now.toISOString().slice(0, 10)}.json`;
    const backup = await dumpDatabase(env.DB);
    backup.photos = await copyPhotos(env.PHOTOS, photoKeys(backup.tables, extraPhotos));
    await env.PHOTOS.put(made, JSON.stringify(backup), { httpMetadata: { contentType: 'application/json' } });
    if (!keys.includes(made)) keys.push(made);
  }
  const old = keys.slice(0, Math.max(0, keys.length - KEEP));
  if (old.length) await env.PHOTOS.delete(old);

  // Photo copies no kept backup lists any more.
  const listed = new Set<string>();
  for (const key of keys.slice(old.length)) {
    const backup = await (await env.PHOTOS.get(key))?.json<Backup>().catch(() => null);
    if (!backup) return { made, deleted: old, photosDeleted: 0 }; // unreadable: keep every copy
    for (const p of backup.photos ?? []) listed.add(p.key);
  }
  const stale = (await listKeys(env.PHOTOS, PHOTO_COPY_PREFIX)).filter((k) => !listed.has(k.slice(PHOTO_COPY_PREFIX.length)));
  for (let n = 0; n < stale.length; n += 1000) await env.PHOTOS.delete(stale.slice(n, n + 1000));
  return { made, deleted: old, photosDeleted: stale.length };
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
