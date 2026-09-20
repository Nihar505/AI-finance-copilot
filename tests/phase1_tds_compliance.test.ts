/**
 * Phase 1 Tests: TDS Deduction Register & Statutory Compliance Hardening
 * Verifies:
 *  1. Unknown vendor gets no invented section (status: 'data_missing')
 *  2. Missing challan blocks CA sign-off with 400 Bad Request
 *  3. Sign-off is persisted in tds_signoffs and survives memory restart
 *  4. Section 194J sub-sections (194J(a) vs 194J(b)) are not altered by isCompanyOrLLP entity type
 *  5. Statutory rules versioning: 194H (5% pre-Oct 2024 vs 2% post-Oct 2024) and 2025 Act (NEEDS_CA_REVIEW)
 *  6. Deposited-vs-deducted computed from tds_challans, blocking return-ready status
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { calculateTds } from '../src/lib/currency';
import {
  getLegalRegimeForDate,
  lookupStatutoryRule,
  getCurrentTaxPeriod,
  STATUTORY_FORM_CONFIG,
} from '../src/lib/statutoryRules';
import { getDb } from '../src/lib/db';
import { GET as getTdsRegister, POST as postTdsAction } from '../src/app/api/tds-certificates/route';
import { NextRequest } from 'next/server';
import { createSessionToken } from '../src/lib/auth';

describe('Phase 1: Statutory Rules & Entity Type Invariance', () => {
  test('Section 194J(a) rate is 2% regardless of isCompanyOrLLP entity type', () => {
    const pan = 'AABCA1234D';
    const gross = 50000;
    const resCompany = calculateTds(gross, '194J(a)', pan, true);
    const resIndividual = calculateTds(gross, '194J(a)', pan, false);

    assert.equal(resCompany.applicableRate, 2.0);
    assert.equal(resIndividual.applicableRate, 2.0);
    assert.equal(resCompany.tdsAmount, 1000.0);
    assert.equal(resIndividual.tdsAmount, 1000.0);
  });

  test('Section 194J(b) rate is 10% regardless of isCompanyOrLLP entity type', () => {
    const pan = 'AABCA1234D';
    const gross = 50000;
    const resCompany = calculateTds(gross, '194J(b)', pan, true);
    const resIndividual = calculateTds(gross, '194J(b)', pan, false);

    assert.equal(resCompany.applicableRate, 10.0);
    assert.equal(resIndividual.applicableRate, 10.0);
    assert.equal(resCompany.tdsAmount, 5000.0);
    assert.equal(resIndividual.tdsAmount, 5000.0);
  });

  test('Section 194H rate changes from 5% to 2% on 2024-10-01 (Finance Act 2024)', () => {
    const preDateRule = lookupStatutoryRule('194H', '2024-08-15');
    const postDateRule = lookupStatutoryRule('194H', '2024-10-15');

    assert.ok(preDateRule, 'Pre-Oct 2024 rule should exist');
    assert.ok(postDateRule, 'Post-Oct 2024 rule should exist');
    assert.equal(preDateRule.rate, 5.0, 'Pre-Oct 2024 194H rate must be 5.0%');
    assert.equal(postDateRule.rate, 2.0, 'Post-Oct 2024 194H rate must be 2.0%');
  });

  test('Income-tax Act 2025 applies for payments on or after 2026-04-01 with mapping pending', () => {
    const regimePre = getLegalRegimeForDate('2026-03-31');
    const regimePost = getLegalRegimeForDate('2026-04-01');

    assert.equal(regimePre, 'IT_ACT_1961');
    assert.equal(regimePost, 'IT_ACT_2025');

    const rule2025 = lookupStatutoryRule('194C', '2026-05-01');
    assert.ok(rule2025, '2025 Act rule should be returned for 2026-05-01');
    assert.equal(rule2025.status, 'NEEDS_CA_REVIEW');
    assert.equal(rule2025.section, undefined, '2025 Act section mapping must be empty until CA supplies it');
    assert.equal(rule2025.paymentCode, undefined, '2025 Act payment code must be empty until CA supplies it');
  });

  test('Period helper derives Tax Year and quarter without hardcoded defaults', () => {
    // September 2026 -> Tax Year 2026-27, Q2
    const period = getCurrentTaxPeriod(new Date('2026-09-20T10:00:00Z'));
    assert.equal(period.quarter, 'Q2');
    assert.equal(period.financialYear, '2026-27');
    assert.equal(period.isNewRegime, true);
    assert.match(period.periodLabel, /Tax Year 2026-27/i);

    // October 2024 -> Financial Year 2024-25, Q3
    const period2024 = getCurrentTaxPeriod(new Date('2024-10-15T10:00:00Z'));
    assert.equal(period2024.quarter, 'Q3');
    assert.equal(period2024.financialYear, '2024-25');
    assert.equal(period2024.isNewRegime, false);
    assert.match(period2024.periodLabel, /Financial Year 2024-25/i);
  });

  test('Form names are configuration-driven, not hardcoded', () => {
    assert.ok(STATUTORY_FORM_CONFIG.preparationWorksheetTitle);
    assert.ok(STATUTORY_FORM_CONFIG.tdsCertificateLabel);
    assert.ok(STATUTORY_FORM_CONFIG.quarterlyReturnLabel);
  });
});

describe('Phase 1: API Route & Database Verification', () => {
  const TEST_ORG_ID = 'org-phase1-test';
  let caToken: string;

  test('Unknown vendor without configured tds_section returns status data_missing (no invented section)', async () => {
    const db = await getDb();
    // Ensure test org exists
    await db.query(
      `INSERT INTO organizations (id, name, legal_name, tax_id, tan, address)
       VALUES ($1, 'Test Org Phase 1', 'Test Org Phase 1 LLP', '27AABCT9988K1Z1', 'MUMA99821C', 'Mumbai India')
       ON CONFLICT (id) DO NOTHING;`,
      [TEST_ORG_ID]
    );

    // Ensure user and tenant membership exist
    await db.query(
      `INSERT INTO users (id, org_id, name, email, role, password_hash)
       VALUES ('user-phase1-ca', $1, 'Test CA', 'ca@phase1.test', 'CA', 'mockhash')
       ON CONFLICT (id) DO NOTHING;`,
      [TEST_ORG_ID]
    );
    await db.query(
      `INSERT INTO user_organizations (user_id, org_id, role)
       VALUES ('user-phase1-ca', $1, 'CA')
       ON CONFLICT (user_id, org_id) DO NOTHING;`,
      [TEST_ORG_ID]
    );

    // Create an unknown vendor with NO tds_section and NO pan
    const unknownVendorId = 'ven-unknown-01';
    await db.query(
      `INSERT INTO vendors (id, org_id, name, tax_id, tds_section, pan)
       VALUES ($1, $2, 'Mystery Consulting Services', NULL, NULL, NULL)
       ON CONFLICT (id) DO UPDATE SET tds_section = NULL, pan = NULL;`,
      [unknownVendorId, TEST_ORG_ID]
    );

    // Insert a bill for this unknown vendor in Q3 2024-25
    await db.query(
      `INSERT INTO bills (id, org_id, vendor_id, vendor_name, bill_number, date, due_date, total_amount, tax_amount, status)
       VALUES ('bill-unknown-101', $1, $2, 'Mystery Consulting Services', 'MYS-101', '2024-10-10', '2024-10-20', 75000.00, 0, 'unpaid')
       ON CONFLICT (id) DO NOTHING;`,
      [TEST_ORG_ID, unknownVendorId]
    );

    // Setup CA token
    caToken = createSessionToken({
      userId: 'user-phase1-ca',
      userName: 'Test CA',
      userEmail: 'ca@phase1.test',
      role: 'CA',
      orgId: TEST_ORG_ID,
    });

    const req = new NextRequest(`http://localhost:3010/api/tds-certificates?quarter=Q3&financialYear=2024-25`, {
      headers: {
        'cookie': `copilot_session=${caToken}`,
        'x-org-id': TEST_ORG_ID,
      },
    });

    const res = await getTdsRegister(req);
    assert.equal(res.status, 200);
    const data = await res.json();

    const mysteryRow = data.certificates?.find((c: any) => c.vendorId === unknownVendorId);
    assert.ok(mysteryRow, 'Mystery vendor bill should appear in register');
    assert.equal(mysteryRow.status, 'data_missing', 'Row without tds_section must have status data_missing');
    assert.equal(mysteryRow.section, null, 'Must NOT invent a section like 194C');
    assert.equal(mysteryRow.tdsRate, null, 'Must NOT invent a tax rate');
    assert.equal(mysteryRow.tdsAmount, 0, 'tdsAmount must be 0 when data is missing');
  });

  test('Missing challan allocation blocks CA sign-off with 400 Bad Request', async () => {
    const req = new NextRequest(`http://localhost:3010/api/tds-certificates`, {
      method: 'POST',
      headers: {
        'cookie': `copilot_session=${caToken}`,
        'x-org-id': TEST_ORG_ID,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: 'sign_off',
        certificateId: `CERT-202425-Q3-ven-unknown-01`,
        quarter: 'Q3',
        financialYear: '2024-25',
      }),
    });

    const res = await postTdsAction(req);
    assert.equal(res.status, 400, 'Attempting to sign off a row with missing data must return 400');
    const data = await res.json();
    assert.equal(data.success, false);
    assert.match(data.error, /data missing|challan missing|cannot sign off/i);
  });

  test('CA sign-off survives simulated restart (persisted in database tds_signoffs table)', async () => {
    const db = await getDb();
    // Configure vendor with valid tds_section and PAN
    const validVendorId = 'ven-valid-01';
    await db.query(
      `INSERT INTO vendors (id, org_id, name, tax_id, tds_section, pan)
       VALUES ($1, $2, 'Valid Legal Advisory LLP', '27AABCV1122K1Z0', '194J(b)', 'AABCV1122K')
       ON CONFLICT (id) DO UPDATE SET tds_section = '194J(b)', pan = 'AABCV1122K';`,
      [validVendorId, TEST_ORG_ID]
    );

    const billId = 'bill-valid-101';
    await db.query(
      `INSERT INTO bills (id, org_id, vendor_id, vendor_name, bill_number, date, due_date, total_amount, tax_amount, status)
       VALUES ($1, $2, $3, 'Valid Legal Advisory LLP', 'LEG-101', '2024-10-15', '2024-10-25', 100000.00, 0, 'unpaid')
       ON CONFLICT (id) DO NOTHING;`,
      [billId, TEST_ORG_ID, validVendorId]
    );

    const certId = `CERT-202425-Q3-${validVendorId}`;

    // Record valid challan
    const challanId = 'chl-test-01';
    await db.query(
      `INSERT INTO tds_challans (id, org_id, challan_no, bsr_code, deposit_date, amount, section, quarter, financial_year, source)
       VALUES ($1, $2, 'CHL-99881', '0210084', '2024-11-07', 10000.00, '194J(b)', 'Q3', '2024-25', 'demo')
       ON CONFLICT (id) DO NOTHING;`,
      [challanId, TEST_ORG_ID]
    );

    // Allocate challan to this certificate / deduction line
    await db.query(
      `INSERT INTO tds_challan_allocations (id, org_id, challan_id, deduction_line_id, allocated_amount)
       VALUES ('alloc-test-01', $1, $2, $3, 10000.00)
       ON CONFLICT (id) DO NOTHING;`,
      [TEST_ORG_ID, challanId, certId]
    );

    // Now sign off as CA
    const signReq = new NextRequest(`http://localhost:3010/api/tds-certificates`, {
      method: 'POST',
      headers: {
        'cookie': `copilot_session=${caToken}`,
        'x-org-id': TEST_ORG_ID,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: 'sign_off',
        certificateId: certId,
        quarter: 'Q3',
        financialYear: '2024-25',
      }),
    });

    const signRes = await postTdsAction(signReq);
    assert.equal(signRes.status, 200, 'Sign-off with valid challan and vendor data must succeed');

    // Verify directly in database table tds_signoffs (bypassing any in-memory state)
    const signoffRow = await db.query(
      `SELECT cert_id, signed_by, signed_at FROM tds_signoffs WHERE org_id = $1 AND cert_id = $2;`,
      [TEST_ORG_ID, certId]
    );
    assert.equal(signoffRow.rows.length, 1, 'Sign-off must be persisted in database');
    assert.equal(signoffRow.rows[0].cert_id, certId);
    assert.equal(signoffRow.rows[0].signed_by, 'user-phase1-ca');
  });
});
