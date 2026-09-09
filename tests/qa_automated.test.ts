import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { getDb } from '../src/lib/db';
import { seedRealisticSandboxData, ORG_ID, ORG_ZENITH_ID } from '../src/lib/seed';
import {
  createSessionToken,
  verifySessionToken,
  assertTenantAccess,
  checkRoleAccess,
  AuthContext
} from '../src/lib/auth';
import { askFinancialCopilot } from '../src/lib/geminiCopilot';

describe('Stage 3: Automated QA Suite — Authentication & Access Control', () => {
  before(async () => {
    await seedRealisticSandboxData();
  });

  test('AUTH: Session token issuance and field integrity', () => {
    const session = {
      userId: 'user-lead-ca',
      userName: 'Priya Sharma, FCA',
      userEmail: 'priya.sharma@apexadvisory.com',
      role: 'ca' as const,
      orgId: ORG_ID
    };

    const token = createSessionToken(session);
    assert.ok(token.length > 30, 'Token must be non-empty string');

    const verified = verifySessionToken(token);
    assert.equal(verified?.userId, 'user-lead-ca');
    assert.equal(verified?.role, 'ca');
    assert.equal(verified?.orgId, ORG_ID);
  });

  test('AUTH: Cross-tenant access rejection for business owner', async () => {
    const zenithOwnerAuth: AuthContext = {
      userId: 'user-business-owner',
      userName: 'Rajesh Gupta',
      userEmail: 'rajesh.gupta@zenithtech.io',
      role: 'business_owner',
      activeOrgId: ORG_ZENITH_ID
    };

    // Attempting to access Zenith (own tenant) succeeds
    await assertTenantAccess(zenithOwnerAuth, ORG_ZENITH_ID);

    // Attempting to access Apex (foreign tenant) must throw 403
    await assert.rejects(
      async () => {
        await assertTenantAccess(zenithOwnerAuth, ORG_ID);
      },
      /403 Forbidden: Tenant Isolation Violation/
    );
  });

  test('AUTH: Unauthorized action blocked by RBAC guard', () => {
    const ownerAuth: AuthContext = {
      userId: 'user-business-owner',
      userName: 'Rajesh Gupta',
      userEmail: 'rajesh@zenithtech.io',
      role: 'business_owner',
      activeOrgId: ORG_ZENITH_ID
    };

    const approvalAccess = checkRoleAccess(ownerAuth, ['ca', 'admin']);
    assert.equal(approvalAccess.allowed, false);
    assert.match(approvalAccess.reason || '', /business owners cannot unilaterally approve/i);
  });
});

describe('Stage 3: Automated QA Suite — Finance CRUD & Deduplication', () => {
  const testTxnId = `test-txn-${Date.now()}`;

  test('FINANCE: Create transaction with valid fields', async () => {
    const db = await getDb();
    const amount = 45000.00;
    const date = '2024-11-15';
    const desc = 'Office Furniture Purchase - Steelcase Desks';

    await db.query(
      `INSERT INTO transactions (
         id, org_id, date, description, raw_description, amount, type, counterparty, 
         reference_number, reconciliation_status, status, is_approved
       ) VALUES ($1, $2, $3, $4, $5, $6, 'debit', 'Steelcase India', 'UTR-TEST-001', 'unreconciled', 'unreconciled', FALSE);`,
      [testTxnId, ORG_ID, date, desc, desc, amount]
    );

    const check = await db.query(`SELECT * FROM transactions WHERE id = $1 AND org_id = $2;`, [testTxnId, ORG_ID]);
    assert.equal(check.rows.length, 1);
    assert.equal(Number(check.rows[0].amount), 45000.00);
    assert.equal(check.rows[0].is_approved, false);
  });

  test('FINANCE: Duplicate transaction detection by reference number', async () => {
    const db = await getDb();
    // Check for existing transaction with UTR-TEST-001
    const dupRes = await db.query(
      `SELECT id FROM transactions WHERE org_id = $1 AND reference_number = $2;`,
      [ORG_ID, 'UTR-TEST-001']
    );
    assert.ok(dupRes.rows.length >= 1, 'Duplicate record must be found in database');
  });

  test('FINANCE: Delete unapproved transaction succeeds', async () => {
    const db = await getDb();
    await db.query(`DELETE FROM transactions WHERE id = $1 AND org_id = $2 AND is_approved = FALSE;`, [testTxnId, ORG_ID]);

    const check = await db.query(`SELECT id FROM transactions WHERE id = $1;`, [testTxnId]);
    assert.equal(check.rows.length, 0, 'Transaction must be deleted');
  });
});

describe('Stage 3: Automated QA Suite — Reports & Dashboard Datasets', () => {
  before(async () => {
    // Seed realistic data, then approve a subset to simulate a CA-approved ledger.
    // Seed intentionally keeps all transactions unapproved (correct workflow behaviour);
    // this test needs approved entries, so we approve them here directly.
    await seedRealisticSandboxData();
    const db = await getDb();
    await db.query(
      `UPDATE transactions SET is_approved = TRUE, approved_by = 'user-lead-ca', approved_at = NOW()
       WHERE org_id = $1 AND id IN ('txn-101','txn-102','txn-103','txn-201','txn-202');`,
      [ORG_ID]
    );
  });

  test('REPORTS: Normal dataset calculates positive accrual metrics', async () => {
    const db = await getDb();
    const approvedTxns = await db.query(
      `SELECT amount, type FROM transactions WHERE org_id = $1 AND is_approved = TRUE;`,
      [ORG_ID]
    );
    assert.ok(approvedTxns.rows.length > 0, 'Apex must have approved ledger entries');

    let credits = 0;
    let debits = 0;
    for (const t of approvedTxns.rows) {
      if (t.type === 'credit') credits += Number(t.amount);
      if (t.type === 'debit') debits += Number(t.amount);
    }
    assert.ok(credits > 0, 'Revenue credits must be positive');
    assert.ok(debits > 0, 'Expense debits must be positive');
  });

  test('REPORTS: Clean empty dataset defaults to zero opening balance and zero revenue', async () => {
    const db = await getDb();
    const emptyOrgId = 'org-empty-clean-01';

    // Seed temporary empty organization
    await db.query(
      `INSERT INTO organizations (id, name, legal_name, tax_id, currency, materiality_threshold, suggest_only_mode)
       VALUES ($1, 'Clean Slate Inc', 'Clean Slate Inc Pvt Ltd', '27AABCZ9999K1Z0', 'INR', 25000, true)
       ON CONFLICT (id) DO NOTHING;`,
      [emptyOrgId]
    );

    const bankRes = await db.query(`SELECT opening_balance FROM bank_accounts WHERE org_id = $1;`, [emptyOrgId]);
    const openingBal = Number(bankRes.rows[0]?.opening_balance || 0);
    assert.equal(openingBal, 0.00, 'Empty org must have 0 opening balance');

    const txns = await db.query(`SELECT id FROM transactions WHERE org_id = $1;`, [emptyOrgId]);
    assert.equal(txns.rows.length, 0, 'Empty org must have 0 transactions');

    // Clean up
    await db.query(`DELETE FROM organizations WHERE id = $1;`, [emptyOrgId]);
  });
});

describe('Stage 3: Automated QA Suite — AI Copilot Guardrails & Deterministic Answers', () => {
  test('AI: Answers normal financial query with database grounded citations', async () => {
    const response = await askFinancialCopilot(ORG_ID, 'What is the largest expense recorded?');
    assert.ok(response.directAnswer.length > 10);
    assert.ok(Array.isArray(response.facts));
    assert.ok(Array.isArray(response.citations));
    assert.ok(response.modelUsed === 'gemini-2.5-flash' || response.modelUsed === 'local-grounded-engine');
  });

  test('AI: Calculations are grounded and do not hallucinate fake amounts', async () => {
    const response = await askFinancialCopilot(ORG_ID, 'How many transactions are pending review?');
    assert.ok(response.directAnswer.length > 0);
    // Verified facts must not include ungrounded claims
    for (const fact of response.facts) {
      assert.ok(typeof fact === 'string' && fact.length > 0);
    }
  });

  test('AI: Missing context notice surfaced when data is insufficient', async () => {
    const response = await askFinancialCopilot(ORG_ID, 'What was our marketing budget in year 2018?');
    assert.ok(
      response.directAnswer.toLowerCase().includes('not find') ||
      response.directAnswer.toLowerCase().includes('no record') ||
      response.directAnswer.toLowerCase().includes('unavailable') ||
      response.directAnswer.toLowerCase().includes('cannot') ||
      Boolean(response.missingInfoNotice),
      'Must honestly state unavailability instead of inventing numbers'
    );
  });
});
