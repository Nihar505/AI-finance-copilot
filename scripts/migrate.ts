import { getDb } from '../src/lib/db';
import { runMigrations } from '../src/lib/migrations';

async function main() {
  console.log('🔄 Executing database migrations...');
  try {
    const db = await getDb();
    const applied = await runMigrations(db);
    if (applied.length === 0) {
      console.log('✅ Database is up to date. No new migrations applied.');
    } else {
      console.log(`✅ Applied ${applied.length} migration(s): ${applied.join(', ')}`);
    }
    process.exit(0);
  } catch (err: any) {
    console.error('❌ Migration failed:', err.message || err);
    process.exit(1);
  }
}

main();
