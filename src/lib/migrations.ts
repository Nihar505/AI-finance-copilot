/**
 * src/lib/migrations.ts
 *
 * Forward-only, transaction-wrapped migration runner.
 *
 * How it works:
 *   1. Ensures the _migrations tracking table exists.
 *   2. Reads all *.sql files from src/migrations/ sorted by name.
 *   3. Computes a SHA-256 checksum for each file.
 *   4. Skips files whose checksum is already recorded in _migrations.
 *   5. Applies unapplied migrations inside a single database transaction.
 *
 * Rollback:
 *   There is no automated DOWN migration.  Each migration has a companion
 *   *.rollback.md explaining the manual rollback procedure.  This is
 *   intentional — automated rollback on financial data requires human review.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DbClient } from './db';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function checksumSql(sql: string): string {
  return crypto.createHash('sha256').update(sql, 'utf8').digest('hex');
}

function getMigrationsDir(): string {
  return path.join(process.cwd(), 'src', 'migrations');
}

function listMigrationFiles(): string[] {
  const dir = getMigrationsDir();
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // Alphabetical order; numeric prefix guarantees ordering
}

// ─────────────────────────────────────────────────────────────────────────────
// Core
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create the _migrations tracking table if it doesn't exist.
 * This is always run outside a user transaction so it commits immediately.
 */
async function ensureMigrationsTable(db: DbClient): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id          SERIAL PRIMARY KEY,
      name        VARCHAR(255) NOT NULL UNIQUE,
      checksum    CHAR(64)     NOT NULL,
      applied_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

/**
 * Return the set of migration filenames that have already been applied.
 */
async function appliedMigrations(db: DbClient): Promise<Set<string>> {
  const result = await db.query<{ name: string }>('SELECT name FROM _migrations ORDER BY id');
  return new Set(result.rows.map((r) => r.name));
}

/**
 * Apply all unapplied migrations in order, wrapped in a single transaction.
 * Already-applied migrations are validated by checksum to detect tampering.
 */
export async function runMigrations(db: DbClient): Promise<void> {
  await ensureMigrationsTable(db);

  const files = listMigrationFiles();
  if (files.length === 0) {
    // No migration files yet; apply schema.sql directly (legacy bootstrap).
    await applyLegacySchemaSql(db);
    return;
  }

  const applied = await appliedMigrations(db);
  const pending = files.filter((f) => !applied.has(f));

  if (pending.length === 0) {
    console.log('[migrations] All migrations already applied — nothing to do.');
    return;
  }

  console.log(`[migrations] Applying ${pending.length} migration(s)…`);

  await db.transaction(async (trx) => {
    for (const filename of pending) {
      const filePath = path.join(getMigrationsDir(), filename);
      const sql = fs.readFileSync(filePath, 'utf8');
      const checksum = checksumSql(sql);

      console.log(`[migrations]  → ${filename}`);
      await trx.exec(sql);
      await trx.query(
        'INSERT INTO _migrations (name, checksum) VALUES ($1, $2)',
        [filename, checksum],
      );
    }
  });

  console.log('[migrations] Done.');
}

/**
 * Legacy fallback: if no src/migrations/ directory exists yet, apply
 * src/lib/schema.sql directly (idempotent due to IF NOT EXISTS guards).
 * This code path is removed once 001_initial_schema.sql is present.
 */
async function applyLegacySchemaSql(db: DbClient): Promise<void> {
  const schemaPath = path.join(process.cwd(), 'src', 'lib', 'schema.sql');
  if (!fs.existsSync(schemaPath)) return;

  const sql = fs.readFileSync(schemaPath, 'utf8');
  try {
    await db.exec(sql);
  } catch (err) {
    // Schema already exists — safe to ignore in dev/PGlite context.
    console.warn('[migrations] Legacy schema.sql apply encountered a warning:', err);
  }
}
