/**
 * Phase 1b Tests: Review Trail, Thresholds, GST-Excluded TDS Base, and Challan Math Hardening
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../src/lib/db';
import { GET as getTdsRegister, POST as postTdsAction } from '../src/app/api/tds-certificates/route';
import { NextRequest } from 'next/server';
import { createSessionToken } from '../src/lib/auth';

describe('Phase 1b: Statutory Rule Review Trail & In-Code Threshold Ban', () => {
  test('No threshold numeric values or threshold comments exist in src/lib/statutoryRules.ts or src/lib/currency.ts', () => {
    const rulesTs = fs.readFileSync(path.join(process.cwd(), 'src/lib/statutoryRules.ts'), 'utf8');
    const currencyTs = fs.readFileSync(path.join(process.cwd(), 'src/lib/currency.ts'), 'utf8');

    // Rule: No threshold values (30000, 100000, 240000, 15000, 20000, 50000, 5000000) may live in code or comments
    const prohibitedPatterns = [
      /30,?000/,
      /1,?00,?000/,
      /2,?40,?000/,
      /15,?000/,
      /20,?000/,
      /50,?000/,
      /50,?00,?000/,
      /threshold single/i,
      /threshold aggregate/i,
    ];

    for (const pattern of prohibitedPatterns) {
      assert.doesNotMatch(
        rulesTs,
        pattern,
        `src/lib/statutoryRules.ts must not contain threshold literal or comment matching ${pattern}`
      );
      assert.doesNotMatch(
        currencyTs,
        pattern,
        `src/lib/currency.ts must not contain threshold literal or comment matching ${pattern}`
      );
    }
  });

  test('Database statutory_tds_rules table contains review trail columns: source_citation, reviewed_by, reviewed_at, status', async () => {
    const db = await getDb();
    const cols = await db.query(
      `SELECT column_name, data_type
       FROM information_schema.columns
       WHERE table_name = 'statutory_tds_rules';`
    );
    const colNames = cols.rows.map((c: any) => c.column_name);

    assert.ok(colNames.includes('source_citation'), 'statutory_tds_rules must have source_citation column');
    assert.ok(colNames.includes('reviewed_by'), 'statutory_tds_rules must have reviewed_by column');
    assert.ok(colNames.includes('reviewed_at'), 'statutory_tds_rules must have reviewed_at column');
    assert.ok(colNames.includes('status'), 'statutory_tds_rules must have status column');
  });

  test('Draft statutory rules display "rates unverified" and block CA sign-off', async () => {
    const db = await getDb();
    const TEST_ORG_ID = 'org-phase1b-test';

    // Insert test org, CA user, and user_organization
    await db.query(
      `INSERT INTO organizations (id, name, legal_name, tax_id, tan, address)
       VALUES ($1, 'Org Phase 1b', 'Org Phase 1b Pvt Ltd', '27AABCO1234K1Z5', 'MUMO12345A', 'Nariman Point, Mumbai')
       ON CONFLICT (id) DO NOTHING;`,
      [TEST_ORG_ID]
    );
    await db.query(
      `INSERT INTO users (id, org_id, name, email, role, password_hash)
       VALUES ('user-p1b-ca', $1, 'CA Anita Roy', 'anita@p1b.test', 'CA', 'hash')
       ON CONFLICT (id) DO NOTHING;`,
      [TEST_ORG_ID]
    );
    await db.query(
      `INSERT INTO user_organizations (user_id, org_id, role)
       VALUES ('user-p1b-ca', $1, 'CA')
       ON CONFLICT (user_id, org_id) DO NOTHING;`,
      [TEST_ORG_ID]
    );

    const caToken = createSessionToken({
      userId: 'user-p1b-ca',
      userName: 'CA Anita Roy',
      userEmail: 'anita@p1b.test',
      role: 'CA',
      orgId: TEST_ORG_ID,
    });

    // Create a draft statutory rule for 2026-27 (Income-tax Act 2025)
    const draftRuleId = 'rule-test-draft-sec393';
    await db.query(
      `INSERT INTO statutory_tds_rules (
         id, legal_regime, section, payment_code, description,
         effective_from, effective_to, rate, threshold_single, threshold_aggregate,
         source_citation, reviewed_by, reviewed_at, status, notes
       ) VALUES (
          $1, 'IT_ACT_2025', '393(1) Table Sl. No. 6(iii).D(b)', '1014', 'Draft Professional Fees Rule',
          '2026-04-01', NULL, 10.00, 50000.00, 50000.00,
          'Income-tax Act, 2025, Section 393(1) Table Sl. No. 6(iii).D(b) https://incometaxindia.gov.in', NULL, NULL, 'draft', 'Needs CA review'
        ) ON CONFLICT (id) DO UPDATE SET status = 'draft', reviewed_by = NULL, source_citation = EXCLUDED.source_citation;`,
      [draftRuleId]
    );

    // Create vendor using this draft section
    const draftVendorId = 'ven-draft-01';
    await db.query(
      `INSERT INTO vendors (id, org_id, name, tax_id, tds_section, pan)
       VALUES ($1, $2, 'Future Tech Advisory', '27AABCF9999K1Z2', '393(1) Table Sl. No. 6(iii).D(b)', 'AABCF9999K')
       ON CONFLICT (id) DO UPDATE SET tds_section = '393(1) Table Sl. No. 6(iii).D(b)', pan = 'AABCF9999K';`,
      [draftVendorId, TEST_ORG_ID]
    );

    // Bill in Q1 2026-27
    await db.query(
      `INSERT INTO bills (id, org_id, vendor_id, vendor_name, bill_number, date, due_date, total_amount, tax_amount, status)
       VALUES ('bill-draft-01', $1, $2, 'Future Tech Advisory', 'FUT-101', '2026-05-10', '2026-05-20', 80000.00, 0, 'unpaid')
       ON CONFLICT (id) DO NOTHING;`,
      [TEST_ORG_ID, draftVendorId]
    );

    const req = new NextRequest('http://localhost:3010/api/tds-certificates?quarter=Q1&financialYear=2026-27', {
      headers: {
        'cookie': `copilot_session=${caToken}`,
        'x-org-id': TEST_ORG_ID,
      },
    });

    const res = await getTdsRegister(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    const cert = data.certificates?.find((c: any) => c.vendorId === draftVendorId);

    assert.ok(cert, 'Future Tech Advisory certificate line must be present');
    assert.equal(cert.status, 'data_missing');
    assert.ok(
      cert.missingFields?.includes('rates_unverified'),
      'Must include rates_unverified in missingFields for draft rule'
    );
    assert.match(cert.sectionDescription, /rates unverified/i);
    assert.equal(cert.tdsRate, null, 'Draft rule must not be used for tax rate calculation');
    assert.equal(cert.tdsAmount, null, 'Phase 1c: Draft/unverified rule must produce null (unknown), never 0');

    // Attempting CA sign-off on a draft rule must be rejected with 400 Bad Request
    const signReq = new NextRequest('http://localhost:3010/api/tds-certificates', {
      method: 'POST',
      headers: {
        'cookie': `copilot_session=${caToken}`,
        'x-org-id': TEST_ORG_ID,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: 'sign_off',
        certificateId: cert.id,
        quarter: 'Q1',
        financialYear: '2026-27',
      }),
    });
    const signRes = await postTdsAction(signReq);
    assert.equal(signRes.status, 400);
    const signData = await signRes.json();
    assert.match(signData.error, /unverified|draft|cannot sign off/i);
  });
});

describe('Phase 1b: CBDT Circular 23/2017 (GST Excluded from TDS Base)', () => {
  test('TDS is calculated on base value excluding separately indicated GST, with CA confirmation flag', async () => {
    const db = await getDb();
    const TEST_ORG_ID = 'org-p1b-gst';

    await db.query(
      `INSERT INTO organizations (id, name, legal_name, tax_id, tan, address)
       VALUES ($1, 'GST Org Test', 'GST Org Test LLP', '27AABCZ5555K1Z1', 'MUMZ55555A', 'Bandra Kurla Complex, Mumbai')
       ON CONFLICT (id) DO NOTHING;`,
      [TEST_ORG_ID]
    );
    await db.query(
      `INSERT INTO users (id, org_id, name, email, role, password_hash)
       VALUES ('user-p1b-gst-ca', $1, 'CA Rajesh', 'rajesh@p1b.test', 'CA', 'hash')
       ON CONFLICT (id) DO NOTHING;`,
      [TEST_ORG_ID]
    );
    await db.query(
      `INSERT INTO user_organizations (user_id, org_id, role)
       VALUES ('user-p1b-gst-ca', $1, 'CA')
       ON CONFLICT (user_id, org_id) DO NOTHING;`,
      [TEST_ORG_ID]
    );

    const caToken = createSessionToken({
      userId: 'user-p1b-gst-ca',
      userName: 'CA Rajesh',
      userEmail: 'rajesh@p1b.test',
      role: 'CA',
      orgId: TEST_ORG_ID,
    });

    const vendorId = 'ven-gst-separate';
    await db.query(
      `INSERT INTO vendors (id, org_id, name, tax_id, tds_section, pan)
       VALUES ($1, $2, 'Enterprise Legal Counsel LLP', '27AABCE1111K1Z3', '194J(b)', 'AABCE1111K')
       ON CONFLICT (id) DO UPDATE SET tds_section = '194J(b)', pan = 'AABCE1111K';`,
      [vendorId, TEST_ORG_ID]
    );

    // Phase 1c: Tenant CA acknowledges rule adoption for org to verify rate
    await db.query(
      `INSERT INTO org_statutory_acknowledgements (id, org_id, rule_id, acknowledged_by, notes)
       VALUES ('ack-p1b-gst', $1, 'rule-1961-194jb', 'user-p1b-gst-ca', 'Adopted for GST exclusion test')
       ON CONFLICT (org_id, rule_id) DO NOTHING;`,
      [TEST_ORG_ID]
    );

    // Bill has total_amount = ₹1,18,000 and tax_amount = ₹18,000 (18% GST).
    // Taxable base excluding GST is ₹1,00,000.
    // TDS under 194J(b) @ 10% must be ₹10,000 (NOT ₹11,800).
    await db.query(
      `INSERT INTO bills (id, org_id, vendor_id, vendor_name, bill_number, date, due_date, total_amount, tax_amount, status)
       VALUES ('bill-gst-101', $1, $2, 'Enterprise Legal Counsel LLP', 'LEG-118', '2024-11-15', '2024-11-25', 118000.00, 18000.00, 'unpaid')
       ON CONFLICT (id) DO NOTHING;`,
      [TEST_ORG_ID, vendorId]
    );

    const req = new NextRequest('http://localhost:3010/api/tds-certificates?quarter=Q3&financialYear=2024-25', {
      headers: {
        'cookie': `copilot_session=${caToken}`,
        'x-org-id': TEST_ORG_ID,
      },
    });

    const res = await getTdsRegister(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    const cert = data.certificates?.find((c: any) => c.vendorId === vendorId);

    assert.ok(cert, 'Vendor line must be found');
    assert.equal(cert.grossAmount, 100000.0, 'Gross base for TDS must be ₹1,00,000 (excluding ₹18,000 GST)');
    assert.equal(cert.tdsAmount, 10000.0, '10% TDS must be ₹10,000, not ₹11,800');
    assert.equal(cert.cbdtGstExclusionApplied, true, 'Must flag CBDT Circular 23/2017 GST exclusion applied');
    assert.equal(cert.caConfirmationRequired, true, 'Must flag that GST exclusion is subject to CA confirmation');
  });
});

describe('Phase 1b: Statutory Thresholds & YTD Vendor Gross Tracking', () => {
  test('Vendor with total payments below statutory threshold is exempt (TDS amount = 0)', async () => {
    const db = await getDb();
    const TEST_ORG_ID = 'org-p1b-threshold';

    await db.query(
      `INSERT INTO organizations (id, name, legal_name, tax_id, tan, address)
       VALUES ($1, 'Threshold Test Org', 'Threshold Test Org LLP', '27AABCT4444K1Z9', 'MUMT44444A', 'Andheri, Mumbai')
       ON CONFLICT (id) DO NOTHING;`,
      [TEST_ORG_ID]
    );
    await db.query(
      `INSERT INTO users (id, org_id, name, email, role, password_hash)
       VALUES ('user-p1b-thresh-ca', $1, 'CA Suman', 'suman@p1b.test', 'CA', 'hash')
       ON CONFLICT (id) DO NOTHING;`,
      [TEST_ORG_ID]
    );
    await db.query(
      `INSERT INTO user_organizations (user_id, org_id, role)
       VALUES ('user-p1b-thresh-ca', $1, 'CA')
       ON CONFLICT (user_id, org_id) DO NOTHING;`,
      [TEST_ORG_ID]
    );

    const caToken = createSessionToken({
      userId: 'user-p1b-thresh-ca',
      userName: 'CA Suman',
      userEmail: 'suman@p1b.test',
      role: 'CA',
      orgId: TEST_ORG_ID,
    });

    const vendorId = 'ven-small-contractor';
    await db.query(
      `INSERT INTO vendors (id, org_id, name, tax_id, tds_section, pan)
       VALUES ($1, $2, 'Small Repairs Contractor', '27AABCS3333K1Z4', '194C', 'AABCS3333K')
       ON CONFLICT (id) DO UPDATE SET tds_section = '194C', pan = 'AABCS3333K';`,
      [vendorId, TEST_ORG_ID]
    );

    // Phase 1c: Acknowledge 194C for org to verify threshold parameters
    await db.query(
      `INSERT INTO org_statutory_acknowledgements (id, org_id, rule_id, acknowledged_by, notes)
       VALUES ('ack-p1b-thresh', $1, 'rule-1961-194c', 'user-p1b-thresh-ca', 'Adopted for threshold test')
       ON CONFLICT (org_id, rule_id) DO NOTHING;`,
      [TEST_ORG_ID]
    );

    // Bill of ₹12,000 in Q1 2024-25.
    // Under Section 194C, single threshold is ₹30,000 and aggregate is ₹1,00,000 (read from DB).
    // ₹12,000 is below both single and annual aggregate threshold.
    await db.query(
      `INSERT INTO bills (id, org_id, vendor_id, vendor_name, bill_number, date, due_date, total_amount, tax_amount, status)
       VALUES ('bill-small-01', $1, $2, 'Small Repairs Contractor', 'SML-01', '2024-05-10', '2024-05-20', 12000.00, 0, 'unpaid')
       ON CONFLICT (id) DO NOTHING;`,
      [TEST_ORG_ID, vendorId]
    );

    const req = new NextRequest('http://localhost:3010/api/tds-certificates?quarter=Q1&financialYear=2024-25', {
      headers: {
        'cookie': `copilot_session=${caToken}`,
        'x-org-id': TEST_ORG_ID,
      },
    });

    const res = await getTdsRegister(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    const cert = data.certificates?.find((c: any) => c.vendorId === vendorId);

    assert.ok(cert, 'Vendor line must exist in register');
    assert.equal(cert.grossAmount, 12000.0);
    assert.equal(cert.tdsAmount, 0, 'TDS must be 0 when payment is below statutory threshold');
    assert.equal(cert.isBelowThreshold, true, 'Must indicate isBelowThreshold: true');
  });
});

describe('Phase 1b: Challan Math, Isolation, and Production Exclusion Tests', () => {
  test('totalTdsDeposited is computed ONLY from tds_challans matching (org, quarter, FY)', async () => {
    const db = await getDb();
    const ORG_A = 'org-challan-iso-a';
    const ORG_B = 'org-challan-iso-b';

    for (const org of [ORG_A, ORG_B]) {
      await db.query(
        `INSERT INTO organizations (id, name, legal_name, tax_id, tan, address)
         VALUES ($1, $1, $1, '27AABCO8888K1Z2', 'MUMO88888A', 'Mumbai')
         ON CONFLICT (id) DO NOTHING;`,
        [org]
      );
    }
    await db.query(
      `INSERT INTO users (id, org_id, name, email, role, password_hash)
       VALUES ('user-iso-ca', $1, 'CA Isolation', 'iso@p1b.test', 'CA', 'hash')
       ON CONFLICT (id) DO NOTHING;`,
      [ORG_A]
    );
    await db.query(
      `INSERT INTO user_organizations (user_id, org_id, role)
       VALUES ('user-iso-ca', $1, 'CA')
       ON CONFLICT (user_id, org_id) DO NOTHING;`,
      [ORG_A]
    );

    const caToken = createSessionToken({
      userId: 'user-iso-ca',
      userName: 'CA Isolation',
      userEmail: 'iso@p1b.test',
      role: 'CA',
      orgId: ORG_A,
    });

    // Clear prior test challans for these orgs
    await db.query('DELETE FROM tds_challans WHERE org_id IN ($1, $2);', [ORG_A, ORG_B]);

    // 1. Valid Challan: Org A, Q3, 2024-25 -> ₹15,000
    await db.query(
      `INSERT INTO tds_challans (id, org_id, challan_no, bsr_code, deposit_date, amount, section, quarter, financial_year, source)
       VALUES ('chl-valid-a', $1, 'CHL-A1', '0210084', '2024-11-05', 15000.00, '194J(b)', 'Q3', '2024-25', 'manual');`,
      [ORG_A]
    );

    // 2. Different Quarter: Org A, Q2, 2024-25 -> ₹9,000 (must be ignored)
    await db.query(
      `INSERT INTO tds_challans (id, org_id, challan_no, bsr_code, deposit_date, amount, section, quarter, financial_year, source)
       VALUES ('chl-wrong-q', $1, 'CHL-A2', '0210084', '2024-08-05', 9000.00, '194J(b)', 'Q2', '2024-25', 'manual');`,
      [ORG_A]
    );

    // 3. Different FY: Org A, Q3, 2023-24 -> ₹12,000 (must be ignored)
    await db.query(
      `INSERT INTO tds_challans (id, org_id, challan_no, bsr_code, deposit_date, amount, section, quarter, financial_year, source)
       VALUES ('chl-wrong-fy', $1, 'CHL-A3', '0210084', '2023-11-05', 12000.00, '194J(b)', 'Q3', '2023-24', 'manual');`,
      [ORG_A]
    );

    // 4. Different Org: Org B, Q3, 2024-25 -> ₹50,000 (must be ignored)
    await db.query(
      `INSERT INTO tds_challans (id, org_id, challan_no, bsr_code, deposit_date, amount, section, quarter, financial_year, source)
       VALUES ('chl-wrong-org', $1, 'CHL-B1', '0210084', '2024-11-05', 50000.00, '194J(b)', 'Q3', '2024-25', 'manual');`,
      [ORG_B]
    );

    const req = new NextRequest('http://localhost:3010/api/tds-certificates?quarter=Q3&financialYear=2024-25', {
      headers: {
        'cookie': `copilot_session=${caToken}`,
        'x-org-id': ORG_A,
      },
    });

    const res = await getTdsRegister(req);
    assert.equal(res.status, 200);
    const data = await res.json();

    assert.equal(
      data.summary.totalTdsDeposited,
      15000.0,
      'totalTdsDeposited must strictly sum ONLY matching org, quarter, and FY challans'
    );
  });

  test('returnReady is false if any deduction line is unallocated OR if deposited < deducted', async () => {
    const db = await getDb();
    const TEST_ORG = 'org-return-ready-test';

    await db.query(
      `INSERT INTO organizations (id, name, legal_name, tax_id, tan, address)
       VALUES ($1, $1, $1, '27AABCR7777K1Z3', 'MUMR77777A', 'Mumbai')
       ON CONFLICT (id) DO NOTHING;`,
      [TEST_ORG]
    );
    await db.query(
      `INSERT INTO users (id, org_id, name, email, role, password_hash)
       VALUES ('user-rr-ca', $1, 'CA Return Ready', 'rr@p1b.test', 'CA', 'hash')
       ON CONFLICT (id) DO NOTHING;`,
      [TEST_ORG]
    );
    await db.query(
      `INSERT INTO user_organizations (user_id, org_id, role)
       VALUES ('user-rr-ca', $1, 'CA')
       ON CONFLICT (user_id, org_id) DO NOTHING;`,
      [TEST_ORG]
    );

    const caToken = createSessionToken({
      userId: 'user-rr-ca',
      userName: 'CA Return Ready',
      userEmail: 'rr@p1b.test',
      role: 'CA',
      orgId: TEST_ORG,
    });

    // Clear prior challans, allocations, and bills for TEST_ORG
    await db.query('DELETE FROM tds_challan_allocations WHERE org_id = $1;', [TEST_ORG]);
    await db.query('DELETE FROM tds_challans WHERE org_id = $1;', [TEST_ORG]);
    await db.query('DELETE FROM bills WHERE org_id = $1;', [TEST_ORG]);

    const v1 = 'ven-rr-1';
    await db.query(
      `INSERT INTO vendors (id, org_id, name, tax_id, tds_section, pan)
       VALUES ($1, $2, 'Vendor RR 1', '27AABCV1234K1Z0', '194J(b)', 'AABCV1234K')
       ON CONFLICT (id) DO UPDATE SET tds_section = '194J(b)', pan = 'AABCV1234K';`,
      [v1, TEST_ORG]
    );

    // Phase 1c: Acknowledge rule adoption for TEST_ORG so rates are verified
    await db.query(
      `INSERT INTO org_statutory_acknowledgements (id, org_id, rule_id, acknowledged_by, notes)
       VALUES ('ack-p1b-rr', $1, 'rule-1961-194jb', 'user-rr-ca', 'Adopted for returnReady test')
       ON CONFLICT (org_id, rule_id) DO NOTHING;`,
      [TEST_ORG]
    );

    await db.query(
      `INSERT INTO bills (id, org_id, vendor_id, vendor_name, bill_number, date, due_date, total_amount, tax_amount, status)
       VALUES ('bill-rr-1', $1, $2, 'Vendor RR 1', 'RR-01', '2024-10-15', '2024-10-25', 100000.00, 0, 'unpaid')
       ON CONFLICT (id) DO NOTHING;`,
      [TEST_ORG, v1]
    );

    // Case 1: Deducted = ₹10,000, Deposited = 0 -> returnReady must be false
    const req1 = new NextRequest('http://localhost:3010/api/tds-certificates?quarter=Q3&financialYear=2024-25', {
      headers: {
        'cookie': `copilot_session=${caToken}`,
        'x-org-id': TEST_ORG,
      },
    });
    const res1 = await getTdsRegister(req1);
    const data1 = await res1.json();
    assert.equal(data1.summary.returnReady, false, 'returnReady must be false when no challan deposited');

    // Case 2: Deposited = ₹8,000 (< ₹10,000 deducted) -> returnReady must be false
    const chlId = 'chl-rr-short';
    await db.query(
      `INSERT INTO tds_challans (id, org_id, challan_no, bsr_code, deposit_date, amount, section, quarter, financial_year, source)
       VALUES ($1, $2, 'CHL-SHORT', '0210084', '2024-11-05', 8000.00, '194J(b)', 'Q3', '2024-25', 'manual')
       ON CONFLICT (id) DO NOTHING;`,
      [chlId, TEST_ORG]
    );
    const req2 = new NextRequest('http://localhost:3010/api/tds-certificates?quarter=Q3&financialYear=2024-25', {
      headers: {
        'cookie': `copilot_session=${caToken}`,
        'x-org-id': TEST_ORG,
      },
    });
    const res2 = await getTdsRegister(req2);
    const data2 = await res2.json();
    assert.equal(data2.summary.returnReady, false, 'returnReady must be false when deposited < deducted');

    // Case 3: Deposited = ₹10,000, but line is NOT allocated -> returnReady must be false
    await db.query('UPDATE tds_challans SET amount = 10000.00 WHERE id = $1;', [chlId]);
    const req3 = new NextRequest('http://localhost:3010/api/tds-certificates?quarter=Q3&financialYear=2024-25', {
      headers: {
        'cookie': `copilot_session=${caToken}`,
        'x-org-id': TEST_ORG,
      },
    });
    const res3 = await getTdsRegister(req3);
    const data3 = await res3.json();
    assert.equal(data3.summary.returnReady, false, 'returnReady must be false when deduction line is unallocated');

    // Case 4: Line is allocated and deposited >= deducted -> returnReady is true
    const certId = data3.certificates[0].id;
    await db.query(
      `INSERT INTO tds_challan_allocations (id, org_id, challan_id, deduction_line_id, allocated_amount)
       VALUES ('alloc-rr-1', $1, $2, $3, 10000.00)
       ON CONFLICT (id) DO NOTHING;`,
      [TEST_ORG, chlId, certId]
    );

    const req4 = new NextRequest('http://localhost:3010/api/tds-certificates?quarter=Q3&financialYear=2024-25', {
      headers: {
        'cookie': `copilot_session=${caToken}`,
        'x-org-id': TEST_ORG,
      },
    });
    const res4 = await getTdsRegister(req4);
    const data4 = await res4.json();
    assert.equal(data4.summary.allLinesAllocated, true);
    assert.equal(data4.summary.returnReady, true, 'returnReady must be true when all lines allocated and deposited >= deducted');
  });

  test('source=demo challans are excluded when NODE_ENV=production', async () => {
    const db = await getDb();
    const TEST_ORG = 'org-demo-exclude-test';

    await db.query(
      `INSERT INTO organizations (id, name, legal_name, tax_id, tan, address)
       VALUES ($1, $1, $1, '27AABCP6666K1Z1', 'MUMP66666A', 'Mumbai')
       ON CONFLICT (id) DO NOTHING;`,
      [TEST_ORG]
    );
    await db.query(
      `INSERT INTO users (id, org_id, name, email, role, password_hash)
       VALUES ('user-demo-ca', $1, 'CA Demo', 'demo@p1b.test', 'CA', 'hash')
       ON CONFLICT (id) DO NOTHING;`,
      [TEST_ORG]
    );
    await db.query(
      `INSERT INTO user_organizations (user_id, org_id, role)
       VALUES ('user-demo-ca', $1, 'CA')
       ON CONFLICT (user_id, org_id) DO NOTHING;`,
      [TEST_ORG]
    );

    // Clear prior challans for test org
    await db.query('DELETE FROM tds_challans WHERE org_id = $1;', [TEST_ORG]);

    // Insert 1 manual challan (₹25,000) and 1 demo challan (₹10,000)
    await db.query(
      `INSERT INTO tds_challans (id, org_id, challan_no, bsr_code, deposit_date, amount, section, quarter, financial_year, source)
       VALUES ('chl-manual-1', $1, 'CHL-MAN1', '0210084', '2024-11-05', 25000.00, '194J(b)', 'Q3', '2024-25', 'manual'),
              ('chl-demo-1', $1, 'CHL-DEMO1', '0210084', '2024-11-06', 10000.00, '194J(b)', 'Q3', '2024-25', 'demo');`,
      [TEST_ORG]
    );

    // Run under simulated NODE_ENV = 'production'
    const originalEnv = process.env.NODE_ENV;
    const originalSecret = process.env.SESSION_SECRET;
    try {
      (process.env as any).NODE_ENV = 'production';
      process.env.SESSION_SECRET = 'phase1b-test-session-secret-hmac-32';

      const caToken = createSessionToken({
        userId: 'user-demo-ca',
        userName: 'CA Demo',
        userEmail: 'demo@p1b.test',
        role: 'CA',
        orgId: TEST_ORG,
      });

      const req = new NextRequest('http://localhost:3010/api/tds-certificates?quarter=Q3&financialYear=2024-25', {
        headers: {
          'cookie': `copilot_session=${caToken}`,
          'x-org-id': TEST_ORG,
        },
      });

      const res = await getTdsRegister(req);
      assert.equal(res.status, 200);
      const data = await res.json();

      assert.equal(
        data.summary.totalTdsDeposited,
        25000.0,
        'Demo challan must be excluded in production, leaving only manual ₹25,000'
      );
      assert.equal(data.challans.length, 1, 'Only non-demo challan should be returned in production');
      assert.equal(data.challans[0].source, 'manual');
    } finally {
      (process.env as any).NODE_ENV = originalEnv;
      process.env.SESSION_SECRET = originalSecret;
    }
  });
});
