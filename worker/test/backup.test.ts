import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../src/index';
import { runWeeklyBackup, backupToSql, BACKUP_PREFIX, type Backup } from '../src/lib/backup';

async function backupKeys() {
  return (await env.PHOTOS.list({ prefix: BACKUP_PREFIX })).objects.map((o) => o.key).sort();
}

beforeEach(async () => {
  for (const key of await backupKeys()) await env.PHOTOS.delete(key);
  await env.DB.exec('DELETE FROM bottle_places; DELETE FROM bottles; DELETE FROM wines; DELETE FROM cellar_members; DELETE FROM cellars; DELETE FROM users;');
});

describe('runWeeklyBackup', () => {
  it('copies every table, once a week, keeping the newest 8', async () => {
    await app.request('/api/auth/me', { headers: { 'X-Calice-Dev-Email': 'backup@b.com' } }, env);
    await env.DB.prepare(`insert into wines (name, producer, country, type, source) values ('L''Amarone', 'Zamuner', 'Italia', 'rosso', 'catalog')`).run();

    const first = await runWeeklyBackup(env as any, new Date('2026-10-01T08:00:00Z'));
    expect(first.made).toBe('backups/2026-10-01.json');
    const backup = await (await env.PHOTOS.get(first.made!))!.json<Backup>();
    expect(backup.tables.users.map((u) => u.email)).toContain('backup@b.com');
    expect(backup.tables.wines[0].name).toBe("L'Amarone");
    expect(backup.tables.d1_migrations).toBeUndefined();

    // Less than a week later: nothing new.
    expect((await runWeeklyBackup(env as any, new Date('2026-10-05T08:00:00Z'))).made).toBeNull();

    for (let week = 1; week <= 9; week++) await runWeeklyBackup(env as any, new Date(Date.parse('2026-10-01T08:00:00Z') + week * 7 * 86_400_000));
    const keys = await backupKeys();
    expect(keys).toHaveLength(8);
    expect(keys[0]).toBe('backups/2026-10-15.json');
  });

  it('turns a backup into SQL that puts the rows back', async () => {
    await env.DB.prepare(`insert into wines (name, producer, country, type, source) values ('L''Amarone', 'Zamuner', 'Italia', 'rosso', 'catalog')`).run();
    const { made } = await runWeeklyBackup(env as any, new Date('2026-10-01T08:00:00Z'));
    const backup = await (await env.PHOTOS.get(made!))!.json<Backup>();

    await env.DB.exec('DELETE FROM wines;');
    const sql = backupToSql(backup).split('\n').filter((s) => s && !s.startsWith('PRAGMA'));
    await env.DB.batch(sql.map((s) => env.DB.prepare(s)));
    const wine = await env.DB.prepare('select name from wines').first<{ name: string }>();
    expect(wine?.name).toBe("L'Amarone");
  });
});
