-- AI Finance & Compliance Copilot Schema
-- PostgreSQL Relational DDL with relational integrity, foreign keys, constraints, and auditability

CREATE TABLE IF NOT EXISTS organizations (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    legal_name VARCHAR(255),
    tax_id VARCHAR(50),
    currency VARCHAR(10) DEFAULT 'INR',
    fiscal_year_start VARCHAR(10) DEFAULT '04-01',
    materiality_threshold NUMERIC(15, 2) DEFAULT 50000.00,
    suggest_only_mode BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS materiality_threshold NUMERIC(15, 2) DEFAULT 50000.00;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS suggest_only_mode BOOLEAN DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(50) PRIMARY KEY,
    org_id VARCHAR(50) REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'ca', -- 'ca', 'business_owner', 'admin'
    password_hash VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_organizations (
    user_id VARCHAR(50) REFERENCES users(id) ON DELETE CASCADE,
    org_id VARCHAR(50) REFERENCES organizations(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL DEFAULT 'ca', -- 'ca', 'business_owner', 'admin'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, org_id)
);

CREATE TABLE IF NOT EXISTS chart_of_accounts (
    id VARCHAR(50) PRIMARY KEY,
    org_id VARCHAR(50) REFERENCES organizations(id) ON DELETE CASCADE,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL, -- 'asset', 'liability', 'equity', 'revenue', 'expense'
    sub_type VARCHAR(100), -- 'current_asset', 'fixed_asset', 'operating_expense', 'direct_income', etc.
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_org_code UNIQUE (org_id, code)
);

CREATE TABLE IF NOT EXISTS bank_accounts (
    id VARCHAR(50) PRIMARY KEY,
    org_id VARCHAR(50) REFERENCES organizations(id) ON DELETE CASCADE,
    account_name VARCHAR(255) NOT NULL,
    account_number_mask VARCHAR(50) NOT NULL,
    bank_name VARCHAR(255) NOT NULL,
    currency VARCHAR(10) DEFAULT 'INR',
    opening_balance NUMERIC(15, 2) DEFAULT 0.00,
    current_balance NUMERIC(15, 2) DEFAULT 0.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vendors (
    id VARCHAR(50) PRIMARY KEY,
    org_id VARCHAR(50) REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    tax_id VARCHAR(50),
    email VARCHAR(255),
    default_category_id VARCHAR(50) REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customers (
    id VARCHAR(50) PRIMARY KEY,
    org_id VARCHAR(50) REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    tax_id VARCHAR(50),
    email VARCHAR(255),
    default_category_id VARCHAR(50) REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS documents (
    id VARCHAR(50) PRIMARY KEY,
    org_id VARCHAR(50) REFERENCES organizations(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    file_type VARCHAR(50) NOT NULL, -- 'bank_statement', 'sales_invoices', 'vendor_bills'
    file_size INTEGER DEFAULT 0,
    status VARCHAR(50) DEFAULT 'uploaded', -- 'uploaded', 'processing', 'processed', 'error'
    row_count INTEGER DEFAULT 0,
    uploaded_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transactions (
    id VARCHAR(50) PRIMARY KEY,
    org_id VARCHAR(50) REFERENCES organizations(id) ON DELETE CASCADE,
    bank_account_id VARCHAR(50) REFERENCES bank_accounts(id) ON DELETE SET NULL,
    document_id VARCHAR(50) REFERENCES documents(id) ON DELETE SET NULL,
    date DATE NOT NULL,
    description TEXT NOT NULL,
    raw_description TEXT,
    amount NUMERIC(15, 2) NOT NULL, -- Always positive value
    type VARCHAR(20) NOT NULL, -- 'credit' (inflow/receipt) or 'debit' (outflow/payment)
    counterparty VARCHAR(255),
    reference_number VARCHAR(100),
    category_id VARCHAR(50) REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
    categorization_method VARCHAR(50) DEFAULT 'pending', -- 'rule', 'ai', 'manual', 'pending'
    categorization_confidence INTEGER DEFAULT 0, -- 0-100%
    categorization_reasoning TEXT,
    reconciliation_status VARCHAR(50) DEFAULT 'unreconciled', -- 'unreconciled', 'suggested_match', 'reconciled', 'flagged'
    status VARCHAR(50) DEFAULT 'unreconciled', -- alias for reconciliation_status
    is_approved BOOLEAN DEFAULT FALSE,
    approved_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invoices (
    id VARCHAR(50) PRIMARY KEY,
    org_id VARCHAR(50) REFERENCES organizations(id) ON DELETE CASCADE,
    document_id VARCHAR(50) REFERENCES documents(id) ON DELETE SET NULL,
    customer_id VARCHAR(50) REFERENCES customers(id) ON DELETE SET NULL,
    customer_name VARCHAR(255) NOT NULL,
    invoice_number VARCHAR(100) NOT NULL,
    date DATE NOT NULL,
    due_date DATE,
    total_amount NUMERIC(15, 2) NOT NULL,
    tax_amount NUMERIC(15, 2) DEFAULT 0.00,
    status VARCHAR(50) DEFAULT 'unpaid', -- 'unpaid', 'partially_paid', 'paid', 'flagged'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bills (
    id VARCHAR(50) PRIMARY KEY,
    org_id VARCHAR(50) REFERENCES organizations(id) ON DELETE CASCADE,
    document_id VARCHAR(50) REFERENCES documents(id) ON DELETE SET NULL,
    vendor_id VARCHAR(50) REFERENCES vendors(id) ON DELETE SET NULL,
    vendor_name VARCHAR(255) NOT NULL,
    bill_number VARCHAR(100) NOT NULL,
    date DATE NOT NULL,
    due_date DATE,
    total_amount NUMERIC(15, 2) NOT NULL,
    tax_amount NUMERIC(15, 2) DEFAULT 0.00,
    status VARCHAR(50) DEFAULT 'unpaid', -- 'unpaid', 'partially_paid', 'paid', 'flagged'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reconciliation_records (
    id VARCHAR(50) PRIMARY KEY,
    org_id VARCHAR(50) REFERENCES organizations(id) ON DELETE CASCADE,
    transaction_id VARCHAR(50) REFERENCES transactions(id) ON DELETE CASCADE,
    matched_entity_type VARCHAR(50) NOT NULL, -- 'invoice', 'bill'
    matched_entity_id VARCHAR(50) NOT NULL,
    match_confidence INTEGER NOT NULL, -- 0-100%
    match_reasoning TEXT NOT NULL,
    status VARCHAR(50) DEFAULT 'suggested', -- 'suggested', 'approved', 'rejected', 'manual'
    reviewed_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exceptions (
    id VARCHAR(50) PRIMARY KEY,
    org_id VARCHAR(50) REFERENCES organizations(id) ON DELETE CASCADE,
    entity_type VARCHAR(50) NOT NULL, -- 'transaction', 'invoice', 'bill'
    entity_id VARCHAR(50) NOT NULL,
    exception_type VARCHAR(100) NOT NULL, -- 'duplicate_invoice', 'exact_amount_duplicate', 'missing_required_fields', 'amount_mismatch', 'unreconciled_threshold'
    severity VARCHAR(20) NOT NULL DEFAULT 'medium', -- 'critical', 'high', 'medium', 'low'
    explanation TEXT NOT NULL,
    status VARCHAR(50) DEFAULT 'open', -- 'open', 'resolved', 'dismissed'
    resolved_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolution_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS categorization_rules (
    id VARCHAR(50) PRIMARY KEY,
    org_id VARCHAR(50) REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    pattern VARCHAR(255) NOT NULL, -- regex or substring pattern
    match_field VARCHAR(50) DEFAULT 'description', -- 'description', 'counterparty', 'both'
    category_id VARCHAR(50) REFERENCES chart_of_accounts(id) ON DELETE CASCADE,
    confidence INTEGER DEFAULT 100,
    priority INTEGER DEFAULT 1,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS approvals (
    id VARCHAR(50) PRIMARY KEY,
    org_id VARCHAR(50) REFERENCES organizations(id) ON DELETE CASCADE,
    entity_type VARCHAR(100) NOT NULL, -- 'transaction_categorization', 'reconciliation_match', 'exception_resolution'
    entity_id VARCHAR(50) NOT NULL,
    user_id VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
    user_name VARCHAR(255) NOT NULL,
    decision VARCHAR(50) NOT NULL, -- 'approved', 'rejected', 'overridden'
    decision_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id VARCHAR(50) PRIMARY KEY,
    org_id VARCHAR(50) REFERENCES organizations(id) ON DELETE CASCADE,
    user_id VARCHAR(50),
    user_name VARCHAR(255) NOT NULL,
    action VARCHAR(100) NOT NULL, -- 'APPROVE_CATEGORIZATION', 'REJECT_CATEGORIZATION', 'OVERRIDE_CATEGORY', 'APPROVE_MATCH', 'REJECT_MATCH', 'RESOLVE_EXCEPTION', 'IMPORT_DATA'
    entity_type VARCHAR(50) NOT NULL,
    entity_id VARCHAR(50) NOT NULL,
    before_state JSONB,
    after_state JSONB,
    explanation TEXT NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indices for rapid reconciliation, review filtering, and query execution
CREATE INDEX IF NOT EXISTS idx_transactions_org_date ON transactions(org_id, date);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(org_id, status);
CREATE INDEX IF NOT EXISTS idx_transactions_approved ON transactions(org_id, is_approved);
CREATE INDEX IF NOT EXISTS idx_invoices_org_status ON invoices(org_id, status);
CREATE INDEX IF NOT EXISTS idx_bills_org_status ON bills(org_id, status);
CREATE INDEX IF NOT EXISTS idx_exceptions_org_status ON exceptions(org_id, status);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(org_id, timestamp DESC);

-- ── Milestone 12: Compliance Calendar ────────────────────────────────────────
-- Tracks Indian statutory filings: GST, TDS, Advance Tax, ROC.
-- Designed with clean interfaces for future GSTN / Traces API integration.
CREATE TABLE IF NOT EXISTS compliance_filings (
    id VARCHAR(50) PRIMARY KEY,
    org_id VARCHAR(50) REFERENCES organizations(id) ON DELETE CASCADE,
    filing_type VARCHAR(50) NOT NULL,
    -- e.g. 'GSTR1', 'GSTR3B', 'TDS_RETURN_26Q', 'TDS_DEPOSIT',
    --      'ADVANCE_TAX_Q1', 'ADVANCE_TAX_Q2', 'ADVANCE_TAX_Q3', 'ADVANCE_TAX_Q4',
    --      'INCOME_TAX_RETURN', 'ROC_AOC4', 'ROC_MGT7'
    period VARCHAR(20) NOT NULL,          -- e.g. '2024-03', '2024-Q1', '2024-25'
    due_date DATE NOT NULL,
    assigned_ca VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'upcoming',
    -- 'upcoming' | 'pending_review' | 'approved' | 'filed' | 'overdue'
    reference_ack_number VARCHAR(100),    -- Acknowledgement number after filing
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_compliance_org_due ON compliance_filings(org_id, due_date ASC);
CREATE INDEX IF NOT EXISTS idx_compliance_org_status ON compliance_filings(org_id, status);

-- ─── GSTR-2B Input Tax Credit (ITC) Entries ─────────────────────────────────
-- Auto-populated supplier credit data fetched/uploaded from the GSTN portal.
-- Used to reconcile purchase invoices (bills) against ITC available per GSTR-2B.
CREATE TABLE IF NOT EXISTS gstr2b_entries (
    id VARCHAR(80) PRIMARY KEY,
    org_id VARCHAR(50) REFERENCES organizations(id) ON DELETE CASCADE,
    period VARCHAR(20) NOT NULL,                -- e.g. '2024-10' (YYYY-MM)
    supplier_gstin VARCHAR(20) NOT NULL,
    supplier_name VARCHAR(255) NOT NULL,
    invoice_number VARCHAR(100) NOT NULL,
    invoice_date DATE NOT NULL,
    invoice_value NUMERIC(15, 2) NOT NULL,      -- Total invoice value (incl. taxes)
    taxable_value NUMERIC(15, 2) NOT NULL DEFAULT 0,
    igst NUMERIC(15, 2) NOT NULL DEFAULT 0,
    cgst NUMERIC(15, 2) NOT NULL DEFAULT 0,
    sgst NUMERIC(15, 2) NOT NULL DEFAULT 0,
    total_tax NUMERIC(15, 2) GENERATED ALWAYS AS (igst + cgst + sgst) STORED,
    itc_available BOOLEAN DEFAULT TRUE,         -- FALSE if supplier non-filer / blocked
    source VARCHAR(30) NOT NULL DEFAULT 'portal', -- 'portal' | 'upload'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_gstr2b_org_period ON gstr2b_entries(org_id, period);
CREATE INDEX IF NOT EXISTS idx_gstr2b_supplier_inv ON gstr2b_entries(org_id, supplier_gstin, invoice_number);
