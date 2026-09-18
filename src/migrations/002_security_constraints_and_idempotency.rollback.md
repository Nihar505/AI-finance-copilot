# Rollback Procedure: Migration 002

**Migration:** `002_security_constraints_and_idempotency.sql`  
**Author:** Antigravity Engineering Architecture Team  
**Date:** 2026-09-17  

---

## Purpose
Migration 002 introduced:
1. `documents.file_hash` SHA-256 idempotency tracking column and composite index.
2. Unique composite indexes `uq_org_invoice_number` and `uq_org_bill_number`.
3. Financial integrity check constraints (`chk_transactions_amount_pos`, `chk_transactions_type_valid`, `chk_invoices_amount_pos`, `chk_bills_amount_pos`).
4. Performance indexes on `transactions` and `reconciliation_records`.
5. Persistent `tds_signoffs` table.

---

## Manual Rollback SQL

Run the following SQL commands in an administrative PostgreSQL connection if you must revert Migration 002:

```sql
BEGIN;

-- 1. Drop TDS sign-offs table
DROP TABLE IF EXISTS tds_signoffs CASCADE;

-- 2. Drop multi-tenant performance indexes
DROP INDEX IF EXISTS idx_reconciliation_records_org_tx;
DROP INDEX IF EXISTS idx_transactions_org_rec_status;
DROP INDEX IF EXISTS idx_transactions_org_date;

-- 3. Drop check constraints
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS chk_transactions_amount_pos;
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS chk_transactions_type_valid;
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS chk_invoices_amount_pos;
ALTER TABLE bills DROP CONSTRAINT IF EXISTS chk_bills_amount_pos;

-- 4. Drop unique business key indexes
DROP INDEX IF EXISTS uq_org_bill_number;
DROP INDEX IF EXISTS uq_org_invoice_number;

-- 5. Drop documents file hash index and column
DROP INDEX IF EXISTS idx_documents_org_file_hash;
ALTER TABLE documents DROP COLUMN IF EXISTS file_hash;

-- 6. Remove migration record from tracking table
DELETE FROM _migrations WHERE name = '002_security_constraints_and_idempotency.sql';

COMMIT;
```

---

## Verification After Rollback
Run:
```sql
SELECT name FROM _migrations ORDER BY id;
```
Confirm `002_security_constraints_and_idempotency.sql` is no longer present.
