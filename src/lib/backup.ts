/**
 * src/lib/backup.ts
 *
 * Backup and restore utilities for the AI Finance & Compliance Copilot.
 *
 * Backup strategy (application-level JSON snapshot):
 *   - Exports every table to a structured JSON file.
 *   - Suitable for local dev / PGlite and as a supplemental "logical backup"
 *     alongside provider-managed physical backups (Neon PITR, Supabase PITR,
 *     RDS automated snapshots).
 *   - For production, prefer `pg_dump` (see scripts/backup.ts) over this
 *     in-process exporter.
 *
 * IMPORTANT: Backup files MUST be kept out of git.  The .gitignore already
 * excludes /backups/, *.dump, and *.snapshot.json.
 *
 * DPDP Act note: Backup files contain PAN/GSTIN and financial data. Store
 * them in an encrypted, access-controlled location. Do not email or
 * unauthenticated-share backup files.
 */

import fs from 'fs';
import path from 'path';
import { getDb } from './db';

// Tables exported in dependency order (parents before children).
const BACKUP_TABLES = [
  'organizations',
  'users',
  'user_organizations',
  'chart_of_accounts',
  'bank_accounts',
  'vendors',
  'customers',
  'documents',
  'transactions',
  'invoices',
  'bills',
  'reconciliation_records',
  'exceptions',
  'categorization_rules',
  'approvals',
  'audit_logs',
  'pilot_requests',
  'compliance_filings',
  'gstr2b_entries',
  '_migrations',
] as const;

export type BackupTableName = (typeof BACKUP_TABLES)[number];

export interface BackupManifest {
  version: 1;
  created_at: string;      // ISO 8601
  tables: BackupTableName[];
  row_counts: Record<string, number>;
}

export interface BackupFile {
  manifest: BackupManifest;
  data: Record<string, any[]>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dump all tables to a structured JSON snapshot.
 *
 * @param outputDir  Directory to write the snapshot file (default: ./backups).
 * @returns          Absolute path of the written snapshot file.
 */
export async function createBackup(outputDir = 'backups'): Promise<string> {
  const db = await getDb();
  const resolvedDir = path.resolve(process.cwd(), outputDir);

  if (!fs.existsSync(resolvedDir)) {
    fs.mkdirSync(resolvedDir, { recursive: true });
  }

  const data: Record<string, any[]> = {};
  const rowCounts: Record<string, number> = {};

  for (const table of BACKUP_TABLES) {
    try {
      const result = await db.query(`SELECT * FROM ${table}`);
      data[table] = result.rows;
      rowCounts[table] = result.rows.length;
    } catch {
      // Table may not exist in older schemas; continue.
      data[table] = [];
      rowCounts[table] = 0;
    }
  }

  const backup: BackupFile = {
    manifest: {
      version: 1,
      created_at: new Date().toISOString(),
      tables: [...BACKUP_TABLES],
      row_counts: rowCounts,
    },
    data,
  };

  const filename = `backup_${new Date().toISOString().replace(/[:.]/g, '-')}.snapshot.json`;
  const filePath = path.join(resolvedDir, filename);
  fs.writeFileSync(filePath, JSON.stringify(backup, null, 2), 'utf8');

  console.log(`[backup] Snapshot written to ${filePath}`);
  console.log('[backup] Row counts:', rowCounts);

  return filePath;
}

// ─────────────────────────────────────────────────────────────────────────────
// Restore
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Restore data from a JSON snapshot.
 *
 * All existing rows in the target tables are deleted first (within a
 * transaction), then rows from the snapshot are inserted in dependency order.
 * Foreign key constraints are preserved because inserts follow parent → child
 * ordering.
 *
 * @param snapshotPath  Absolute or relative path to a *.snapshot.json file.
 * @param clearFirst    If true, truncate existing data before restoring (default: true).
 */
export async function restoreBackup(snapshotPath: string, clearFirst = true): Promise<void> {
  const resolvedPath = path.resolve(process.cwd(), snapshotPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`[backup] Snapshot not found: ${resolvedPath}`);
  }

  const backup: BackupFile = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));

  if (backup.manifest.version !== 1) {
    throw new Error(`[backup] Unsupported backup version: ${backup.manifest.version}`);
  }

  const db = await getDb();

  await db.transaction(async (trx) => {
    if (clearFirst) {
      // Delete in reverse dependency order (children before parents).
      for (const table of [...BACKUP_TABLES].reverse()) {
        try {
          await trx.exec(`DELETE FROM ${table}`);
        } catch {
          // Table may not exist yet; skip.
        }
      }
    }

    for (const table of BACKUP_TABLES) {
      const rows: any[] = backup.data[table] ?? [];
      if (rows.length === 0) continue;

      const columns = Object.keys(rows[0]);
      // Skip generated columns (e.g. total_tax in gstr2b_entries).
      const skippedColumns: Record<string, string[]> = {
        gstr2b_entries: ['total_tax'],
      };
      const safeColumns = columns.filter(
        (c) => !(skippedColumns[table] ?? []).includes(c),
      );

      for (const row of rows) {
        const values = safeColumns.map((c) => row[c]);
        const placeholders = safeColumns.map((_, i) => `$${i + 1}`).join(', ');
        const sql = `INSERT INTO ${table} (${safeColumns.join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
        await trx.query(sql, values);
      }

      console.log(`[backup] Restored ${rows.length} rows into ${table}`);
    }
  });

  console.log(`[backup] Restore complete from ${resolvedPath}`);
}
