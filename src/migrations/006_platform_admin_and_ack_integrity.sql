-- Migration 006: Platform Admin Authorization, Rule Integrity, and Acknowledgement Versioning
-- AI Finance & Compliance Copilot
--
-- 1. Adds is_platform_admin column to users table (default FALSE, zero platform admins granted in migration).
-- 2. Adds threshold_not_applicable column to statutory_tds_rules.
-- 3. Updates chk_statutory_rule_approval CHECK constraint:
--    Approved rules MUST have non-null rate and thresholds, unless threshold_not_applicable = TRUE.
-- 4. Adds rule_version_hash, attestation_text, and invalidated_at to org_statutory_acknowledgements.
-- 5. Backfills rule_version_hash and attestation_text on existing acknowledgement rows.
-- 6. Trigger to automatically invalidate acknowledgements when rule thresholds/rate/section change.
-- 7. Nullifies unconfirmed Section 393 fields (payment codes, copied thresholds, unconfirmed Sl. Nos., and unretrieved citations).
--
-- Manual rollback: see 006_platform_admin_and_ack_integrity.rollback.md

-- ─── 1. Platform Admin Role on Users ──────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN DEFAULT FALSE NOT NULL;

-- ─── 2. Threshold Not Applicable Flag on Statutory Rules ──────────────────────
ALTER TABLE statutory_tds_rules ADD COLUMN IF NOT EXISTS threshold_not_applicable BOOLEAN DEFAULT FALSE NOT NULL;

-- ─── 3. Strict Approval Constraint on Statutory TDS Rules ─────────────────────
ALTER TABLE statutory_tds_rules DROP CONSTRAINT IF EXISTS chk_statutory_rule_approval;
ALTER TABLE statutory_tds_rules
    ADD CONSTRAINT chk_statutory_rule_approval
    CHECK (
        (status = 'approved' 
         AND reviewed_by IS NOT NULL 
         AND reviewed_at IS NOT NULL 
         AND rate IS NOT NULL 
         AND ((threshold_single IS NOT NULL AND threshold_aggregate IS NOT NULL) OR threshold_not_applicable = TRUE))
        OR (status != 'approved')
    );

-- ─── 4. Acknowledgement Versioning & Attestation ──────────────────────────────
ALTER TABLE org_statutory_acknowledgements ADD COLUMN IF NOT EXISTS rule_version_hash VARCHAR(64) DEFAULT '0000000000000000000000000000000000000000000000000000000000000000';
ALTER TABLE org_statutory_acknowledgements ADD COLUMN IF NOT EXISTS attestation_text TEXT DEFAULT 'Legacy acknowledgement migrated without explicit attestation.';
ALTER TABLE org_statutory_acknowledgements ADD COLUMN IF NOT EXISTS invalidated_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE org_statutory_acknowledgements ALTER COLUMN rule_version_hash SET DEFAULT '0000000000000000000000000000000000000000000000000000000000000000';
ALTER TABLE org_statutory_acknowledgements ALTER COLUMN attestation_text SET DEFAULT 'Legacy acknowledgement migrated without explicit attestation.';

-- ─── 5. Backfill Existing Acknowledgements ────────────────────────────────────
UPDATE org_statutory_acknowledgements
SET rule_version_hash = COALESCE(rule_version_hash, '0000000000000000000000000000000000000000000000000000000000000000'),
    attestation_text = COALESCE(attestation_text, 'Legacy acknowledgement migrated without explicit attestation.')
WHERE rule_version_hash IS NULL OR attestation_text IS NULL;

-- ─── 6. Auto-Invalidation Trigger on Rule Change ──────────────────────────────
CREATE OR REPLACE FUNCTION trg_invalidate_org_statutory_acknowledgements()
RETURNS TRIGGER AS $$
BEGIN
    IF (OLD.rate IS DISTINCT FROM NEW.rate OR
        OLD.threshold_single IS DISTINCT FROM NEW.threshold_single OR
        OLD.threshold_aggregate IS DISTINCT FROM NEW.threshold_aggregate OR
        OLD.section IS DISTINCT FROM NEW.section OR
        OLD.legal_regime IS DISTINCT FROM NEW.legal_regime OR
        OLD.effective_from IS DISTINCT FROM NEW.effective_from OR
        OLD.threshold_not_applicable IS DISTINCT FROM NEW.threshold_not_applicable) THEN
        UPDATE org_statutory_acknowledgements
        SET invalidated_at = CURRENT_TIMESTAMP
        WHERE rule_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_statutory_rules_invalidate_acks ON statutory_tds_rules;
CREATE TRIGGER trg_statutory_rules_invalidate_acks
AFTER UPDATE ON statutory_tds_rules
FOR EACH ROW
EXECUTE FUNCTION trg_invalidate_org_statutory_acknowledgements();

-- ─── 7. Section 393 Unconfirmed Fields Cleanup ────────────────────────────────
-- All payment codes were unconfirmed in primary source gazette -> NULL
-- Sl. Nos. for commission and goods were unconfirmed -> NULL
-- Thresholds copied from 1961 Act without confirmation -> NULL
-- Primary deep link could not be retrieved -> source_citation = NULL
UPDATE statutory_tds_rules
SET payment_code = NULL,
    threshold_single = NULL,
    threshold_aggregate = NULL,
    source_citation = NULL,
    status = 'draft',
    reviewed_by = NULL,
    reviewed_at = NULL
WHERE legal_regime = 'IT_ACT_2025';

UPDATE statutory_tds_rules
SET section = NULL
WHERE id IN ('rule-2025-sec393-commission', 'rule-2025-sec393-goods', 'rule-2025-sec393-framework');
