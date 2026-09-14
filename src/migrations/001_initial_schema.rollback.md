# Rollback Runbook: Migration 001_initial_schema

## Overview
This runbook details the manual rollback protocol for `001_initial_schema.sql`.
Reverting baseline schema operations destroys all persistent relational entities, audit logs, and compliance records.
**WARNING:** Perform a full data backup via `npm run db:backup` before executing any rollback commands in production.

## Prerequisites & Data Preservation
1. Run database backup CLI:
   ```bash
   npm run db:backup -- --output ./backups/pre-rollback-backup.json
   ```
2. Verify backup artifact existence and validity.
3. Confirm database administrative access via PostgreSQL CLI or managed database console.

## Manual SQL Rollback Execution Order
Due to Foreign Key (`REFERENCES ... ON DELETE CASCADE`) relationships, objects must be dropped in exact reverse dependency order.

Run the following SQL script inside a single transaction (`BEGIN ... COMMIT`):

```sql
BEGIN;

-- 1. Drop Migration Tracking Record (if manual unmark required)
DELETE FROM _migrations WHERE id = '001_initial_schema';

-- 2. Drop Secondary / Dependent Tables
DROP TABLE IF EXISTS gstr2b_entries CASCADE;
DROP TABLE IF EXISTS compliance_filings CASCADE;
DROP TABLE IF EXISTS pilot_requests CASCADE;
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS approvals CASCADE;
DROP TABLE IF EXISTS categorization_rules CASCADE;
DROP TABLE IF EXISTS exceptions CASCADE;
DROP TABLE IF EXISTS reconciliation_records CASCADE;
DROP TABLE IF EXISTS bills CASCADE;
DROP TABLE IF EXISTS invoices CASCADE;
DROP TABLE IF EXISTS transactions CASCADE;
DROP TABLE IF EXISTS documents CASCADE;
DROP TABLE IF EXISTS customers CASCADE;
DROP TABLE IF EXISTS vendors CASCADE;
DROP TABLE IF EXISTS bank_accounts CASCADE;
DROP TABLE IF EXISTS chart_of_accounts CASCADE;
DROP TABLE IF EXISTS user_organizations CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS organizations CASCADE;

COMMIT;
```

## Cascade & System Implications
- **Data Loss:** All records across organizations, transactions, invoices, bills, audit trails, and compliance filings will be permanently deleted.
- **Application State:** The web application will fail health checks until `npm run db:migrate` or `001_initial_schema.sql` is re-applied.

## Verification Post-Rollback
Confirm all tables are removed:
```sql
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
```
Expected output: 0 rows (or only system tables).
