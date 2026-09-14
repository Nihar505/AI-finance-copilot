import type { DbClient } from './db';

export interface DatabaseBackup {
  metadata: {
    version: string;
    exportedAt: string;
    engine: string;
    tablesCount: number;
    recordsCount: number;
  };
  data: Record<string, any[]>;
}

// Ordered for deletion during restore to respect foreign key dependencies
const TABLES_IN_RESTORE_ORDER = [
  'gstr2b_entries',
  'compliance_filings',
  'pilot_requests',
  'audit_logs',
  'approvals',
  'categorization_rules',
  'exceptions',
  'reconciliation_records',
  'bills',
  'invoices',
  'transactions',
  'documents',
  'customers',
  'vendors',
  'bank_accounts',
  'chart_of_accounts',
  'user_organizations',
  'users',
  'organizations',
];

// Ordered for insertion during restore to respect primary key dependencies
const TABLES_IN_INSERT_ORDER = [...TABLES_IN_RESTORE_ORDER].reverse();

export async function createBackup(db: DbClient): Promise<DatabaseBackup> {
  const data: Record<string, any[]> = {};
  let totalRecords = 0;

  for (const table of TABLES_IN_INSERT_ORDER) {
    const res = await db.query(`SELECT * FROM ${table}`);
    data[table] = res.rows || [];
    totalRecords += data[table].length;
  }

  return {
    metadata: {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      engine: db.engineType || 'unknown',
      tablesCount: TABLES_IN_INSERT_ORDER.length,
      recordsCount: totalRecords,
    },
    data,
  };
}

export async function restoreBackup(db: DbClient, backup: DatabaseBackup): Promise<{ restoredTables: number; restoredRecords: number }> {
  if (!backup || !backup.metadata || !backup.data) {
    throw new Error('Invalid backup artifact structure');
  }

  let totalRestoredRecords = 0;
  let restoredTablesCount = 0;

  await db.transaction(async (trx) => {
    // 1. Truncate / delete existing data in safe reverse dependency order
    for (const table of TABLES_IN_RESTORE_ORDER) {
      await trx.exec(`DELETE FROM ${table}`);
    }

    // 2. Insert records in topological order
    for (const table of TABLES_IN_INSERT_ORDER) {
      const records = backup.data[table];
      if (!records || records.length === 0) continue;

      for (const record of records) {
        const keys = Object.keys(record);
        if (keys.length === 0) continue;

        const columns = keys.map(k => `"${k}"`).join(', ');
        const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
        const values = keys.map(k => record[k]);

        const insertSql = `INSERT INTO ${table} (${columns}) VALUES (${placeholders})`;
        await trx.query(insertSql, values);
        totalRestoredRecords++;
      }
      restoredTablesCount++;
    }
  });

  return {
    restoredTables: restoredTablesCount,
    restoredRecords: totalRestoredRecords,
  };
}
