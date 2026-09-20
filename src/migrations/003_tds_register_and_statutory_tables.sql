-- Migration 003: TDS Register, Challans, and Statutory Versioning
-- AI Finance & Compliance Copilot
--
-- Adds:
-- 1. vendors.tds_section and vendors.pan columns
-- 2. organizations.tan and organizations.address columns
-- 3. tds_challans table (deductor-level challan records with BSR and deposit date)
-- 4. tds_challan_allocations table (line-item allocation linking challans to deduction lines)
-- 5. statutory_tds_rules table (versioned legal regimes: 1961 Act vs 2025 Act Section 393 framework)
--
-- Manual rollback: see 003_tds_register_and_statutory_tables.rollback.md

-- ─── 1. Vendor Statutory TDS Attributes ──────────────────────────────────────
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS tds_section VARCHAR(20);
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS pan VARCHAR(10);
CREATE INDEX IF NOT EXISTS idx_vendors_org_tds_sec ON vendors (org_id, tds_section);

-- ─── 2. Organization Deductor Identity ───────────────────────────────────────
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS tan VARCHAR(20);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS address TEXT;

-- ─── 3. Deductor-Level TDS Challans Table ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS tds_challans (
    id VARCHAR(50) PRIMARY KEY,
    org_id VARCHAR(50) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    challan_no VARCHAR(50) NOT NULL,
    bsr_code VARCHAR(10) NOT NULL,
    deposit_date DATE NOT NULL,
    amount NUMERIC(15, 2) NOT NULL CHECK (amount >= 0),
    section VARCHAR(20) NOT NULL,
    quarter VARCHAR(10) NOT NULL,
    financial_year VARCHAR(20) NOT NULL,
    source VARCHAR(20) DEFAULT 'manual', -- 'manual', 'demo', 'portal'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_tds_challans UNIQUE (org_id, challan_no, bsr_code, deposit_date)
);
CREATE INDEX IF NOT EXISTS idx_tds_challans_org_period ON tds_challans (org_id, section, quarter, financial_year);

-- ─── 4. TDS Challan Allocations Table (Line-Item Attribution) ────────────────
CREATE TABLE IF NOT EXISTS tds_challan_allocations (
    id VARCHAR(50) PRIMARY KEY,
    org_id VARCHAR(50) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    challan_id VARCHAR(50) NOT NULL REFERENCES tds_challans(id) ON DELETE CASCADE,
    deduction_line_id VARCHAR(100) NOT NULL,
    allocated_amount NUMERIC(15, 2) NOT NULL CHECK (allocated_amount >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_tds_challan_allocation UNIQUE (challan_id, deduction_line_id)
);
CREATE INDEX IF NOT EXISTS idx_tds_challan_alloc_line ON tds_challan_allocations (org_id, deduction_line_id);

-- ─── 5. Versioned Statutory TDS Rules Table ──────────────────────────────────
CREATE TABLE IF NOT EXISTS statutory_tds_rules (
    id VARCHAR(50) PRIMARY KEY,
    legal_regime VARCHAR(50) NOT NULL, -- 'IT_ACT_1961' | 'IT_ACT_2025'
    section VARCHAR(50),               -- NULL for 2025 Act until CA review
    payment_code VARCHAR(50),          -- NULL for 2025 Act until CA review
    description TEXT NOT NULL,
    effective_from DATE NOT NULL,
    effective_to DATE,
    rate NUMERIC(5, 2),                -- NULL for 2025 Act until CA review
    threshold_single NUMERIC(15, 2),
    threshold_aggregate NUMERIC(15, 2),
    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE', 'SUPERSEDED', 'NEEDS_CA_REVIEW'
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_statutory_rules_regime ON statutory_tds_rules (legal_regime, effective_from);

-- ─── 6. Seed Baseline Statutory TDS Rules ────────────────────────────────────
INSERT INTO statutory_tds_rules (id, legal_regime, section, payment_code, description, effective_from, effective_to, rate, threshold_single, threshold_aggregate, status, notes)
VALUES
    ('rule-1961-194c', 'IT_ACT_1961', '194C', '94C', 'Payments to Contractors and Sub-contractors', '1961-04-01', '2026-03-31', 2.00, 30000.00, 100000.00, 'ACTIVE', 'Standard 2% for corporate/firm contractors.'),
    ('rule-1961-194ja', 'IT_ACT_1961', '194J(a)', '94J', 'Fees for Technical Services (FTS) and Call Centers', '2020-04-01', '2026-03-31', 2.00, 30000.00, 30000.00, 'ACTIVE', 'Finance Act 2020 reduced FTS rate to 2% regardless of entity type.'),
    ('rule-1961-194jb', 'IT_ACT_1961', '194J(b)', '94J', 'Fees for Professional Services and Royalty', '1995-07-01', '2026-03-31', 10.00, 30000.00, 30000.00, 'ACTIVE', 'Standard 10% rate for professional advisory.'),
    ('rule-1961-194i', 'IT_ACT_1961', '194I', '94I', 'Rent for Land, Building, or Office Furniture', '1994-06-01', '2026-03-31', 10.00, 240000.00, 240000.00, 'ACTIVE', '10% on land/building rent.'),
    ('rule-1961-194h-pre2024', 'IT_ACT_1961', '194H', '94H', 'Commission or Brokerage (Pre-Oct 2024)', '2001-06-01', '2024-09-30', 5.00, 15000.00, 15000.00, 'SUPERSEDED', 'Historical 5% statutory rate in force until 2024-09-30.'),
    ('rule-1961-194h-post2024', 'IT_ACT_1961', '194H', '94H', 'Commission or Brokerage (Post-Oct 2024)', '2024-10-01', '2026-03-31', 2.00, 15000.00, 15000.00, 'ACTIVE', 'Finance Act 2024 reduced rate to 2% w.e.f. October 1, 2024.'),
    ('rule-1961-194q', 'IT_ACT_1961', '194Q', '94Q', 'Payment on Purchase of Goods (> ₹50L aggregate)', '2021-07-01', '2026-03-31', 0.10, 5000000.00, 5000000.00, 'ACTIVE', '0.1% TDS on purchase value exceeding ₹50 Lakhs.'),
    ('rule-2025-sec393-framework', 'IT_ACT_2025', NULL, NULL, 'Income-tax Act 2025 Section 393 Withholding Framework', '2026-04-01', NULL, NULL, NULL, NULL, 'NEEDS_CA_REVIEW', 'New simplified withholding framework under Section 393 of the Income-tax Act 2025. Statutory mapping pending CA review.')
ON CONFLICT (id) DO NOTHING;
