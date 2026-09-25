-- Migration 007: GSTR-2B Import Idempotency Constraint and ITC Ineligibility Fields
-- AI Finance & Compliance Copilot
--
-- 1. Adds itc_ineligible_reason column to store Section 17(5) / POS blocked credit reasons.
-- 2. Adds UNIQUE constraint on (org_id, period, supplier_gstin, invoice_number)
--    to guarantee database-level idempotency for GST portal JSON and Excel uploads.
--
-- Manual rollback: see 007_gstr2b_unique_constraint_and_itc_fields.rollback.md

-- ─── 1. ITC Ineligibility Reason Column ────────────────────────────────────────
ALTER TABLE gstr2b_entries ADD COLUMN IF NOT EXISTS itc_ineligible_reason TEXT;

-- ─── 2. Unique Constraint for Import Idempotency ──────────────────────────────
ALTER TABLE gstr2b_entries DROP CONSTRAINT IF EXISTS uq_gstr2b_org_period_supplier_inv;
ALTER TABLE gstr2b_entries
    ADD CONSTRAINT uq_gstr2b_org_period_supplier_inv
    UNIQUE (org_id, period, supplier_gstin, invoice_number);
