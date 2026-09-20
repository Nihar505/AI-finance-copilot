-- Migration 005: Statutory Audit Integrity, Non-Fabricated Rules, and Per-Org Acknowledgements
-- AI Finance & Compliance Copilot
--
-- 1. Resets all seeded/migrated statutory rules to status='draft', reviewed_by=NULL, reviewed_at=NULL.
-- 2. Changes reviewed_by to VARCHAR(50) and adds foreign key referencing users(id).
-- 3. Adds CHECK constraint chk_statutory_rule_approval:
--    status='approved' requires reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL.
-- 4. Creates org_statutory_acknowledgements table for tenant-level adoption/acknowledgement.
-- 5. Updates Section 393 draft citations with official primary URLs (https://incometaxindia.gov.in).
--
-- Manual rollback: see 005_statutory_audit_integrity_and_ack.rollback.md

-- ─── 1. Reset Fabricated Approvals ──────────────────────────────────────────
UPDATE statutory_tds_rules
SET status = 'draft',
    reviewed_by = NULL,
    reviewed_at = NULL;

-- ─── 2. Foreign Key to Users Table for reviewed_by ──────────────────────────
ALTER TABLE statutory_tds_rules ALTER COLUMN reviewed_by TYPE VARCHAR(50);
ALTER TABLE statutory_tds_rules DROP CONSTRAINT IF EXISTS fk_statutory_rules_reviewed_by;
ALTER TABLE statutory_tds_rules
    ADD CONSTRAINT fk_statutory_rules_reviewed_by
    FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL;

-- ─── 3. CHECK Constraint on Rule Approval ────────────────────────────────────
ALTER TABLE statutory_tds_rules DROP CONSTRAINT IF EXISTS chk_statutory_rule_approval;
ALTER TABLE statutory_tds_rules
    ADD CONSTRAINT chk_statutory_rule_approval
    CHECK ((status = 'approved' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL) OR (status != 'approved'));

-- ─── 4. Per-Organization Statutory Acknowledgement Table ─────────────────────
CREATE TABLE IF NOT EXISTS org_statutory_acknowledgements (
    id VARCHAR(50) PRIMARY KEY,
    org_id VARCHAR(50) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    rule_id VARCHAR(50) NOT NULL REFERENCES statutory_tds_rules(id) ON DELETE CASCADE,
    acknowledged_by VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    acknowledged_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    notes TEXT,
    CONSTRAINT uq_org_rule_ack UNIQUE (org_id, rule_id)
);
CREATE INDEX IF NOT EXISTS idx_org_stat_ack ON org_statutory_acknowledgements (org_id, rule_id);

-- ─── 5. Update Section 393 Citations with Primary Sources ───────────────────
UPDATE statutory_tds_rules
SET source_citation = 'https://incometaxindia.gov.in; Income-tax Act, 2025, Section 393(1) Table, Sl. No. 6(i). Payment code unconfirmed in primary source gazette.',
    status = 'draft',
    reviewed_by = NULL,
    reviewed_at = NULL
WHERE id = 'rule-2025-sec393-contractor';

UPDATE statutory_tds_rules
SET source_citation = 'https://incometaxindia.gov.in; Income-tax Act, 2025, Section 393(1) Table, Sl. No. 6(iii). Payment code unconfirmed in primary source gazette.',
    status = 'draft',
    reviewed_by = NULL,
    reviewed_at = NULL
WHERE id = 'rule-2025-sec393-fts';

UPDATE statutory_tds_rules
SET source_citation = 'https://incometaxindia.gov.in; Income-tax Act, 2025, Section 393(1) Table, Sl. No. 6(iii). Payment code unconfirmed in primary source gazette.',
    status = 'draft',
    reviewed_by = NULL,
    reviewed_at = NULL
WHERE id = 'rule-2025-sec393-prof';

UPDATE statutory_tds_rules
SET source_citation = 'https://incometaxindia.gov.in; Income-tax Act, 2025, Section 393(1) Table, Sl. No. 2(ii). Payment code unconfirmed in primary source gazette.',
    status = 'draft',
    reviewed_by = NULL,
    reviewed_at = NULL
WHERE id = 'rule-2025-sec393-rent';

UPDATE statutory_tds_rules
SET source_citation = 'https://incometaxindia.gov.in; Income-tax Act, 2025, Section 393(1) Table. Exact serial and payment code unconfirmed in primary source gazette.',
    status = 'draft',
    reviewed_by = NULL,
    reviewed_at = NULL
WHERE id = 'rule-2025-sec393-commission';

UPDATE statutory_tds_rules
SET source_citation = 'https://incometaxindia.gov.in; Income-tax Act, 2025, Section 393(1) Table. Exact serial and payment code unconfirmed in primary source gazette.',
    status = 'draft',
    reviewed_by = NULL,
    reviewed_at = NULL
WHERE id = 'rule-2025-sec393-goods';

UPDATE statutory_tds_rules
SET source_citation = 'https://incometaxindia.gov.in; Income-tax Act, 2025, Section 393 framework.',
    status = 'draft',
    reviewed_by = NULL,
    reviewed_at = NULL
WHERE id = 'rule-2025-sec393-framework';
