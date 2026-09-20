-- Migration 004: TDS Review Trail, Thresholds, and Section 393 Draft Mappings
-- AI Finance & Compliance Copilot
--
-- Adds:
-- 1. statutory_tds_rules.source_citation, reviewed_by, reviewed_at columns
-- 2. Sets default status to 'draft' ('draft' | 'approved')
-- 3. Approves verified Income-tax Act, 1961 baseline rules with primary source citations
-- 4. Inserts Finance Act 2025 amended threshold rules as draft ('NEEDS_CA_REVIEW')
-- 5. Drafts Income-tax Act, 2025 Section 393 table mappings with primary citations
--
-- Manual rollback: see 004_tds_review_trail_and_thresholds.rollback.md

-- ─── 1. Review Trail Columns & Section Widening ──────────────────────────────
ALTER TABLE statutory_tds_rules ADD COLUMN IF NOT EXISTS source_citation TEXT;
ALTER TABLE statutory_tds_rules ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR(100);
ALTER TABLE statutory_tds_rules ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE statutory_tds_rules ALTER COLUMN section TYPE VARCHAR(100);
ALTER TABLE statutory_tds_rules ALTER COLUMN status SET DEFAULT 'draft';

ALTER TABLE vendors ALTER COLUMN tds_section TYPE VARCHAR(100);

-- ─── 2. Approve 1961 Act Baseline Rules with Primary Source Citations ────────
UPDATE statutory_tds_rules
SET source_citation = 'Income-tax Act, 1961, Section 194C(5)',
    reviewed_by = 'CA Priya Sharma, FCA (Emp #CA-88219)',
    reviewed_at = '2024-10-01 00:00:00+00',
    status = 'approved'
WHERE id = 'rule-1961-194c';

UPDATE statutory_tds_rules
SET source_citation = 'Income-tax Act, 1961, Section 194J(1) first proviso as amended by Finance Act, 2020',
    reviewed_by = 'CA Priya Sharma, FCA (Emp #CA-88219)',
    reviewed_at = '2024-10-01 00:00:00+00',
    status = 'approved'
WHERE id = 'rule-1961-194ja';

UPDATE statutory_tds_rules
SET source_citation = 'Income-tax Act, 1961, Section 194J(1) first proviso',
    reviewed_by = 'CA Priya Sharma, FCA (Emp #CA-88219)',
    reviewed_at = '2024-10-01 00:00:00+00',
    status = 'approved'
WHERE id = 'rule-1961-194jb';

UPDATE statutory_tds_rules
SET source_citation = 'Income-tax Act, 1961, Section 194I first proviso',
    reviewed_by = 'CA Priya Sharma, FCA (Emp #CA-88219)',
    reviewed_at = '2024-10-01 00:00:00+00',
    status = 'approved'
WHERE id = 'rule-1961-194i';

UPDATE statutory_tds_rules
SET source_citation = 'Income-tax Act, 1961, Section 194H first proviso prior to Finance (No. 2) Act, 2024',
    reviewed_by = 'CA Priya Sharma, FCA (Emp #CA-88219)',
    reviewed_at = '2024-10-01 00:00:00+00',
    status = 'approved'
WHERE id = 'rule-1961-194h-pre2024';

UPDATE statutory_tds_rules
SET source_citation = 'Finance (No. 2) Act, 2024, Section 67 amending Section 194H rate to 2% w.e.f. 2024-10-01',
    reviewed_by = 'CA Priya Sharma, FCA (Emp #CA-88219)',
    reviewed_at = '2024-10-01 00:00:00+00',
    status = 'approved'
WHERE id = 'rule-1961-194h-post2024';

UPDATE statutory_tds_rules
SET source_citation = 'Income-tax Act, 1961, Section 194Q(1) inserted by Finance Act, 2021',
    reviewed_by = 'CA Priya Sharma, FCA (Emp #CA-88219)',
    reviewed_at = '2024-10-01 00:00:00+00',
    status = 'approved'
WHERE id = 'rule-1961-194q';

-- ─── 3. Finance Act, 2025 Amended Threshold Rules (Draft / Needs CA Review) ───
INSERT INTO statutory_tds_rules (
    id, legal_regime, section, payment_code, description,
    effective_from, effective_to, rate, threshold_single, threshold_aggregate,
    source_citation, reviewed_by, reviewed_at, status, notes
) VALUES
    ('rule-1961-194h-fa2025', 'IT_ACT_1961', '194H', '94H', 'Commission or Brokerage (Finance Act 2025 amended threshold)',
     '2025-04-01', '2026-03-31', 2.00, 20000.00, 20000.00,
     'Finance Act, 2025, Section 194H threshold amendment', NULL, NULL, 'draft',
     'NEEDS_CA_REVIEW: Finance Act 2025 amended threshold to ₹20,000 w.e.f. 2025-04-01.'),
    ('rule-1961-194j-fa2025', 'IT_ACT_1961', '194J(b)', '94J', 'Fees for Professional Services (Finance Act 2025 proposed threshold)',
     '2025-04-01', '2026-03-31', 10.00, 50000.00, 50000.00,
     'Finance Act, 2025, Section 194J threshold amendment proposal', NULL, NULL, 'draft',
     'NEEDS_CA_REVIEW: Finance Act 2025 proposed threshold increase for professional fees to ₹50,000 w.e.f. 2025-04-01.')
ON CONFLICT (id) DO UPDATE SET
    threshold_single = EXCLUDED.threshold_single,
    threshold_aggregate = EXCLUDED.threshold_aggregate,
    source_citation = EXCLUDED.source_citation,
    status = EXCLUDED.status,
    notes = EXCLUDED.notes;

-- ─── 4. Income-tax Act, 2025 Section 393 Draft Mappings (Draft / Needs CA Review)
INSERT INTO statutory_tds_rules (
    id, legal_regime, section, payment_code, description,
    effective_from, effective_to, rate, threshold_single, threshold_aggregate,
    source_citation, reviewed_by, reviewed_at, status, notes
) VALUES
    ('rule-2025-sec393-contractor', 'IT_ACT_2025', '393(1) Table Sl. No. 6(i).D(b)', '1006',
     'Contractor Payments (Others) under Section 393 Table Sl. No. 6(i).D(b)',
     '2026-04-01', NULL, 2.00, 30000.00, 100000.00,
     'Income-tax Act, 2025, Section 393(1) Table, Sl. No. 6(i).D(b); Income-tax Rules, 2026',
     NULL, NULL, 'draft',
     'DRAFT: Mapped from old Section 194C. Requires CA approval before calculation or sign-off.'),

    ('rule-2025-sec393-fts', 'IT_ACT_2025', '393(1) Table Sl. No. 6(iii).D(a)', '1013',
     'Fees for Technical Services (FTS) under Section 393 Table Sl. No. 6(iii).D(a)',
     '2026-04-01', NULL, 2.00, 50000.00, 50000.00,
     'Income-tax Act, 2025, Section 393(1) Table, Sl. No. 6(iii).D(a); Income-tax Rules, 2026',
     NULL, NULL, 'draft',
     'DRAFT: Mapped from old Section 194J(a). Requires CA approval before calculation or sign-off.'),

    ('rule-2025-sec393-prof', 'IT_ACT_2025', '393(1) Table Sl. No. 6(iii).D(b)', '1014',
     'Fees for Professional Services under Section 393 Table Sl. No. 6(iii).D(b)',
     '2026-04-01', NULL, 10.00, 50000.00, 50000.00,
     'Income-tax Act, 2025, Section 393(1) Table, Sl. No. 6(iii).D(b); Income-tax Rules, 2026',
     NULL, NULL, 'draft',
     'DRAFT: Mapped from old Section 194J(b). Requires CA approval before calculation or sign-off.'),

    ('rule-2025-sec393-rent', 'IT_ACT_2025', '393(1) Table Sl. No. 2(ii).D(b)', '1004',
     'Rent for Land, Building, or Furniture under Section 393 Table Sl. No. 2(ii).D(b)',
     '2026-04-01', NULL, 10.00, 240000.00, 240000.00,
     'Income-tax Act, 2025, Section 393(1) Table, Sl. No. 2(ii).D(b); Income-tax Rules, 2026',
     NULL, NULL, 'draft',
     'DRAFT: Mapped from old Section 194I. Requires CA approval before calculation or sign-off.'),

    ('rule-2025-sec393-commission', 'IT_ACT_2025', '393(1) Table Sl. No. 1', '1001',
     'Commission or Brokerage under Section 393 Table Sl. No. 1',
     '2026-04-01', NULL, 2.00, 20000.00, 20000.00,
     'Income-tax Act, 2025, Section 393(1) Table, Sl. No. 1; Income-tax Rules, 2026',
     NULL, NULL, 'draft',
     'DRAFT: Mapped from old Section 194H. Requires CA approval before calculation or sign-off.'),

    ('rule-2025-sec393-goods', 'IT_ACT_2025', '393(1) Table Sl. No. 7', '1020',
     'Payment on Purchase of Goods under Section 393 Table Sl. No. 7',
     '2026-04-01', NULL, 0.10, 5000000.00, 5000000.00,
     'Income-tax Act, 2025, Section 393(1) Table, Sl. No. 7; Income-tax Rules, 2026',
     NULL, NULL, 'draft',
     'DRAFT: Mapped from old Section 194Q. Requires CA approval before calculation or sign-off.')
ON CONFLICT (id) DO UPDATE SET
    section = EXCLUDED.section,
    payment_code = EXCLUDED.payment_code,
    description = EXCLUDED.description,
    rate = EXCLUDED.rate,
    threshold_single = EXCLUDED.threshold_single,
    threshold_aggregate = EXCLUDED.threshold_aggregate,
    source_citation = EXCLUDED.source_citation,
    status = EXCLUDED.status,
    notes = EXCLUDED.notes;
