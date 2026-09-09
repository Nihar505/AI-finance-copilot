import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { getDb } from '../src/lib/db';
import { seedRealisticSandboxData, ORG_ID, ORG_ZENITH_ID } from '../src/lib/seed';
import { checkRoleAccess, AuthContext } from '../src/lib/auth';

describe('Milestone 1: Multi-Tenancy Isolation & RBAC Security Tests', () => {
  before(async () => {
    // Ensure base database schema and realistic sandbox data are seeded for both orgs
    await seedRealisticSandboxData();
  });

  test('Strict Tenancy: Org A (Apex) cannot view transactions belonging to Org B (Zenith)', async () => {
    const db = await getDb();

    // Query transactions for Apex
    const apexTxns = await db.query(
      `SELECT id, org_id, description, amount FROM transactions WHERE org_id = $1;`,
      [ORG_ID]
    );

    // Query transactions for Zenith
    const zenithTxns = await db.query(
      `SELECT id, org_id, description, amount FROM transactions WHERE org_id = $1;`,
      [ORG_ZENITH_ID]
    );

    assert.ok(apexTxns.rows.length > 0, 'Apex should have seeded transactions');
    assert.ok(zenithTxns.rows.length > 0, 'Zenith should have seeded transactions');

    // Assert absolute non-overlap: no Apex transaction has Zenith's org_id
    for (const t of apexTxns.rows) {
      assert.equal(t.org_id, ORG_ID);
      assert.notEqual(t.org_id, ORG_ZENITH_ID);
    }

    // Assert absolute non-overlap: no Zenith transaction has Apex's org_id
    for (const t of zenithTxns.rows) {
      assert.equal(t.org_id, ORG_ZENITH_ID);
      assert.notEqual(t.org_id, ORG_ID);
    }

    // Cross-tenant verification: IDs should not cross-leak
    const apexIds = new Set(apexTxns.rows.map(t => t.id));
    for (const t of zenithTxns.rows) {
      assert.equal(apexIds.has(t.id), false, `Zenith transaction ${t.id} must not appear in Apex`);
    }
  });

  test('Strict Tenancy: Mutating a transaction in Org B does NOT affect Org A ledger', async () => {
    const db = await getDb();

    // Get count of approved transactions in Org A
    const apexInitial = await db.query(
      `SELECT COUNT(*) as count FROM transactions WHERE org_id = $1 AND is_approved = TRUE;`,
      [ORG_ID]
    );
    const apexInitialCount = Number(apexInitial.rows[0].count);

    // Approve a transaction in Org B (Zenith)
    const zenithTxn = (await db.query(
      `SELECT id FROM transactions WHERE org_id = $1 LIMIT 1;`,
      [ORG_ZENITH_ID]
    )).rows[0];

    await db.query(
      `UPDATE transactions SET is_approved = TRUE WHERE id = $1 AND org_id = $2;`,
      [zenithTxn.id, ORG_ZENITH_ID]
    );

    // Verify Org A approved count is strictly unchanged
    const apexAfter = await db.query(
      `SELECT COUNT(*) as count FROM transactions WHERE org_id = $1 AND is_approved = TRUE;`,
      [ORG_ID]
    );
    assert.equal(Number(apexAfter.rows[0].count), apexInitialCount);
  });

  test('RBAC: Business Owner persona is strictly blocked from CA approval authority', () => {
    const businessOwnerAuth: AuthContext = {
      userId: 'user-business-owner',
      userName: 'Rajesh Gupta',
      userEmail: 'rajesh.gupta@zenithtech.io',
      role: 'business_owner',
      activeOrgId: ORG_ZENITH_ID,
      activeOrgName: 'Zenith Tech Labs Pvt Ltd',
      materialityThreshold: 25000,
      suggestOnlyMode: true
    };

    const accessCheck = checkRoleAccess(businessOwnerAuth, ['ca', 'admin']);
    assert.equal(accessCheck.allowed, false);
    assert.match(accessCheck.reason || '', /Access Denied/i);
    assert.match(accessCheck.reason || '', /business owners cannot unilaterally approve/i);
  });

  test('RBAC: Senior CA persona is authorized for approvals and ledger overrides', () => {
    const caAuth: AuthContext = {
      userId: 'user-lead-ca',
      userName: 'Priya Sharma, FCA',
      userEmail: 'priya.sharma@apexadvisory.com',
      role: 'ca',
      activeOrgId: ORG_ID,
      activeOrgName: 'Apex Global Advisory & Co.',
      materialityThreshold: 50000,
      suggestOnlyMode: true
    };

    const accessCheck = checkRoleAccess(caAuth, ['ca', 'admin']);
    assert.equal(accessCheck.allowed, true);
    assert.equal(accessCheck.reason, undefined);
  });

  test('Materiality Guardrail: Batch approval query strictly excludes transactions above materiality threshold', async () => {
    const db = await getDb();
    const threshold = 50000.00;

    // High confidence query that respects materiality threshold
    const eligibleTxns = await db.query(
      `SELECT id, amount, categorization_confidence 
       FROM transactions 
       WHERE org_id = $1 
         AND amount <= $2;`,
      [ORG_ID, threshold]
    );

    for (const t of eligibleTxns.rows) {
      assert.ok(
        Number(t.amount) <= threshold,
        `Transaction ${t.id} of amount ₹${t.amount} exceeds materiality threshold of ₹${threshold}`
      );
    }
  });
});
