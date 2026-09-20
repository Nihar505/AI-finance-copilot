# Rollback Procedure: Migration 003

**Migration file**: `src/migrations/003_tds_register_and_statutory_tables.sql`  
**Target Tables**: `tds_challan_allocations`, `tds_challans`, `statutory_tds_rules`, `vendors`, `organizations`

---

## Rollback SQL Script

Execute the following DDL statements against PostgreSQL to revert Migration 003:

```sql
BEGIN;

-- 1. Drop statutory TDS rules table
DROP TABLE IF EXISTS statutory_tds_rules CASCADE;

-- 2. Drop TDS challan allocations table
DROP TABLE IF EXISTS tds_challan_allocations CASCADE;

-- 3. Drop TDS challans table
DROP TABLE IF EXISTS tds_challans CASCADE;

-- 4. Remove added columns from organizations
ALTER TABLE organizations DROP COLUMN IF EXISTS tan;
ALTER TABLE organizations DROP COLUMN IF EXISTS address;

-- 5. Remove added columns from vendors
DROP INDEX IF EXISTS idx_vendors_org_tds_sec;
ALTER TABLE vendors DROP COLUMN IF EXISTS tds_section;
ALTER TABLE vendors DROP COLUMN IF EXISTS pan;

-- 6. Unregister migration from tracking table
DELETE FROM _migrations WHERE name = '003_tds_register_and_statutory_tables.sql';

COMMIT;
```

---

## Verification After Rollback

```sql
SELECT column_name FROM information_schema.columns WHERE table_name = 'vendors' AND column_name IN ('tds_section', 'pan');
-- Expected: 0 rows

SELECT table_name FROM information_schema.tables WHERE table_name IN ('tds_challans', 'tds_challan_allocations', 'statutory_tds_rules');
-- Expected: 0 rows
```
