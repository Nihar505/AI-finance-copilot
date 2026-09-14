import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { DbClient } from './db';

export interface MigrationRecord {
  id: string;
  name: string;
  checksum: string;
  executed_at: Date;
}

export function computeChecksum(content: string): string {
  return crypto.createHash('sha256').update(content.trim()).digest('hex');
}

export async function runMigrations(db: DbClient): Promise<string[]> {
  // 1. Ensure tracking table exists
  await db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id VARCHAR(255) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      checksum VARCHAR(64) NOT NULL,
      executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 2. Fetch applied migrations
  const { rows: appliedRows } = await db.query<MigrationRecord>('SELECT id, name, checksum FROM _migrations ORDER BY id ASC');
  const appliedMap = new Map<string, MigrationRecord>();
  for (const r of appliedRows) {
    appliedMap.set(r.id, r);
  }

  // 3. Read migration files from src/migrations
  const migrationsDir = path.join(process.cwd(), 'src', 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    return [];
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql') && !f.endsWith('.rollback.sql'))
    .sort();

  const executedMigrations: string[] = [];

  for (const file of files) {
    const migrationId = path.basename(file, '.sql');
    const filePath = path.join(migrationsDir, file);
    const sqlContent = fs.readFileSync(filePath, 'utf8');
    const checksum = computeChecksum(sqlContent);

    const existing = appliedMap.get(migrationId);

    if (existing) {
      if (existing.checksum !== checksum) {
        throw new Error(
          `Migration checksum mismatch for ${file}! Expected ${existing.checksum}, found ${checksum}. Migration history has been altered.`
        );
      }
      continue; // Already applied
    }

    // Apply unapplied migration inside a transaction
    await db.transaction(async (trx) => {
      await trx.exec(sqlContent);
      await trx.query(
        'INSERT INTO _migrations (id, name, checksum) VALUES ($1, $2, $3)',
        [migrationId, file, checksum]
      );
    });

    executedMigrations.push(migrationId);
  }

  return executedMigrations;
}
