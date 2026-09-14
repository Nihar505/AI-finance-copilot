import fs from 'fs';
import path from 'path';
import { getDb } from '../src/lib/db';
import { restoreBackup } from '../src/lib/backup';

async function main() {
  const args = process.argv.slice(2);
  let fileIdx = args.indexOf('--file');
  if (fileIdx === -1) {
    fileIdx = args.indexOf('--input');
  }

  if (fileIdx === -1 || !args[fileIdx + 1]) {
    console.error('❌ Error: Missing required --file <path> or --input <path> argument.');
    process.exit(1);
  }

  const inputPath = args[fileIdx + 1];
  const fullPath = path.resolve(process.cwd(), inputPath);

  if (!fs.existsSync(fullPath)) {
    console.error(`❌ Error: Backup file not found at ${fullPath}`);
    process.exit(1);
  }

  console.log(`📥 Restoring database from backup: ${fullPath}...`);
  try {
    const rawData = fs.readFileSync(fullPath, 'utf8');
    const backup = JSON.parse(rawData);
    const db = await getDb();
    const result = await restoreBackup(db, backup);
    console.log(`✅ Database successfully restored (${result.restoredRecords} records into ${result.restoredTables} tables).`);
    process.exit(0);
  } catch (err: any) {
    console.error('❌ Restore failed:', err.message || err);
    process.exit(1);
  }
}

main();
