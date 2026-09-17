/**
 * scripts/restore.ts
 *
 * CLI wrapper: restore the database from a JSON snapshot.
 *
 * Usage:
 *   npm run db:restore -- --file backups/backup_2024-01-01.snapshot.json
 *   DATABASE_URL=postgres://... npm run db:restore -- --file <path>
 *
 * WARNING: This will DELETE all existing data in the target database before
 * restoring. Ensure you have a current backup before running.
 *
 * For managed Postgres disaster recovery, also refer to your provider's
 * native point-in-time recovery (PITR) — Neon, Supabase, and RDS all
 * support this at the provider level.
 */

import { restoreBackup } from '../src/lib/backup';

async function main() {
  const fileArg = process.argv.indexOf('--file');
  if (fileArg === -1 || !process.argv[fileArg + 1]) {
    console.error('[restore] Usage: npm run db:restore -- --file <path-to-snapshot.json>');
    process.exit(1);
  }

  const snapshotPath = process.argv[fileArg + 1];

  console.warn('[restore] ⚠️  This will overwrite ALL existing data in the database.');
  console.warn('[restore] Confirm you have a current backup before proceeding.');
  console.log(`[restore] Restoring from: ${snapshotPath}`);

  await restoreBackup(snapshotPath);
  console.log('[restore] Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[restore] Fatal error:', err);
  process.exit(1);
});
