# Rollback Guide: Migration 004 — TDS Review Trail, Thresholds, and Section 393 Draft Mappings

## Overview
Migration `004_tds_review_trail_and_thresholds.sql` introduces:
- Review trail columns `source_citation`, `reviewed_by` (FK to `users`), and `reviewed_at` on `statutory_tds_rules`.
- Check constraint `chk_statutory_rule_approval` requiring reviewer and timestamp on approved rules.
- Baseline source citations for 1961 Act rules (all left in `draft` status).
- Finance Act 2025 amended threshold rules in `draft` status.
- Section 393 framework rules in `draft` status with primary source URLs (`https://incometaxindia.gov.in`).

---

## Manual Rollback Steps

```sql
-- 1. Remove draft Section 393 rows and FA 2025 rows
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

-- 2. Drop CHECK constraint
ALTER TABLE statutory_tds_rules DROP CONSTRAINT IF EXISTS chk_statutory_rule_approval;

-- 3. Drop columns
ALTER TABLE statutory_tds_rules DROP COLUMN IF EXISTS source_citation;
ALTER TABLE statutory_tds_rules DROP COLUMN IF EXISTS reviewed_by;
ALTER TABLE statutory_tds_rules DROP COLUMN IF EXISTS reviewed_at;

-- 4. Delete migration tracking record
DELETE FROM _migrations WHERE name = '004_tds_review_trail_and_thresholds.sql';
```
