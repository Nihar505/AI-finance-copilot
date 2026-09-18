-- Migration 002: Security constraints, financial validation, and upload idempotency
-- AI Finance & Compliance Copilot
--
-- Adds:
-- 1. documents.file_hash (SHA-256) column and index for deduplicated, idempotent uploads
-- 2. Unique composite constraint on invoices (org_id, invoice_number)
-- 3. Unique composite constraint on bills (org_id, bill_number)
-- 4. Check constraints ensuring positive amounts and valid transaction types
-- 5. Performance indexes for multi-tenant query acceleration
-- 6. Persistent tds_signoffs table for CA statutory Form 16A sign-offs
--
-- Manual rollback: see 002_security_constraints_and_idempotency.rollback.md

-- ─── 1. Documents Idempotency Tracking ──────────────────────────────────────
ALTER TABLE documents ADD COLUMN IF NOT EXISTS file_hash VARCHAR(64);
CREATE INDEX IF NOT EXISTS idx_documents_org_file_hash ON documents (org_id, file_hash);

-- ─── 2. Invoices & Bills Unique Business Key Constraints ─────────────────────
DELETE FROM invoices a USING invoices b
WHERE a.id > b.id
  AND a.org_id = b.org_id
  AND a.invoice_number = b.invoice_number;

DELETE FROM bills a USING bills b
WHERE a.id > b.id
  AND a.org_id = b.org_id
  AND a.bill_number = b.bill_number;

CREATE UNIQUE INDEX IF NOT EXISTS uq_org_invoice_number ON invoices (org_id, invoice_number);
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_bill_number ON bills (org_id, bill_number);

-- ─── 3. Financial Integrity Check Constraints ───────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_transactions_amount_pos') THEN
        ALTER TABLE transactions ADD CONSTRAINT chk_transactions_amount_pos CHECK (amount >= 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_transactions_type_valid') THEN
        ALTER TABLE transactions ADD CONSTRAINT chk_transactions_type_valid CHECK (type IN ('credit', 'debit'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_invoices_amount_pos') THEN
        ALTER TABLE invoices ADD CONSTRAINT chk_invoices_amount_pos CHECK (total_amount >= 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_bills_amount_pos') THEN
        ALTER TABLE bills ADD CONSTRAINT chk_bills_amount_pos CHECK (total_amount >= 0);
    END IF;
END $$;

-- ─── 4. High-Performance Multi-Tenant Indexes ────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_transactions_org_date ON transactions (org_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_org_rec_status ON transactions (org_id, reconciliation_status);
CREATE INDEX IF NOT EXISTS idx_reconciliation_records_org_tx ON reconciliation_records (org_id, transaction_id);

-- ─── 5. Persistent TDS Sign-offs Table ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS tds_signoffs (
    id VARCHAR(100) PRIMARY KEY,
    org_id VARCHAR(50) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    cert_id VARCHAR(100) NOT NULL,
    signed_by VARCHAR(100) NOT NULL,
    signed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_tds_signoffs_org_cert UNIQUE (org_id, cert_id)
);
CREATE INDEX IF NOT EXISTS idx_tds_signoffs_org ON tds_signoffs (org_id);
