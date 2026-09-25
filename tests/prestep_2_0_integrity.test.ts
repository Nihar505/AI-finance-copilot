/**
 * Pre-step 2.0 Tests: Statutory TDS Integrity, Platform Admin Auth,
 * Attestation & Hash Invalidation, Section 206AA Penal Calculation, and Section 393 Cleanup.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getDb } from '../src/lib/db';
import { GET as getTdsRegister, POST as postTdsAction } from '../src/app/api/tds-certificates/route';
import { NextRequest } from 'next/server';
import { createSessionToken } from '../src/lib/auth';
import { computeRuleContentHash } from '../src/lib/statutoryRules';

describe('Pre-step 2.0: Platform Admin Authorization & DB Isolation', () => {
  const ORG_A = 'org-p20-auth-a';
  const ORG_B = 'org-p20-auth-b';

  test('Fresh / production-mode database contains ZERO platform admins', async () => {
    const db = await getDb();
    const res = await db.query(
      `SELECT id, email, role, is_platform_admin FROM users WHERE is_platform_admin = TRUE;`
    );
    // Any test-granted platform admins shouldn't leak from migrations or baseline seed
    const seededAdmins = await db.query(
      `SELECT id, email, role FROM users WHERE email = 'admin@financecopilot.internal' AND is_platform_admin = TRUE;`
    );
    assert.equal(
      seededAdmins.rows.length,
      0,
      'admin@financecopilot.internal must NOT be seeded as platform admin'
    );
  });

  test('FIRM_ADMIN of Org A without platform admin rights receives 403 Forbidden on approve_statutory_rule', async () => {
    const db = await getDb();
    await db.query(
      `INSERT INTO organizations (id, name, legal_name, tax_id, tan, address)
       VALUES ($1, $1, $1, '27AABCT1111K1Z1', 'MUMT11111A', 'Mumbai')
       ON CONFLICT (id) DO NOTHING;`,
      [ORG_A]
    );

    const firmAdminId = 'user-p20-firm-admin-org-a';
    await db.query(
      `INSERT INTO users (id, org_id, name, email, role, password_hash, is_platform_admin)
       VALUES ($1, $2, 'Firm Admin Org A', 'firmadmin@orga.test', 'FIRM_ADMIN', 'hash', FALSE)
       ON CONFLICT (id) DO UPDATE SET is_platform_admin = FALSE;`,
      [firmAdminId, ORG_A]
    );
    await db.query(
      `INSERT INTO user_organizations (user_id, org_id, role)
       VALUES ($1, $2, 'FIRM_ADMIN')
       ON CONFLICT (user_id, org_id) DO NOTHING;`,
      [firmAdminId, ORG_A]
    );

    const token = createSessionToken({
      userId: firmAdminId,
      userName: 'Firm Admin Org A',
      userEmail: 'firmadmin@orga.test',
      role: 'FIRM_ADMIN',
      orgId: ORG_A,
    });

    const req = new NextRequest('http://localhost:3010/api/tds-certificates', {
      method: 'POST',
      headers: {
        'cookie': `copilot_session=${token}`,
        'x-org-id': ORG_A,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: 'approve_statutory_rule',
        ruleId: 'rule-1961-194c',
      }),
    });

    const res = await postTdsAction(req);
    assert.equal(res.status, 403, 'Tenant FIRM_ADMIN without platform admin rights must be rejected with 403');
    const data = await res.json();
    assert.match(data.error, /platform admin privileges/i);
  });

  test('Platform Admin (is_platform_admin = TRUE) successfully approves draft statutory rule', async () => {
    const db = await getDb();
    const platAdminId = 'user-p20-real-platform-admin';
    await db.query(
      `INSERT INTO users (id, org_id, name, email, role, password_hash, is_platform_admin)
       VALUES ($1, $2, 'Real Platform Admin', 'platformadmin@global.internal', 'FIRM_ADMIN', 'hash', TRUE)
       ON CONFLICT (id) DO UPDATE SET is_platform_admin = TRUE;`,
      [platAdminId, ORG_A]
    );

    const token = createSessionToken({
      userId: platAdminId,
      userName: 'Real Platform Admin',
      userEmail: 'platformadmin@global.internal',
      role: 'FIRM_ADMIN',
      orgId: ORG_A,
    });

    // Reset rule to draft
    await db.query(
      `UPDATE statutory_tds_rules SET status = 'draft', reviewed_by = NULL, reviewed_at = NULL WHERE id = 'rule-1961-194c';`
    );

    const req = new NextRequest('http://localhost:3010/api/tds-certificates', {
      method: 'POST',
      headers: {
        'cookie': `copilot_session=${token}`,
        'x-org-id': ORG_A,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: 'approve_statutory_rule',
        ruleId: 'rule-1961-194c',
      }),
    });

    const res = await postTdsAction(req);
    assert.equal(res.status, 200, 'Platform admin approval must succeed');
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.rule.status, 'approved');
    assert.equal(data.rule.reviewed_by, platAdminId);
  });
});

describe('Pre-step 2.0: Acknowledgement Attestation & Content Hash Invalidation', () => {
  const TEST_ORG = 'org-p20-ack-integrity';

  test('acknowledge_statutory_rule rejects missing or trivial attestation (< 30 chars or non-statutory)', async () => {
    const db = await getDb();
    await db.query(
      `INSERT INTO organizations (id, name, legal_name, tax_id, tan, address)
       VALUES ($1, $1, $1, '27AABCT2222K1Z2', 'MUMT22222A', 'Mumbai')
       ON CONFLICT (id) DO NOTHING;`,
      [TEST_ORG]
    );

    const caId = 'user-p20-ack-ca';
    await db.query(
      `INSERT INTO users (id, org_id, name, email, role, password_hash)
       VALUES ($1, $2, 'CA Ack Tester', 'ca-ack@test.internal', 'CA', 'hash')
       ON CONFLICT (id) DO NOTHING;`,
      [caId, TEST_ORG]
    );
    await db.query(
      `INSERT INTO user_organizations (user_id, org_id, role)
       VALUES ($1, $2, 'CA')
       ON CONFLICT (user_id, org_id) DO NOTHING;`,
      [caId, TEST_ORG]
    );

    const token = createSessionToken({
      userId: caId,
      userName: 'CA Ack Tester',
      userEmail: 'ca-ack@test.internal',
      role: 'CA',
      orgId: TEST_ORG,
    });

    // 1. Missing attestation text -> 400
    const reqMissing = new NextRequest('http://localhost:3010/api/tds-certificates', {
      method: 'POST',
      headers: {
        'cookie': `copilot_session=${token}`,
        'x-org-id': TEST_ORG,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: 'acknowledge_statutory_rule',
        ruleId: 'rule-1961-194ja',
      }),
    });
    const resMissing = await postTdsAction(reqMissing);
    assert.equal(resMissing.status, 400);

    // 2. Trivial short text -> 400
    const reqShort = new NextRequest('http://localhost:3010/api/tds-certificates', {
      method: 'POST',
      headers: {
        'cookie': `copilot_session=${token}`,
        'x-org-id': TEST_ORG,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: 'acknowledge_statutory_rule',
        ruleId: 'rule-1961-194ja',
        attestationText: 'looks good',
      }),
    });
    const resShort = await postTdsAction(reqShort);
    assert.equal(resShort.status, 400);

    // 3. 30+ chars but lacking statutory keywords -> 400
    const reqNoKeywords = new NextRequest('http://localhost:3010/api/tds-certificates', {
      method: 'POST',
      headers: {
        'cookie': `copilot_session=${token}`,
        'x-org-id': TEST_ORG,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: 'acknowledge_statutory_rule',
        ruleId: 'rule-1961-194ja',
        attestationText: 'This is a long sentence that is over thirty characters long but has nothing meaningful.',
      }),
    });
    const resNoKeywords = await postTdsAction(reqNoKeywords);
    assert.equal(resNoKeywords.status, 400);
  });

  test('Substantive attestation computes and stores rule_version_hash in database', async () => {
    const caId = 'user-p20-ack-ca';
    const token = createSessionToken({
      userId: caId,
      userName: 'CA Ack Tester',
      userEmail: 'ca-ack@test.internal',
      role: 'CA',
      orgId: TEST_ORG,
    });

    const attestationText = 'I confirm that I have verified and acknowledge this statutory TDS rule for this organization.';
    const req = new NextRequest('http://localhost:3010/api/tds-certificates', {
      method: 'POST',
      headers: {
        'cookie': `copilot_session=${token}`,
        'x-org-id': TEST_ORG,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: 'acknowledge_statutory_rule',
        ruleId: 'rule-1961-194ja',
        attestationText,
      }),
    });

    const res = await postTdsAction(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.acknowledgement.rule_version_hash, 'rule_version_hash must be saved');
    assert.equal(data.acknowledgement.rule_version_hash.length, 64);
    assert.equal(data.acknowledgement.attestation_text, attestationText);

    // Check DB
    const db = await getDb();
    const ackRow = await db.query(
      `SELECT rule_version_hash, attestation_text, invalidated_at FROM org_statutory_acknowledgements WHERE org_id = $1 AND rule_id = $2;`,
      [TEST_ORG, 'rule-1961-194ja']
    );
    assert.equal(ackRow.rows.length, 1);
    assert.equal(ackRow.rows[0].invalidated_at, null);
  });

  test('Updating rule rate or threshold in DB automatically invalidates acknowledgement', async () => {
    const db = await getDb();

    // Mutate the rate on rule-1961-194ja
    await db.query(
      `UPDATE statutory_tds_rules SET rate = 2.5 WHERE id = 'rule-1961-194ja';`
    );

    // Verify trigger set invalidated_at
    const ackRow = await db.query(
      `SELECT rule_version_hash, invalidated_at FROM org_statutory_acknowledgements WHERE org_id = $1 AND rule_id = $2;`,
      [TEST_ORG, 'rule-1961-194ja']
    );
    assert.equal(ackRow.rows.length, 1);
    assert.ok(ackRow.rows[0].invalidated_at !== null, 'invalidated_at must be populated on rule mutation');

    // Restore rate
    await db.query(
      `UPDATE statutory_tds_rules SET rate = 2.0 WHERE id = 'rule-1961-194ja';`
    );
  });
});

describe('Pre-step 2.0: Canonicalization & Content Hash Invariance', () => {
  test('computeRuleContentHash produces identical hashes for 2 vs 2.0 vs 2.0000', () => {
    const hash1 = computeRuleContentHash({
      regime: 'IT_ACT_1961',
      section: '194C',
      sub_section: null,
      payment_code: '94C',
      rate: 2,
      single_transaction_threshold: 30000,
      aggregate_annual_threshold: 100000,
      effective_from: '2024-04-01',
    });

    const hash2 = computeRuleContentHash({
      regime: 'IT_ACT_1961',
      section: '194C',
      sub_section: null,
      payment_code: '94C',
      rate: 2.0,
      single_transaction_threshold: '30000.00',
      aggregate_annual_threshold: '100000.0000',
      effective_from: '2024-04-01',
    });

    const hash3 = computeRuleContentHash({
      legal_regime: 'it_act_1961',
      section: ' 194C ',
      paymentCode: '94C',
      rate_percent: '2.0000',
      thresholdSingle: 30000.0,
      thresholdAggregate: 100000.0,
      effectiveFrom: new Date('2024-04-01T00:00:00Z'),
    });

    assert.equal(hash1, hash2, 'Hash must be identical across integer and float representations');
    assert.equal(hash1, hash3, 'Hash must be identical across property aliases and Date objects');
  });

  test('computeRuleContentHash changes when rate, threshold, payment_code, or effective date changes', () => {
    const base = {
      regime: 'IT_ACT_1961',
      section: '194C',
      payment_code: '94C',
      rate: 2.0,
      single_transaction_threshold: 30000,
      aggregate_annual_threshold: 100000,
      effective_from: '2024-04-01',
    };
    const baseHash = computeRuleContentHash(base);

    const diffRateHash = computeRuleContentHash({ ...base, rate: 1.0 });
    assert.notEqual(baseHash, diffRateHash, 'Changing rate must produce different hash');

    const diffSingleHash = computeRuleContentHash({ ...base, single_transaction_threshold: 50000 });
    assert.notEqual(baseHash, diffSingleHash, 'Changing single threshold must produce different hash');

    const diffAggHash = computeRuleContentHash({ ...base, aggregate_annual_threshold: 200000 });
    assert.notEqual(baseHash, diffAggHash, 'Changing aggregate threshold must produce different hash');

    const diffPayCodeHash = computeRuleContentHash({ ...base, payment_code: '94J' });
    assert.notEqual(baseHash, diffPayCodeHash, 'Changing payment_code must produce different hash');

    const diffDateHash = computeRuleContentHash({ ...base, effective_from: '2025-04-01' });
    assert.notEqual(baseHash, diffDateHash, 'Changing effective_from must produce different hash');
  });
});

describe('Pre-step 2.0: Section 393 Statutory Cleanup & Citations', () => {
  test('Section 393 rows have unconfirmed fields NULL in database', async () => {
    const db = await getDb();
    const rows = await db.query(
      `SELECT id, section, payment_code, threshold_single, threshold_aggregate, source_citation, status
       FROM statutory_tds_rules
       WHERE legal_regime = 'IT_ACT_2025' AND id LIKE 'rule-2025-%';`
    );

    assert.ok(rows.rows.length > 0, 'Section 393 rows must exist');
    for (const r of rows.rows) {
      assert.equal(r.payment_code, null, `Rule ${r.id} payment_code must be NULL`);
      assert.equal(r.threshold_single, null, `Rule ${r.id} threshold_single must be NULL`);
      assert.equal(r.threshold_aggregate, null, `Rule ${r.id} threshold_aggregate must be NULL`);
      assert.equal(r.source_citation, null, `Rule ${r.id} source_citation must be NULL (no unverified constructed deep links)`);
      assert.equal(r.status, 'draft', `Rule ${r.id} status must be draft`);
    }

    const unconfirmedSecRules = await db.query(
      `SELECT id, section FROM statutory_tds_rules WHERE id IN ('rule-2025-sec393-commission', 'rule-2025-sec393-goods', 'rule-2025-sec393-framework');`
    );
    for (const r of unconfirmedSecRules.rows) {
      assert.equal(r.section, null, `Unconfirmed section for ${r.id} must be NULL`);
    }
  });
});

describe('Pre-step 2.0: Section 206AA Penal Rate Calculation', () => {
  const TEST_ORG = 'org-p20-206aa';

  test('Missing PAN with known statutory section applies Section 206AA (20% or statutory, whichever higher)', async () => {
    const db = await getDb();
    await db.query(
      `INSERT INTO organizations (id, name, legal_name, tax_id, tan, address)
       VALUES ($1, $1, $1, '27AABCT3333K1Z3', 'MUMT33333A', 'Mumbai')
       ON CONFLICT (id) DO NOTHING;`,
      [TEST_ORG]
    );

    const adminId = 'user-p20-206aa-admin';
    await db.query(
      `INSERT INTO users (id, org_id, name, email, role, password_hash, is_platform_admin)
       VALUES ($1, $2, 'Platform Admin', 'admin@206aa.test', 'FIRM_ADMIN', 'hash', TRUE)
       ON CONFLICT (id) DO UPDATE SET is_platform_admin = TRUE;`,
      [adminId, TEST_ORG]
    );
    await db.query(
      `INSERT INTO user_organizations (user_id, org_id, role)
       VALUES ($1, $2, 'FIRM_ADMIN')
       ON CONFLICT (user_id, org_id) DO NOTHING;`,
      [adminId, TEST_ORG]
    );

    // Approve rule-1961-194c (statutory rate 2%)
    await db.query(
      `UPDATE statutory_tds_rules
       SET status = 'approved', reviewed_by = $1, reviewed_at = CURRENT_TIMESTAMP
       WHERE id = 'rule-1961-194c';`,
      [adminId]
    );

    // Vendor with Section 194C, but neither PAN nor GSTIN is present
    const noPanVendorId = 'ven-p20-no-pan';
    await db.query(
      `INSERT INTO vendors (id, org_id, name, tax_id, tds_section, pan)
       VALUES ($1, $2, 'Vendor Without PAN Pvt Ltd', NULL, '194C', NULL)
       ON CONFLICT (id) DO UPDATE SET tax_id = NULL, tds_section = '194C', pan = NULL;`,
      [noPanVendorId, TEST_ORG]
    );

    await db.query(
      `INSERT INTO bills (id, org_id, vendor_id, vendor_name, bill_number, date, due_date, total_amount, tax_amount, status)
       VALUES ('bill-206aa-1', $1, $2, 'Vendor Without PAN Pvt Ltd', 'BILL-NP-01', '2024-11-12', '2024-11-22', 50000.00, 0, 'unpaid')
       ON CONFLICT (id) DO NOTHING;`,
      [TEST_ORG, noPanVendorId]
    );

    const adminToken = createSessionToken({
      userId: adminId,
      userName: 'Platform Admin',
      userEmail: 'admin@206aa.test',
      role: 'FIRM_ADMIN',
      orgId: TEST_ORG,
    });

    const req = new NextRequest('http://localhost:3010/api/tds-certificates?quarter=Q3&financialYear=2024-25', {
      headers: {
        'cookie': `copilot_session=${adminToken}`,
        'x-org-id': TEST_ORG,
      },
    });

    const res = await getTdsRegister(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    const cert = data.certificates.find((c: any) => c.vendorId === noPanVendorId);

    assert.ok(cert, 'Certificate must exist for vendor without PAN');
    // Section 206AA: Higher of 20% or statutory rate (2%). So rate must be 20.0%!
    assert.equal(cert.tdsRate, 20.0, 'Rate must be 20% under Section 206AA');
    assert.equal(cert.tdsAmount, 10000.0, 'TDS must be ₹10,000 (20% of ₹50,000)');
    assert.ok(cert.missingFields?.includes('vendor_pan'), 'missingFields must contain vendor_pan');
    assert.match(cert.sectionDescription, /Section 206AA Penal Rate Applied/i);
  });
});
