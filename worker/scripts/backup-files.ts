// Puts back the photos of a weekly backup, next to backup-to-sql.ts, which
// puts back the rows. The backup lists them in `photos`; their copies are in
// R2 under backup-photos/<key>.
//   npx wrangler r2 object get calice-photos/backups/2026-10-19.json --remote --file backup.json
//   node worker/scripts/backup-files.ts backup.json foto > put-foto.sh
//   sh put-foto.sh
// For every photo the script downloads the copy into <dir>/<key> and puts it
// back at <key> (keys are never reused, so it is the same photo).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PHOTO_COPY_PREFIX, type Backup } from '../src/lib/backup.ts';

const [file, dir] = process.argv.slice(2);
if (!file || !dir) {
  console.error('uso: node worker/scripts/backup-files.ts <backup.json> <cartella>');
  process.exit(1);
}
// The output is a shell script: only plain keys and folders get in.
if (!/^[A-Za-z0-9_./:\\ -]+$/.test(dir)) throw new Error(`cartella non valida: ${dir}`);
const backup = JSON.parse(readFileSync(file, 'utf8')) as Backup;
if (backup.format !== 'calice-backup') throw new Error('non è un backup di Calice');
const photos = backup.photos ?? [];
for (const { key, type } of photos) {
  if (!/^image\/[a-z0-9.+-]+$/.test(type)) throw new Error(`tipo non valido: ${type}`);
  if (!/^[A-Za-z0-9_-]+(\/[A-Za-z0-9_.-]+)*$/.test(key) || key.split('/').includes('..')) throw new Error(`chiave non valida: ${key}`);
  const out = path.posix.join(dir.replace(/\\/g, '/'), key); // forward slashes: the output runs in sh
  process.stdout.write(`mkdir -p '${path.dirname(out)}'\n`);
  process.stdout.write(`npx wrangler r2 object get 'calice-photos/${PHOTO_COPY_PREFIX}${key}' --remote --file '${out}'\n`);
  process.stdout.write(`npx wrangler r2 object put 'calice-photos/${key}' --remote --file '${out}' --content-type '${type}'\n`);
}
console.error(`${photos.length} foto nello script`);
