# Rollback Procedure for Migration 004: TDS Review Trail, Thresholds, and Section 393 Draft Mappings

## Summary of Changes Made in 004
- Added columns `source_citation`, `reviewed_by`, `reviewed_at` to `statutory_tds_rules`.
- Set default status to `'draft'` on `statutory_tds_rules`.
- Approved 1961 Act baseline rules with primary source citations.
- Inserted Finance Act 2025 amended threshold rules as draft ('NEEDS_CA_REVIEW').
- Inserted Section 393 table draft mapping rules under Income-tax Act, 2025.

## Rollback SQL

```sql
-- 1. Remove draft 2025 Act rules and Finance Act 2025 amended threshold rules
DELETE FROM statutory_tds_rules WHERE id IN (
    'rule-1961-194h-fa2025',
    'rule-1961-194j-fa2025',
    'rule-2025-sec393-contractor',
    'rule-2025-sec393-fts',
    'rule-2025-sec393-prof',
    'rule-2025-sec393-rent',
    'rule-2025-sec393-commission',
    'rule-2025-sec393-goods'
);

-- 2. Reset baseline rows
UPDATE statutory_tds_rules
SET source_citation = NULL,
    reviewed_by = NULL,
    reviewed_at = NULL,
    status = 'ACTIVE'
WHERE legal_regime = 'IT_ACT_1961';

-- 3. Drop added columns
ALTER TABLE statutory_tds_rules DROP COLUMN IF EXISTS source_citation;
ALTER TABLE statutory_tds_rules DROP COLUMN IF EXISTS reviewed_by;
ALTER TABLE statutory_tds_rules DROP COLUMN IF EXISTS reviewed_at;

-- 4. Revert status column default
ALTER TABLE statutory_tds_rules ALTER COLUMN status SET DEFAULT 'ACTIVE';

-- 5. Remove migration record
DELETE FROM _migrations WHERE name = '004_tds_review_trail_and_thresholds.sql';
```
