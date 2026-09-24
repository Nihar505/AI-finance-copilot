# Migration 006 Rollback Guide: Platform Admin Authorization, Rule Integrity, and Acknowledgement Versioning

**Migration file**: `src/migrations/006_platform_admin_and_ack_integrity.sql`  
**Purpose**: Adds `users.is_platform_admin`, `statutory_tds_rules.threshold_not_applicable`, strengthens `chk_statutory_rule_approval`, adds `rule_version_hash`, `attestation_text`, `invalidated_at` to `org_statutory_acknowledgements`, invalidation trigger, and nullifies unverified Section 393 fields.

---

## Rollback Procedure (Manual Execution)

Connect to the PostgreSQL database with an administrative user:

```bash
psql -d finance_copilot -U postgres
```

Execute the following commands:

```sql
BEGIN;

-- 1. Drop auto-invalidation trigger and function
DROP TRIGGER IF EXISTS trg_statutory_rules_invalidate_acks ON statutory_tds_rules;
DROP FUNCTION IF EXISTS trg_invalidate_org_statutory_acknowledgements();

-- 2. Restore previous CHECK constraint from Migration 005
ALTER TABLE statutory_tds_rules DROP CONSTRAINT IF EXISTS chk_statutory_rule_approval;
ALTER TABLE statutory_tds_rules
    ADD CONSTRAINT chk_statutory_rule_approval
    CHECK ((status = 'approved' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL) OR (status != 'approved'));

-- 3. Drop added columns on statutory_tds_rules
ALTER TABLE statutory_tds_rules DROP COLUMN IF EXISTS threshold_not_applicable;

-- 4. Drop added columns on org_statutory_acknowledgements
ALTER TABLE org_statutory_acknowledgements DROP COLUMN IF EXISTS rule_version_hash;
ALTER TABLE org_statutory_acknowledgements DROP COLUMN IF EXISTS attestation_text;
ALTER TABLE org_statutory_acknowledgements DROP COLUMN IF EXISTS invalidated_at;

-- 5. Drop added column on users
ALTER TABLE users DROP COLUMN IF EXISTS is_platform_admin;

-- 6. Remove migration record
DELETE FROM _migrations WHERE name = '006_platform_admin_and_ack_integrity.sql';

COMMIT;
```

---

## Verification After Rollback

```sql
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'users' AND column_name = 'is_platform_admin';
-- Expected: 0 rows

SELECT name FROM _migrations ORDER BY id;
-- Expected: migrations 001 through 005 only
```
