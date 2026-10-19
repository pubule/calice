// Puts back the photos of a weekly backup (its `files`), next to
// backup-to-sql.ts, which puts back the rows.
//   npx wrangler r2 object get calice-photos/backups/2026-10-19.json --remote --file backup.json
//   node worker/scripts/backup-files.ts backup.json photos > put-photos.sh
//   sh put-photos.sh
// It writes every photo under <dir>/<key> and prints one `wrangler r2 object
// put` per photo; that overwrites the key in R2 (keys are never reused, so it
// is the same photo).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Backup } from '../src/lib/backup.ts';

const [file, dir] = process.argv.slice(2);
if (!file || !dir) {
  console.error('uso: node worker/scripts/backup-files.ts <backup.json> <cartella>');
  process.exit(1);
}
const backup = JSON.parse(readFileSync(file, 'utf8')) as Backup;
if (backup.format !== 'calice-backup') throw new Error('non è un backup di Calice');
const files = Object.entries(backup.files ?? {});
for (const [key, f] of files) {
  if (key.split('/').includes('..')) throw new Error(`chiave non valida: ${key}`);
  const out = path.join(dir, key);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(f.data, 'base64'));
  process.stdout.write(`npx wrangler r2 object put 'calice-photos/${key}' --remote --file '${out}' --content-type '${f.type}'\n`);
}
console.error(`${files.length} foto scritte in ${dir}`);
