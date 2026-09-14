import fs from 'fs';
import path from 'path';
import { getDb } from '../src/lib/db';
import { createBackup } from '../src/lib/backup';

async function main() {
  const args = process.argv.slice(2);
  let outputPath = './backups/backup.json';

  const outIdx = args.indexOf('--output');
  if (outIdx !== -1 && args[outIdx + 1]) {
    outputPath = args[outIdx + 1];
  }

  console.log(`📦 Creating transactional database backup...`);
  try {
    const db = await getDb();
    const backup = await createBackup(db);

    const fullPath = path.resolve(process.cwd(), outputPath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(fullPath, JSON.stringify(backup, null, 2), 'utf8');
    console.log(`✅ Backup successfully saved to ${fullPath} (${backup.metadata.recordsCount} records across ${backup.metadata.tablesCount} tables).`);
    process.exit(0);
  } catch (err: any) {
    console.error('❌ Backup failed:', err.message || err);
    process.exit(1);
  }
}

main();
