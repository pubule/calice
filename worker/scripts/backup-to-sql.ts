// Turns a backup from R2 into SQL that restores it.
//   npx wrangler r2 object get calice-photos/backups/2026-10-19.json --remote --file backup.json
//   node worker/scripts/backup-to-sql.ts backup.json > restore.sql
//   npx wrangler d1 execute calice-db --remote --file restore.sql
// It empties and refills every table in the backup: anything written after
// the backup's date is lost, so download a fresh one first if in doubt.
import { readFileSync } from 'node:fs';
import { backupToSql, type Backup } from '../src/lib/backup.ts';

const file = process.argv[2];
if (!file) {
  console.error('uso: node worker/scripts/backup-to-sql.ts <backup.json>');
  process.exit(1);
}
const backup = JSON.parse(readFileSync(file, 'utf8')) as Backup;
if (backup.format !== 'calice-backup') throw new Error('non è un backup di Calice');
process.stdout.write(backupToSql(backup));
