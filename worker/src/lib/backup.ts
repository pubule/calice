// Weekly copy of the whole database, kept in R2 next to the photos
// (backups/<date>.json, the newest KEEP only). It covers a bad deploy, a
// wrong edit or a deletion; the photos themselves are not copied (they are
// already in R2, the copy keeps their keys). To restore one, see
// worker/scripts/backup-to-sql.ts.

export const BACKUP_PREFIX = 'backups/';
const KEEP = 8;
const EVERY_DAYS = 7;
// Internal tables: D1's own bookkeeping, recreated by the migrations.
const SKIP = /^(sqlite_|_cf_|d1_migrations$)/;

export type Backup = {
  format: 'calice-backup';
  version: 1;
  createdAt: string;
  migrations: string[];
  tables: Record<string, Record<string, unknown>[]>;
};

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
