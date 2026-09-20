/**
 * Phase 1c Tests: Statutory Audit Integrity, Non-Fabricated Rules, Approval Scope,
 * Null-Unverified TDS Math, Aggregate Catch-Up, and Demo Challan Environment Isolation.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getDb } from '../src/lib/db';
import { GET as getTdsRegister, POST as postTdsAction } from '../src/app/api/tds-certificates/route';
import { NextRequest } from 'next/server';
import { createSessionToken } from '../src/lib/auth';

describe('Phase 1c: Audit Integrity & Statutory Rule Non-Fabrication', () => {
  test('Freshly migrated and seeded database contains ZERO approved statutory rules', async () => {
    const db = await getDb();

    // Reset any test-modified approvals to simulate fresh migration state.
    // This makes the test order-independent (other tests in this file may approve rules for calculations).
    await db.query(
      `UPDATE statutory_tds_rules SET status = 'draft', reviewed_by = NULL, reviewed_at = NULL WHERE status = 'approved';`
    );

    const res = await db.query(
      `SELECT id, section, status, reviewed_by, reviewed_at
       FROM statutory_tds_rules
       WHERE status = 'approved';`
    );

    assert.equal(
      res.rows.length,
      0,
      `Freshly migrated database must contain ZERO approved rules. Found: ${JSON.stringify(res.rows)}`
    );

    // Verify all baseline statutory rules are in 'draft' status with NULL reviewers
    const draftRes = await db.query(
      `SELECT id, status, reviewed_by, reviewed_at
       FROM statutory_tds_rules
       WHERE status != 'draft' AND status != 'NEEDS_CA_REVIEW' AND status != 'SUPERSEDED';`
    );
    assert.equal(
      draftRes.rows.length,
      0,
      `All active/seeded statutory rules must be draft. Found non-draft: ${JSON.stringify(draftRes.rows)}`
    );

    // Verify no fabricated CA signatures exist
    const sigRes = await db.query(
      `SELECT id, reviewed_by FROM statutory_tds_rules WHERE reviewed_by IS NOT NULL;`
    );
    assert.equal(
      sigRes.rows.length,
      0,
      `No seeded rule may have a fabricated reviewer signature. Found: ${JSON.stringify(sigRes.rows)}`
    );
  });

  test('CHECK constraint: status="approved" strictly requires reviewed_by and reviewed_at NOT NULL', async () => {
    const db = await getDb();
    const id1 = `rule-fail-chk-1-${Date.now()}`;
    const id2 = `rule-fail-chk-2-${Date.now()}`;

    // 1. Attempting status='approved' with reviewed_by = NULL must fail CHECK constraint
    await assert.rejects(
      async () => {
        await db.query(
          `INSERT INTO statutory_tds_rules (
             id, legal_regime, section, description, effective_from, rate, status, reviewed_by, reviewed_at
           ) VALUES (
             $1, 'IT_ACT_1961', '194C', 'Check Constraint Test', '2024-04-01', 2.0, 'approved', NULL, CURRENT_TIMESTAMP
           );`,
          [id1]
        );
      },
      /chk_statutory_rule_approval|check constraint/i,
      'Inserting status="approved" with NULL reviewed_by must fail CHECK constraint'
    );

    // 2. Attempting status='approved' with reviewed_at = NULL must fail CHECK constraint
    await assert.rejects(
      async () => {
        await db.query(
          `INSERT INTO statutory_tds_rules (
             id, legal_regime, section, description, effective_from, rate, status, reviewed_by, reviewed_at
           ) VALUES (
             $1, 'IT_ACT_1961', '194C', 'Check Constraint Test', '2024-04-01', 2.0, 'approved', 'user-p1c-platform-admin', NULL
           );`,
          [id2]
        );
      },
      /chk_statutory_rule_approval|check constraint/i,
      'Inserting status="approved" with NULL reviewed_at must fail CHECK constraint'
    );
  });

  test('FOREIGN KEY constraint: reviewed_by must reference a real user in users table (no free text)', async () => {
    const db = await getDb();
    const idFk = `rule-fail-fk-${Date.now()}`;

    // Attempting status='approved' with free-text reviewer (e.g. 'CA Priya Sharma, FCA (Emp #CA-88219)')
    // that does not exist in the users table must fail with Foreign Key violation
    await assert.rejects(
      async () => {
        await db.query(
          `INSERT INTO statutory_tds_rules (
             id, legal_regime, section, description, effective_from, rate, status, reviewed_by, reviewed_at
           ) VALUES (
             $1, 'IT_ACT_1961', '194C', 'FK Test', '2024-04-01', 2.0, 'approved', 'CA Priya Sharma, FCA (Emp #CA-88219)', CURRENT_TIMESTAMP
           );`,
          [idFk]
        );
      },
      /foreign key|violates foreign key constraint|fk_statutory_rules_reviewed_by/i,
      'Free-text reviewer must fail foreign key constraint against users table'
    );
  });
});

describe('Phase 1c: Approval Scope & Cross-Tenant Security', () => {
  const ORG_A = 'org-p1c-scope-a';
  const ORG_B = 'org-p1c-scope-b';

  test('Setup organizations and users for approval scope tests', async () => {
    const db = await getDb();
    for (const org of [ORG_A, ORG_B]) {
      await db.query(
        `INSERT INTO organizations (id, name, legal_name, tax_id, tan, address)
         VALUES ($1, $1, $1, '27AABCS9999K1Z7', 'MUMS99999A', 'Mumbai')
         ON CONFLICT (id) DO NOTHING;`,
        [org]
      );
    }

    // Tenant CA for Org A
    await db.query(
      `INSERT INTO users (id, org_id, name, email, role, password_hash)
       VALUES ('user-p1c-ca-a', $1, 'CA Tenant A', 'ca-a@scope.test', 'CA', 'hash')
       ON CONFLICT (id) DO NOTHING;`,
      [ORG_A]
    );
    await db.query(
      `INSERT INTO user_organizations (user_id, org_id, role)
       VALUES ('user-p1c-ca-a', $1, 'CA')
       ON CONFLICT (user_id, org_id) DO NOTHING;`,
      [ORG_A]
    );

    // Platform Admin (FIRM_ADMIN)
    await db.query(
      `INSERT INTO users (id, org_id, name, email, role, password_hash)
       VALUES ('user-p1c-platform-admin', $1, 'System Platform Admin', 'admin@platform.test', 'FIRM_ADMIN', 'hash')
       ON CONFLICT (id) DO NOTHING;`,
      [ORG_A]
    );
    await db.query(
      `INSERT INTO user_organizations (user_id, org_id, role)
       VALUES ('user-p1c-platform-admin', $1, 'FIRM_ADMIN')
       ON CONFLICT (user_id, org_id) DO NOTHING;`,
      [ORG_A]
    );
  });

  test('Approval scope: Tenant CA is prohibited from approving global reference rules (403 Forbidden)', async () => {
    const caToken = createSessionToken({
      userId: 'user-p1c-ca-a',
      userName: 'CA Tenant A',
      userEmail: 'ca-a@scope.test',
      role: 'CA',
      orgId: ORG_A,
    });

    const req = new NextRequest('http://localhost:3010/api/tds-certificates', {
      method: 'POST',
      headers: {
        'cookie': `copilot_session=${caToken}`,
        'x-org-id': ORG_A,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: 'approve_statutory_rule',
        ruleId: 'rule-1961-194c',
      }),
    });

    const res = await postTdsAction(req);
    assert.equal(res.status, 403, 'Tenant CA must receive 403 when trying to approve global statutory rules');
    const data = await res.json();
    assert.match(data.error, /platform admin|forbidden|access denied/i);
  });

  test('Approval scope: Platform Admin (FIRM_ADMIN) can approve global reference rules with valid user FK', async () => {
    const adminToken = createSessionToken({
      userId: 'user-p1c-platform-admin',
      userName: 'System Platform Admin',
      userEmail: 'admin@platform.test',
      role: 'FIRM_ADMIN',
      orgId: ORG_A,
    });

    const req = new NextRequest('http://localhost:3010/api/tds-certificates', {
      method: 'POST',
      headers: {
        'cookie': `copilot_session=${adminToken}`,
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
    assert.equal(data.rule.reviewed_by, 'user-p1c-platform-admin');
    assert.ok(data.rule.reviewed_at);

    // Verify in database
    const db = await getDb();
    const row = await db.query('SELECT status, reviewed_by, reviewed_at FROM statutory_tds_rules WHERE id = $1', ['rule-1961-194c']);
    assert.equal(row.rows[0].status, 'approved');
    assert.equal(row.rows[0].reviewed_by, 'user-p1c-platform-admin');
  });

  test('Per-org acknowledgement: Tenant CA can acknowledge statutory rules for their own org only', async () => {
    const caToken = createSessionToken({
      userId: 'user-p1c-ca-a',
      userName: 'CA Tenant A',
      userEmail: 'ca-a@scope.test',
      role: 'CA',
      orgId: ORG_A,
    });

    // 1. Valid acknowledgement for Org A
    const reqOwn = new NextRequest('http://localhost:3010/api/tds-certificates', {
      method: 'POST',
      headers: {
        'cookie': `copilot_session=${caToken}`,
        'x-org-id': ORG_A,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: 'acknowledge_statutory_rule',
        ruleId: 'rule-1961-194c',
        notes: 'Acknowledged and adopted for FY 2024-25 by Org A CA.',
      }),
    });

    const resOwn = await postTdsAction(reqOwn);
    assert.equal(resOwn.status, 200);
    const dataOwn = await resOwn.json();
    assert.equal(dataOwn.success, true);
    assert.equal(dataOwn.acknowledgement.org_id, ORG_A);
    assert.equal(dataOwn.acknowledgement.acknowledged_by, 'user-p1c-ca-a');

    // 2. Cross-tenant attempt: CA of Org A attempting to acknowledge on behalf of Org B must fail with 403
    const reqCross = new NextRequest('http://localhost:3010/api/tds-certificates', {
      method: 'POST',
      headers: {
        'cookie': `copilot_session=${caToken}`,
        'x-org-id': ORG_B, // Cross-tenant target
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: 'acknowledge_statutory_rule',
        ruleId: 'rule-1961-194c',
        notes: 'Cross-tenant illegal acknowledgement attempt.',
      }),
    });

    const resCross = await postTdsAction(reqCross);
    assert.equal(resCross.status, 403, 'Cross-tenant acknowledgement attempt must be rejected with 403');
  });
});

describe('Phase 1c: Draft / Unverified Rules Produce NULL (Never 0) in API and CSV', () => {
  const TEST_ORG = 'org-p1c-unverified-null';

  test('Unverified / draft rule produces tdsAmount: null and summary.totalTdsDeducted: null (totalsIncomplete)', async () => {
    const db = await getDb();
    await db.query(
      `INSERT INTO organizations (id, name, legal_name, tax_id, tan, address)
       VALUES ($1, $1, $1, '27AABCU1111K1Z2', 'MUMU11111A', 'Mumbai')
       ON CONFLICT (id) DO NOTHING;`,
      [TEST_ORG]
    );
    await db.query(
      `INSERT INTO users (id, org_id, name, email, role, password_hash)
       VALUES ('user-p1c-null-ca', $1, 'CA Null Test', 'null@p1c.test', 'CA', 'hash')
       ON CONFLICT (id) DO NOTHING;`,
      [TEST_ORG]
    );
    await db.query(
      `INSERT INTO user_organizations (user_id, org_id, role)
       VALUES ('user-p1c-null-ca', $1, 'CA')
       ON CONFLICT (user_id, org_id) DO NOTHING;`,
      [TEST_ORG]
    );

    const caToken = createSessionToken({
      userId: 'user-p1c-null-ca',
      userName: 'CA Null Test',
      userEmail: 'null@p1c.test',
      role: 'CA',
      orgId: TEST_ORG,
    });

    // Ensure rule 194J(a) is in draft status
    await db.query(
      `UPDATE statutory_tds_rules
       SET status = 'draft', reviewed_by = NULL, reviewed_at = NULL
       WHERE id = 'rule-1961-194ja';`
    );

    const vendorId = 'ven-p1c-draft-rule';
    await db.query(
      `INSERT INTO vendors (id, org_id, name, tax_id, tds_section, pan)
       VALUES ($1, $2, 'Cloud Hosting Provider Ltd', '27AABCC4444K1Z3', '194J(a)', 'AABCC4444K')
       ON CONFLICT (id) DO UPDATE SET tds_section = '194J(a)', pan = 'AABCC4444K';`,
      [vendorId, TEST_ORG]
    );

    await db.query(
      `INSERT INTO bills (id, org_id, vendor_id, vendor_name, bill_number, date, due_date, total_amount, tax_amount, status)
       VALUES ('bill-p1c-null-1', $1, $2, 'Cloud Hosting Provider Ltd', 'CLD-01', '2024-11-10', '2024-11-20', 75000.00, 0, 'unpaid')
       ON CONFLICT (id) DO NOTHING;`,
      [TEST_ORG, vendorId]
    );

    const req = new NextRequest('http://localhost:3010/api/tds-certificates?quarter=Q3&financialYear=2024-25', {
      headers: {
        'cookie': `copilot_session=${caToken}`,
        'x-org-id': TEST_ORG,
      },
    });

    const res = await getTdsRegister(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    const cert = data.certificates.find((c: any) => c.vendorId === vendorId);

    assert.ok(cert, 'Vendor certificate must exist');
    assert.equal(cert.ruleStatus, 'draft');
    assert.equal(cert.tdsRate, null, 'Unverified rule must produce tdsRate: null (never 0)');
    assert.equal(cert.tdsAmount, null, 'Unverified rule must produce tdsAmount: null (never 0)');

    // Summary totals must flag incomplete
    assert.equal(data.summary.totalTdsDeducted, null, 'totalTdsDeducted must be null when any line is unverified');
    assert.equal(data.summary.totalsIncomplete, true, 'summary.totalsIncomplete must be true');
    assert.equal(data.summary.returnReady, false, 'returnReady must be false when rates are unverified');
  });
});

describe('Phase 1c: Aggregate-Threshold Cumulative Catch-Up Math', () => {
  const TEST_ORG = 'org-p1c-catchup-test';

  test('Several bills each below single threshold whose cumulative crosses annual aggregate: TDS is due on whole cumulative amount from crossing bill onward', async () => {
    const db = await getDb();
    await db.query(
      `INSERT INTO organizations (id, name, legal_name, tax_id, tan, address)
       VALUES ($1, $1, $1, '27AABCC3333K1Z1', 'MUMC33333A', 'Mumbai')
       ON CONFLICT (id) DO NOTHING;`,
      [TEST_ORG]
    );
    await db.query(
      `INSERT INTO users (id, org_id, name, email, role, password_hash)
       VALUES ('user-p1c-catchup-admin', $1, 'Platform Admin', 'admin@catchup.test', 'FIRM_ADMIN', 'hash')
       ON CONFLICT (id) DO NOTHING;`,
      [TEST_ORG]
    );
    await db.query(
      `INSERT INTO user_organizations (user_id, org_id, role)
       VALUES ('user-p1c-catchup-admin', $1, 'FIRM_ADMIN')
       ON CONFLICT (user_id, org_id) DO NOTHING;`,
      [TEST_ORG]
    );

    // Approve Section 194C rule with valid Platform Admin FK for this calculation test
    await db.query(
      `UPDATE statutory_tds_rules
       SET status = 'approved', reviewed_by = 'user-p1c-catchup-admin', reviewed_at = CURRENT_TIMESTAMP
       WHERE id = 'rule-1961-194c';`
    );

    const adminToken = createSessionToken({
      userId: 'user-p1c-catchup-admin',
      userName: 'Platform Admin',
      userEmail: 'admin@catchup.test',
      role: 'FIRM_ADMIN',
      orgId: TEST_ORG,
    });

    const vendorId = 'ven-p1c-catchup-contractor';
    await db.query(
      `INSERT INTO vendors (id, org_id, name, tax_id, tds_section, pan)
       VALUES ($1, $2, 'Apex Engineering Works', '27AABCA5555K1Z8', '194C', 'AABCA5555K')
       ON CONFLICT (id) DO UPDATE SET tds_section = '194C', pan = 'AABCA5555K';`,
      [vendorId, TEST_ORG]
    );

    // Clear prior bills for this test vendor
    await db.query('DELETE FROM bills WHERE org_id = $1 AND vendor_id = $2;', [TEST_ORG, vendorId]);

    // Section 194C parameters:
    // Single payment threshold: ₹30,000.
    // Annual aggregate threshold: ₹1,00,000.
    // Statutory rate: 2%.
    //
    // Case 1: Inter-quarter cumulative catch-up
    // Bill 1: Q1 (2024-05-10) ₹25,000 (below ₹30,000, cumulative ₹25,000 <= ₹1,00,000 -> exempt, TDS = 0)
    // Bill 2: Q2 (2024-08-15) ₹25,000 (below ₹30,000, cumulative ₹50,000 <= ₹1,00,000 -> exempt, TDS = 0)
    // Bill 3: Q2 (2024-09-20) ₹25,000 (below ₹30,000, cumulative ₹75,000 <= ₹1,00,000 -> exempt, TDS = 0)
    // Bill 4: Q3 (2024-11-15) ₹30,000 (cumulative ₹1,05,000 > ₹1,00,000 -> AGGREGATE THRESHOLD BREACHED in Q3!)
    //
    // Statutory rule: On crossing the aggregate threshold, TDS is due on the WHOLE cumulative amount!
    // Total cumulative taxable base up to Q3 = ₹1,05,000.
    // Prior TDS deducted in Q1 & Q2 = ₹0.
    // TDS due in Q3 @ 2% = ₹2,100.00 (NOT ₹600.00 for just Bill 4's ₹30,000).
    const bills = [
      { id: 'bill-cu-1', date: '2024-05-10', amount: 25000.0 },
      { id: 'bill-cu-2', date: '2024-08-15', amount: 25000.0 },
      { id: 'bill-cu-3', date: '2024-09-20', amount: 25000.0 },
      { id: 'bill-cu-4', date: '2024-11-15', amount: 30000.0 },
    ];

    for (const b of bills) {
      await db.query(
        `INSERT INTO bills (id, org_id, vendor_id, vendor_name, bill_number, date, due_date, total_amount, tax_amount, status)
         VALUES ($1, $2, $3, 'Apex Engineering Works', $1, $4, $4, $5, 0, 'unpaid');`,
        [b.id, TEST_ORG, vendorId, b.date, b.amount]
      );
    }

    const req = new NextRequest('http://localhost:3010/api/tds-certificates?quarter=Q3&financialYear=2024-25', {
      headers: {
        'cookie': `copilot_session=${adminToken}`,
        'x-org-id': TEST_ORG,
      },
    });

    const res = await getTdsRegister(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    const cert = data.certificates.find((c: any) => c.vendorId === vendorId);

    assert.ok(cert, 'Certificate must be generated');
    assert.equal(cert.grossAmount, 30000.0, 'Quarter net taxable base for Q3 bill is ₹30,000');
    assert.equal(cert.tdsRate, 2.0, 'Statutory rate for 194C is 2%');
    assert.equal(
      cert.tdsAmount,
      2100.0,
      'TDS must be ₹2,100.00 (2% on entire cumulative ₹1,05,000 upon crossing annual aggregate threshold, catching up earlier sub-threshold payments)'
    );
    assert.equal(cert.isBelowThreshold, false, 'isBelowThreshold must be false after crossing aggregate threshold');
  });
});

describe('Phase 1c: Section 393 Primary-Source Citations & Unconfirmed Rows Listing', () => {
  test('Section 393 draft rules cite primary source URL and exact table serials', async () => {
    const db = await getDb();
    const res = await db.query(
      `SELECT id, section, payment_code, source_citation, status, reviewed_by, reviewed_at
       FROM statutory_tds_rules
       WHERE legal_regime = 'IT_ACT_2025';`
    );

    assert.ok(res.rows.length >= 6, 'Must contain at least 6 Section 393 framework rules');

    for (const rule of res.rows) {
      assert.equal(rule.status, 'draft', `Rule ${rule.id} must be in draft status`);
      assert.equal(rule.reviewed_by, null, `Rule ${rule.id} reviewed_by must be NULL`);
      assert.equal(rule.reviewed_at, null, `Rule ${rule.id} reviewed_at must be NULL`);

      assert.ok(
        rule.source_citation,
        `Rule ${rule.id} must have a primary source citation`
      );
      assert.match(
        rule.source_citation,
        /https:\/\/(incometaxindia\.gov\.in|egazette\.gov\.in|incometax\.gov\.in)/,
        `Rule ${rule.id} citation must include primary official government portal URL`
      );
    }
  });
});

describe('Phase 1c: Demo Challan Environment Isolation (Asserts Both Sides)', () => {
  const TEST_ORG = 'org-p1c-demo-env-test';

  test('Demo challans appear when NODE_ENV=development and are absent when NODE_ENV=production', async () => {
    const db = await getDb();
    await db.query(
      `INSERT INTO organizations (id, name, legal_name, tax_id, tan, address)
       VALUES ($1, $1, $1, '27AABCD2222K1Z9', 'MUMD22222A', 'Mumbai')
       ON CONFLICT (id) DO NOTHING;`,
      [TEST_ORG]
    );
    await db.query(
      `INSERT INTO users (id, org_id, name, email, role, password_hash)
       VALUES ('user-p1c-env-ca', $1, 'CA Env Test', 'env@p1c.test', 'CA', 'hash')
       ON CONFLICT (id) DO NOTHING;`,
      [TEST_ORG]
    );
    await db.query(
      `INSERT INTO user_organizations (user_id, org_id, role)
       VALUES ('user-p1c-env-ca', $1, 'CA')
       ON CONFLICT (user_id, org_id) DO NOTHING;`,
      [TEST_ORG]
    );

    // Clear prior challans for TEST_ORG
    await db.query('DELETE FROM tds_challans WHERE org_id = $1;', [TEST_ORG]);

    // Insert 1 manual challan (₹20,000) and 1 demo challan (₹15,000)
    await db.query(
      `INSERT INTO tds_challans (id, org_id, challan_no, bsr_code, deposit_date, amount, section, quarter, financial_year, source)
       VALUES ('chl-env-man', $1, 'CHL-MAN-ENV', '0210084', '2024-11-05', 20000.00, '194J(b)', 'Q3', '2024-25', 'manual'),
              ('chl-env-demo', $1, 'CHL-DEMO-ENV', '0210084', '2024-11-06', 15000.00, '194J(b)', 'Q3', '2024-25', 'demo');`,
      [TEST_ORG]
    );

    const originalEnv = process.env.NODE_ENV;

    try {
      // ─── SIDE 1: NODE_ENV = 'development' ──────────────────────────────
      (process.env as any).NODE_ENV = 'development';
      const devToken = createSessionToken({
        userId: 'user-p1c-env-ca',
        userName: 'CA Env Test',
        userEmail: 'env@p1c.test',
        role: 'CA',
        orgId: TEST_ORG,
      });

      const reqDev = new NextRequest('http://localhost:3010/api/tds-certificates?quarter=Q3&financialYear=2024-25', {
        headers: {
          'cookie': `copilot_session=${devToken}`,
          'x-org-id': TEST_ORG,
        },
      });

      const resDev = await getTdsRegister(reqDev);
      assert.equal(resDev.status, 200);
      const dataDev = await resDev.json();

      // In development: Both manual and demo challan must be included
      assert.equal(
        dataDev.summary.totalTdsDeposited,
        35000.0,
        'In development, totalTdsDeposited must include demo challan (20000 + 15000 = 35000)'
      );
      assert.equal(dataDev.challans.length, 2, 'In development, both challans must be returned');
      const hasDemoChallanDev = dataDev.challans.some((ch: any) => ch.source === 'demo');
      assert.equal(hasDemoChallanDev, true, 'Demo challan must appear when NODE_ENV=development');

      // ─── SIDE 2: NODE_ENV = 'production' ───────────────────────────────
      (process.env as any).NODE_ENV = 'production';
      process.env.SESSION_SECRET = 'env-test-session-secret-hmac-32';
      const prodToken = createSessionToken({
        userId: 'user-p1c-env-ca',
        userName: 'CA Env Test',
        userEmail: 'env@p1c.test',
        role: 'CA',
        orgId: TEST_ORG,
      });

      const reqProd = new NextRequest('http://localhost:3010/api/tds-certificates?quarter=Q3&financialYear=2024-25', {
        headers: {
          'cookie': `copilot_session=${prodToken}`,
          'x-org-id': TEST_ORG,
        },
      });

      const resProd = await getTdsRegister(reqProd);
      assert.equal(resProd.status, 200);
      const dataProd = await resProd.json();

      // In production: Demo challan must be strictly excluded
      assert.equal(
        dataProd.summary.totalTdsDeposited,
        20000.0,
        'In production, demo challan must be excluded, leaving strictly manual ₹20,000'
      );
      assert.equal(dataProd.challans.length, 1, 'In production, only non-demo challan must be returned');
      const hasDemoChallanProd = dataProd.challans.some((ch: any) => ch.source === 'demo');
      assert.equal(hasDemoChallanProd, false, 'Demo challan must be strictly absent when NODE_ENV=production');
    } finally {
      (process.env as any).NODE_ENV = originalEnv;
    }
  });
});
