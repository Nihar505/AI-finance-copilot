/**
 * scripts/migrate.ts
 *
 * CLI wrapper: apply all pending database migrations.
 *
 * Usage:
 *   npm run db:migrate
 *   DATABASE_URL=postgres://... npm run db:migrate
 *
 * When DATABASE_URL is set the script connects to the managed PostgreSQL
 * instance; otherwise it falls back to the embedded PGlite dev database.
 */

import { getDb } from '../src/lib/db';

async function main() {
  console.log('[migrate] Connecting to database…');
  // getDb() internally calls runMigrations() on first use.
  await getDb();
  console.log('[migrate] Migration complete.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[migrate] Fatal error:', err);
  process.exit(1);
});
