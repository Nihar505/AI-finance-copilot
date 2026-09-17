-- Migration 001: Initial schema
-- AI Finance & Compliance Copilot
--
-- This is the baseline migration that creates all tables in the database from
-- scratch.  It is equivalent to src/lib/schema.sql but expressed as a
-- versioned, forward-only migration so that subsequent migrations can be
-- applied incrementally.
--
-- Manual rollback: see 001_initial_schema.rollback.md

-- ─── 1. Organizations ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS organizations (
    id                      VARCHAR(50)  PRIMARY KEY,
    name                    VARCHAR(255) NOT NULL,
    legal_name              VARCHAR(255),
    tax_id                  VARCHAR(50),
    currency                VARCHAR(10)  DEFAULT 'INR',
    fiscal_year_start       VARCHAR(10)  DEFAULT '04-01',
    materiality_threshold   NUMERIC(15, 2) DEFAULT 50000.00,
    suggest_only_mode       BOOLEAN      DEFAULT TRUE,
    created_at              TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Idempotent column additions for orgs that existed before these columns
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS materiality_threshold NUMERIC(15, 2) DEFAULT 50000.00;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS suggest_only_mode BOOLEAN DEFAULT TRUE;

-- ─── 2. Users ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id            VARCHAR(50)  PRIMARY KEY,
    org_id        VARCHAR(50)  REFERENCES organizations(id) ON DELETE CASCADE,
    name          VARCHAR(255) NOT NULL,
    email         VARCHAR(255) UNIQUE NOT NULL,
    role          VARCHAR(50)  NOT NULL DEFAULT 'ca',  -- 'ca', 'business_owner', 'admin'
    password_hash VARCHAR(255) NOT NULL,
    is_active     BOOLEAN      DEFAULT TRUE,
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ─── 3. User–Organization join ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_organizations (
    user_id    VARCHAR(50) REFERENCES users(id) ON DELETE CASCADE,
    org_id     VARCHAR(50) REFERENCES organizations(id) ON DELETE CASCADE,
    role       VARCHAR(50) NOT NULL DEFAULT 'ca',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, org_id)
);

-- ─── 4. Chart of accounts ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chart_of_accounts (
    id          VARCHAR(50)  PRIMARY KEY,
    org_id      VARCHAR(50)  REFERENCES organizations(id) ON DELETE CASCADE,
    code        VARCHAR(50)  NOT NULL,
    name        VARCHAR(255) NOT NULL,
    type        VARCHAR(50)  NOT NULL,   -- 'asset','liability','equity','revenue','expense'
    sub_type    VARCHAR(100),
    description TEXT,
    is_active   BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_org_code UNIQUE (org_id, code)
);

-- ─── 5. Bank accounts ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bank_accounts (
    id                  VARCHAR(50)  PRIMARY KEY,
    org_id              VARCHAR(50)  REFERENCES organizations(id) ON DELETE CASCADE,
    account_name        VARCHAR(255) NOT NULL,
    account_number_mask VARCHAR(50)  NOT NULL,
    bank_name           VARCHAR(255) NOT NULL,
    currency            VARCHAR(10)  DEFAULT 'INR',
    opening_balance     NUMERIC(15, 2) DEFAULT 0.00,
    current_balance     NUMERIC(15, 2) DEFAULT 0.00,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ─── 6. Vendors ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vendors (
    id                  VARCHAR(50)  PRIMARY KEY,
    org_id              VARCHAR(50)  REFERENCES organizations(id) ON DELETE CASCADE,
    name                VARCHAR(255) NOT NULL,
    tax_id              VARCHAR(50),
    email               VARCHAR(255),
    default_category_id VARCHAR(50)  REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ─── 7. Customers ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
    id                  VARCHAR(50)  PRIMARY KEY,
    org_id              VARCHAR(50)  REFERENCES organizations(id) ON DELETE CASCADE,
    name                VARCHAR(255) NOT NULL,
    tax_id              VARCHAR(50),
    email               VARCHAR(255),
    default_category_id VARCHAR(50)  REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ─── 8. Documents ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documents (
    id          VARCHAR(50)  PRIMARY KEY,
    org_id      VARCHAR(50)  REFERENCES organizations(id) ON DELETE CASCADE,
    filename    VARCHAR(255) NOT NULL,
    file_type   VARCHAR(50)  NOT NULL,   -- 'bank_statement','sales_invoices','vendor_bills'
    file_size   INTEGER      DEFAULT 0,
    status      VARCHAR(50)  DEFAULT 'uploaded',
    row_count   INTEGER      DEFAULT 0,
    uploaded_by VARCHAR(50)  REFERENCES users(id) ON DELETE SET NULL,
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ─── 9. Transactions ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
    id                        VARCHAR(50)  PRIMARY KEY,
    org_id                    VARCHAR(50)  REFERENCES organizations(id) ON DELETE CASCADE,
    bank_account_id           VARCHAR(50)  REFERENCES bank_accounts(id) ON DELETE SET NULL,
    document_id               VARCHAR(50)  REFERENCES documents(id) ON DELETE SET NULL,
    date                      DATE         NOT NULL,
    description               TEXT         NOT NULL,
    raw_description           TEXT,
    amount                    NUMERIC(15, 2) NOT NULL,   -- Always positive
    type                      VARCHAR(20)  NOT NULL,     -- 'credit' | 'debit'
    counterparty              VARCHAR(255),
    reference_number          VARCHAR(100),
    category_id               VARCHAR(50)  REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
    categorization_method     VARCHAR(50)  DEFAULT 'pending',
    categorization_confidence INTEGER      DEFAULT 0,
    categorization_reasoning  TEXT,
    reconciliation_status     VARCHAR(50)  DEFAULT 'unreconciled',
    status                    VARCHAR(50)  DEFAULT 'unreconciled',
    is_approved               BOOLEAN      DEFAULT FALSE,
    approved_by               VARCHAR(50)  REFERENCES users(id) ON DELETE SET NULL,
    approved_at               TIMESTAMP WITH TIME ZONE,
    created_at                TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ─── 10. Invoices ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
    id             VARCHAR(50)  PRIMARY KEY,
    org_id         VARCHAR(50)  REFERENCES organizations(id) ON DELETE CASCADE,
    document_id    VARCHAR(50)  REFERENCES documents(id) ON DELETE SET NULL,
    customer_id    VARCHAR(50)  REFERENCES customers(id) ON DELETE SET NULL,
    customer_name  VARCHAR(255) NOT NULL,
    invoice_number VARCHAR(100) NOT NULL,
    date           DATE         NOT NULL,
    due_date       DATE,
    total_amount   NUMERIC(15, 2) NOT NULL,
    tax_amount     NUMERIC(15, 2) DEFAULT 0.00,
    status         VARCHAR(50)  DEFAULT 'unpaid',
    created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ─── 11. Bills ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bills (
    id          VARCHAR(50)  PRIMARY KEY,
    org_id      VARCHAR(50)  REFERENCES organizations(id) ON DELETE CASCADE,
    document_id VARCHAR(50)  REFERENCES documents(id) ON DELETE SET NULL,
    vendor_id   VARCHAR(50)  REFERENCES vendors(id) ON DELETE SET NULL,
    vendor_name VARCHAR(255) NOT NULL,
    bill_number VARCHAR(100) NOT NULL,
    date        DATE         NOT NULL,
    due_date    DATE,
    total_amount NUMERIC(15, 2) NOT NULL,
    tax_amount  NUMERIC(15, 2) DEFAULT 0.00,
    status      VARCHAR(50)  DEFAULT 'unpaid',
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ─── 12. Reconciliation records ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reconciliation_records (
    id                  VARCHAR(50) PRIMARY KEY,
    org_id              VARCHAR(50) REFERENCES organizations(id) ON DELETE CASCADE,
    transaction_id      VARCHAR(50) REFERENCES transactions(id) ON DELETE CASCADE,
    matched_entity_type VARCHAR(50) NOT NULL,
    matched_entity_id   VARCHAR(50) NOT NULL,
    match_confidence    INTEGER     NOT NULL,
    match_reasoning     TEXT        NOT NULL,
    status              VARCHAR(50) DEFAULT 'suggested',
    reviewed_by         VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at         TIMESTAMP WITH TIME ZONE,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ─── 13. Exceptions ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS exceptions (
    id               VARCHAR(50)  PRIMARY KEY,
    org_id           VARCHAR(50)  REFERENCES organizations(id) ON DELETE CASCADE,
    entity_type      VARCHAR(50)  NOT NULL,
    entity_id        VARCHAR(50)  NOT NULL,
    exception_type   VARCHAR(100) NOT NULL,
    severity         VARCHAR(20)  NOT NULL DEFAULT 'medium',
    explanation      TEXT         NOT NULL,
    status           VARCHAR(50)  DEFAULT 'open',
    resolved_by      VARCHAR(50)  REFERENCES users(id) ON DELETE SET NULL,
    resolved_at      TIMESTAMP WITH TIME ZONE,
    resolution_notes TEXT,
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ─── 14. Categorization rules ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS categorization_rules (
    id          VARCHAR(50)  PRIMARY KEY,
    org_id      VARCHAR(50)  REFERENCES organizations(id) ON DELETE CASCADE,
    name        VARCHAR(255) NOT NULL,
    pattern     VARCHAR(255) NOT NULL,
    match_field VARCHAR(50)  DEFAULT 'description',
    category_id VARCHAR(50)  REFERENCES chart_of_accounts(id) ON DELETE CASCADE,
    confidence  INTEGER      DEFAULT 100,
    priority    INTEGER      DEFAULT 1,
    is_active   BOOLEAN      DEFAULT TRUE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ─── 15. Approvals ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS approvals (
    id             VARCHAR(50)  PRIMARY KEY,
    org_id         VARCHAR(50)  REFERENCES organizations(id) ON DELETE CASCADE,
    entity_type    VARCHAR(100) NOT NULL,
    entity_id      VARCHAR(50)  NOT NULL,
    user_id        VARCHAR(50)  REFERENCES users(id) ON DELETE SET NULL,
    user_name      VARCHAR(255) NOT NULL,
    decision       VARCHAR(50)  NOT NULL,
    decision_notes TEXT,
    created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ─── 16. Audit logs ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
    id          VARCHAR(50)  PRIMARY KEY,
    org_id      VARCHAR(50)  REFERENCES organizations(id) ON DELETE CASCADE,
    user_id     VARCHAR(50),
    user_name   VARCHAR(255) NOT NULL,
    action      VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50)  NOT NULL,
    entity_id   VARCHAR(50)  NOT NULL,
    before_state JSONB,
    after_state  JSONB,
    explanation TEXT         NOT NULL,
    timestamp   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ─── 17. Pilot requests ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pilot_requests (
    id                VARCHAR(80)  PRIMARY KEY,
    name              VARCHAR(120) NOT NULL,
    email             VARCHAR(255) NOT NULL,
    organization_name VARCHAR(255) NOT NULL,
    customer_profile  VARCHAR(60)  NOT NULL,
    client_volume     VARCHAR(60)  NOT NULL,
    message           TEXT,
    consent_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status            VARCHAR(30)  NOT NULL DEFAULT 'new',
    created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ─── 18. Compliance filings ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS compliance_filings (
    id                  VARCHAR(50)  PRIMARY KEY,
    org_id              VARCHAR(50)  REFERENCES organizations(id) ON DELETE CASCADE,
    filing_type         VARCHAR(50)  NOT NULL,
    period              VARCHAR(20)  NOT NULL,
    due_date            DATE         NOT NULL,
    assigned_ca         VARCHAR(50)  REFERENCES users(id) ON DELETE SET NULL,
    status              VARCHAR(30)  NOT NULL DEFAULT 'upcoming',
    reference_ack_number VARCHAR(100),
    notes               TEXT,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ─── 19. GSTR-2B entries ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gstr2b_entries (
    id               VARCHAR(80)  PRIMARY KEY,
    org_id           VARCHAR(50)  REFERENCES organizations(id) ON DELETE CASCADE,
    period           VARCHAR(20)  NOT NULL,
    supplier_gstin   VARCHAR(20)  NOT NULL,
    supplier_name    VARCHAR(255) NOT NULL,
    invoice_number   VARCHAR(100) NOT NULL,
    invoice_date     DATE         NOT NULL,
    invoice_value    NUMERIC(15, 2) NOT NULL,
    taxable_value    NUMERIC(15, 2) NOT NULL DEFAULT 0,
    igst             NUMERIC(15, 2) NOT NULL DEFAULT 0,
    cgst             NUMERIC(15, 2) NOT NULL DEFAULT 0,
    sgst             NUMERIC(15, 2) NOT NULL DEFAULT 0,
    total_tax        NUMERIC(15, 2) GENERATED ALWAYS AS (igst + cgst + sgst) STORED,
    itc_available    BOOLEAN        DEFAULT TRUE,
    source           VARCHAR(30)    NOT NULL DEFAULT 'portal',
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ─── Indices ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_transactions_org_date   ON transactions(org_id, date);
CREATE INDEX IF NOT EXISTS idx_transactions_status     ON transactions(org_id, status);
CREATE INDEX IF NOT EXISTS idx_transactions_approved   ON transactions(org_id, is_approved);
CREATE INDEX IF NOT EXISTS idx_invoices_org_status     ON invoices(org_id, status);
CREATE INDEX IF NOT EXISTS idx_bills_org_status        ON bills(org_id, status);
CREATE INDEX IF NOT EXISTS idx_exceptions_org_status   ON exceptions(org_id, status);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp    ON audit_logs(org_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_pilot_requests_created  ON pilot_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_compliance_org_due      ON compliance_filings(org_id, due_date ASC);
CREATE INDEX IF NOT EXISTS idx_compliance_org_status   ON compliance_filings(org_id, status);
CREATE INDEX IF NOT EXISTS idx_gstr2b_org_period       ON gstr2b_entries(org_id, period);
CREATE INDEX IF NOT EXISTS idx_gstr2b_supplier_inv     ON gstr2b_entries(org_id, supplier_gstin, invoice_number);
