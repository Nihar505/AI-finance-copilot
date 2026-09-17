/**
 * scripts/backup.ts
 *
 * CLI wrapper: create a JSON snapshot backup of the database.
 *
 * Usage:
 *   npm run db:backup
 *   npm run db:backup -- --dir /path/to/backup/dir
 *   DATABASE_URL=postgres://... npm run db:backup
 *
 * Output is written to ./backups/ by default.
 * Backup files are excluded from git via .gitignore.
 *
 * For production databases, also use your provider's native backup:
 *   pg_dump "$DATABASE_URL" --format=custom --file=backups/$(date +%Y%m%d).dump
 */

import { createBackup } from '../src/lib/backup';

async function main() {
  const dirArg = process.argv.indexOf('--dir');
  const outputDir = dirArg !== -1 ? process.argv[dirArg + 1] : 'backups';

  if (!outputDir) {
    console.error('[backup] --dir flag provided but no path given');
    process.exit(1);
  }

  console.log(`[backup] Creating snapshot in ${outputDir}/…`);
  const filePath = await createBackup(outputDir);
  console.log(`[backup] Done: ${filePath}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[backup] Fatal error:', err);
  process.exit(1);
});
