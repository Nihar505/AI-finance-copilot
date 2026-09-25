# Migration 007 Rollback Guide: GSTR-2B Import Idempotency Constraint and ITC Ineligibility Fields

**Migration file**: `src/migrations/007_gstr2b_unique_constraint_and_itc_fields.sql`  
**Purpose**: Adds `gstr2b_entries.itc_ineligible_reason` and unique constraint `uq_gstr2b_org_period_supplier_inv`.

---

## Rollback Procedure (Manual Execution)

Connect to the PostgreSQL database with an administrative user:

```bash
psql -d finance_copilot -U postgres
```

Execute the following commands:

```sql
BEGIN;

-- 1. Drop unique constraint
ALTER TABLE gstr2b_entries DROP CONSTRAINT IF EXISTS uq_gstr2b_org_period_supplier_inv;

-- 2. Drop added column
ALTER TABLE gstr2b_entries DROP COLUMN IF EXISTS itc_ineligible_reason;

-- 3. Remove migration tracking record
DELETE FROM _migrations WHERE name = '007_gstr2b_unique_constraint_and_itc_fields.sql';

COMMIT;
```

---

## Verification After Rollback

```sql
SELECT constraint_name 
FROM information_schema.table_constraints 
WHERE table_name = 'gstr2b_entries' AND constraint_name = 'uq_gstr2b_org_period_supplier_inv';
-- Expected: 0 rows

SELECT name FROM _migrations ORDER BY id;
-- Expected: migrations 001 through 006 only
```
