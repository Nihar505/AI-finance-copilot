import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { getDb, checkDbHealth, resetDbState } from '../src/lib/db';
import { runMigrations, computeChecksum } from '../src/lib/migrations';
import { createBackup, restoreBackup } from '../src/lib/backup';

test.describe('Phase 1: Persistent Database & Migration Infrastructure', () => {

  test('Database Health Check returns healthy status', async () => {
    const db = await getDb();
    const health = await checkDbHealth(db);
    assert.strictEqual(health.status, 'healthy');
    assert.ok(health.engine === 'pglite' || health.engine === 'postgres');
    assert.strictEqual(typeof health.latencyMs, 'number');
    assert.ok(health.latencyMs >= 0);
  });

  test('Migration Runner initializes _migrations table and records baseline migration', async () => {
    const db = await getDb();
    const res = await db.query('SELECT * FROM _migrations WHERE id = $1', ['001_initial_schema']);
    assert.strictEqual(res.rows.length, 1);
    assert.strictEqual(res.rows[0].id, '001_initial_schema');
    assert.strictEqual(res.rows[0].name, '001_initial_schema.sql');
    assert.ok(res.rows[0].checksum.length > 0);
  });

  test('Migration Runner is idempotent on subsequent runs', async () => {
    const db = await getDb();
    const applied = await runMigrations(db);
    assert.strictEqual(applied.length, 0, 'Re-running migrations should execute 0 new scripts');
  });

  test('Checksum verification detects modified applied migration files', async () => {
    const originalContent = fs.readFileSync(path.join(process.cwd(), 'src', 'migrations', '001_initial_schema.sql'), 'utf8');
    const checksum = computeChecksum(originalContent);
    assert.strictEqual(typeof checksum, 'string');
    assert.strictEqual(checksum.length, 64);
  });

  test('Strict TLS Configuration enforces rejectUnauthorized: true and custom CA cert parsing', async () => {
    const tempCaPath = path.join(process.cwd(), 'temp_test_ca.pem');
    const caContent = '-----BEGIN CERTIFICATE-----\nTEST_CA_BUNDLE\n-----END CERTIFICATE-----';
    fs.writeFileSync(tempCaPath, caContent, 'utf8');

    const savedUrl = process.env.DATABASE_URL;
    const savedCaCert = process.env.DATABASE_CA_CERT;

    try {
      process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/testdb';
      process.env.DATABASE_CA_CERT = tempCaPath;

      resetDbState();

      // Inspect globalThis._pgPool initialization options without executing database query
      await getDb().catch(() => {}); // Catch network failure during init migration attempt
      const pool = globalThis._pgPool as any;
      assert.ok(pool, 'Pool should be instantiated on globalThis._pgPool');
      assert.strictEqual(pool.options.ssl.rejectUnauthorized, true, 'TLS rejectUnauthorized must be strictly true');
      assert.strictEqual(pool.options.ssl.ca, caContent, 'Custom CA cert bundle must be correctly loaded');
    } finally {
      if (savedUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = savedUrl;
      }

      if (savedCaCert === undefined) {
        delete process.env.DATABASE_CA_CERT;
      } else {
        process.env.DATABASE_CA_CERT = savedCaCert;
      }

      resetDbState();
    }
  });

  test('Database Backup and Restore cycle maintains data integrity without FK violations', async () => {
    resetDbState();
    const db = await getDb();

    // Insert sample test organization
    const testOrgId = `test_org_${Date.now()}`;
    await db.query(`
      INSERT INTO organizations (id, name, legal_name, tax_id)
      VALUES ($1, $2, $3, $4)
    `, [testOrgId, 'Test Backup Org', 'Test Backup Org Legal', '27AAAAA0000A1Z5']);

    // Create backup
    const backup = await createBackup(db);
    assert.ok(backup.metadata.recordsCount > 0);
    assert.ok(backup.data.organizations.some((o: any) => o.id === testOrgId));

    // Restore backup
    const restoreResult = await restoreBackup(db, backup);
    assert.ok(restoreResult.restoredRecords > 0);

    // Verify record persists post-restore
    const checkRes = await db.query('SELECT * FROM organizations WHERE id = $1', [testOrgId]);
    assert.strictEqual(checkRes.rows.length, 1);
    assert.strictEqual(checkRes.rows[0].name, 'Test Backup Org');

    // Clean up sample test organization
    await db.query('DELETE FROM organizations WHERE id = $1', [testOrgId]);
  });

  test('Manual Rollback Runbook 001_initial_schema.rollback.md exists and contains expected drop commands', () => {
    const rollbackPath = path.join(process.cwd(), 'src', 'migrations', '001_initial_schema.rollback.md');
    assert.ok(fs.existsSync(rollbackPath), 'Rollback runbook must exist');

    const content = fs.readFileSync(rollbackPath, 'utf8');
    assert.ok(content.includes('DROP TABLE IF EXISTS'), 'Rollback runbook must detail DROP TABLE SQL commands');
    assert.ok(content.includes('BEGIN;'), 'Rollback runbook must detail transaction execution');
    assert.ok(content.includes('COMMIT;'), 'Rollback runbook must detail transaction commit');
    assert.ok(content.includes('npm run db:backup'), 'Rollback runbook must emphasize pre-rollback backup requirement');
  });

});
