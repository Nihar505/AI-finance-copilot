# Rollback Guide: Migration 005 — Statutory Audit Integrity, Non-Fabricated Rules, and Per-Org Acknowledgements

## Overview
Migration `005_statutory_audit_integrity_and_ack.sql` enforces:
1. Resetting statutory rules to `status = 'draft'` with `reviewed_by = NULL` and `reviewed_at = NULL`.
2. Changing `reviewed_by` to `VARCHAR(50)` with a foreign key referencing `users(id)`.
3. Adding CHECK constraint `chk_statutory_rule_approval` ensuring `status = 'approved'` requires `reviewed_by IS NOT NULL` and `reviewed_at IS NOT NULL`.
4. Creating `org_statutory_acknowledgements` table to separate tenant-level adoption from global platform-admin rule approval.
5. Grounding Section 393 draft citations with official primary URLs (`https://incometaxindia.gov.in`).

---

## Manual Rollback Steps

If manual rollback is strictly necessary in a disaster recovery scenario:

```sql
-- 1. Drop per-org acknowledgement table
DROP TABLE IF EXISTS org_statutory_acknowledgements CASCADE;

-- 2. Drop CHECK constraint on statutory_tds_rules
ALTER TABLE statutory_tds_rules DROP CONSTRAINT IF EXISTS chk_statutory_rule_approval;

-- 3. Drop Foreign Key constraint on reviewed_by
ALTER TABLE statutory_tds_rules DROP CONSTRAINT IF EXISTS fk_statutory_rules_reviewed_by;

-- 4. Revert reviewed_by column type
ALTER TABLE statutory_tds_rules ALTER COLUMN reviewed_by TYPE VARCHAR(100);

-- 5. Remove migration tracking record
DELETE FROM _migrations WHERE name = '005_statutory_audit_integrity_and_ack.sql';
```

---

## Verification After Rollback
```sql
SELECT table_name FROM information_schema.tables WHERE table_name = 'org_statutory_acknowledgements';
-- Should return 0 rows.

SELECT constraint_name FROM information_schema.table_constraints
WHERE table_name = 'statutory_tds_rules' AND constraint_name IN ('chk_statutory_rule_approval', 'fk_statutory_rules_reviewed_by');
-- Should return 0 rows.
```
