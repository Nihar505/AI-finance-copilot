import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getAuthContext, assertTenantAccess, checkRoleAccess } from '@/lib/auth';
import { logAuditEvent } from '@/lib/auditLogger';
import { safeParseJson } from '@/lib/security';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    const orgId = auth.activeOrgId;
    await assertTenantAccess(auth, orgId);
    const db = await getDb();

    // 1. Fetch Suggested & Approved matches
    const matchesRes = await db.query(
      `SELECT r.id, r.transaction_id, r.matched_entity_type, r.matched_entity_id, 
              r.match_confidence, r.match_reasoning, r.status,
              t.date as transaction_date, t.description as transaction_desc, t.amount as transaction_amount, t.type as transaction_type, t.counterparty as transaction_counterparty,
              CASE 
                WHEN r.matched_entity_type = 'invoice' THEN inv.invoice_number 
                WHEN r.matched_entity_type = 'bill' THEN b.bill_number 
              END as document_number,
              CASE 
                WHEN r.matched_entity_type = 'invoice' THEN inv.customer_name 
                WHEN r.matched_entity_type = 'bill' THEN b.vendor_name 
              END as document_counterparty,
              CASE 
                WHEN r.matched_entity_type = 'invoice' THEN inv.total_amount 
                WHEN r.matched_entity_type = 'bill' THEN b.total_amount 
              END as document_amount,
              CASE 
                WHEN r.matched_entity_type = 'invoice' THEN inv.date 
                WHEN r.matched_entity_type = 'bill' THEN b.date 
              END as document_date
       FROM reconciliation_records r
       JOIN transactions t ON r.transaction_id = t.id
       LEFT JOIN invoices inv ON r.matched_entity_type = 'invoice' AND r.matched_entity_id = inv.id
       LEFT JOIN bills b ON r.matched_entity_type = 'bill' AND r.matched_entity_id = b.id
       WHERE r.org_id = $1
       ORDER BY r.match_confidence DESC, r.created_at DESC;`,
      [orgId]
    );

    // 2. Unmatched Transactions Queue
    const unmatchedRes = await db.query(
      `SELECT t.id, t.date, t.description, t.amount, t.type, t.counterparty, t.reference_number,
              c.name as category_name
       FROM transactions t
       LEFT JOIN chart_of_accounts c ON t.category_id = c.id
       WHERE t.org_id = $1 AND t.reconciliation_status = 'unreconciled'
       ORDER BY t.date DESC;`,
      [orgId]
    );

    return NextResponse.json({
      success: true,
      orgId,
      matches: matchesRes.rows,
      unmatched: unmatchedRes.rows
    });
  } catch (error: any) {
    logger.error('Reconciliation API GET Error:', { route: '/api/reconciliation', err: String(error) });
    const status = error.message?.includes('403 Forbidden') ? 403 : error.message?.includes('401') ? 401 : 500;
    return NextResponse.json({ success: false, error: error.message }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    const orgId = auth.activeOrgId;
    await assertTenantAccess(auth, orgId);

    // RBAC: Only CA or Admin can approve, reject, or perform ledger reconciliation
    const access = checkRoleAccess(auth, ['ca', 'admin']);
    if (!access.allowed) {
      return NextResponse.json({ success: false, error: access.reason }, { status: 403 });
    }

    const bodyParsed = await safeParseJson<any>(req);
    if (!bodyParsed.success || !bodyParsed.data) {
      return NextResponse.json({ success: false, error: bodyParsed.error || 'Invalid request body' }, { status: 400 });
    }

    const { action, recordId, transactionId, matchedEntityType, matchedEntityId, reason, reasoning } = bodyParsed.data;
    const db = await getDb();

    if (action === 'CONFIRM_MATCH' || action === 'APPROVE_MATCH') {
      if (!recordId) {
        return NextResponse.json({ success: false, error: 'Missing recordId' }, { status: 400 });
      }

      // Verify reconciliation record belongs to org
      const recRes = await db.query(
        `SELECT id, transaction_id, matched_entity_type, matched_entity_id, status
         FROM reconciliation_records
         WHERE id = $1 AND org_id = $2;`,
        [recordId, orgId]
      );

      if (recRes.rows.length === 0) {
        return NextResponse.json({ success: false, error: 'Reconciliation record not found' }, { status: 404 });
      }

      const rec = recRes.rows[0];

      await db.transaction(async (trx) => {
        // 1. Mark reconciliation record approved
        await trx.query(
          `UPDATE reconciliation_records
           SET status = 'approved', reviewed_by = $1, reviewed_at = CURRENT_TIMESTAMP
           WHERE id = $2 AND org_id = $3;`,
          [auth.userId, recordId, orgId]
        );

        // 2. Mark transaction reconciled
        await trx.query(
          `UPDATE transactions
           SET reconciliation_status = 'reconciled'
           WHERE id = $1 AND org_id = $2;`,
          [rec.transaction_id, orgId]
        );

        // 3. Mark matched document paid
        if (rec.matched_entity_type === 'invoice') {
          await trx.query(
            `UPDATE invoices SET status = 'paid' WHERE id = $1 AND org_id = $2;`,
            [rec.matched_entity_id, orgId]
          );
        } else if (rec.matched_entity_type === 'bill') {
          await trx.query(
            `UPDATE bills SET status = 'paid' WHERE id = $1 AND org_id = $2;`,
            [rec.matched_entity_id, orgId]
          );
        }
      });

      await logAuditEvent({
        orgId,
        userId: auth.userId,
        userName: auth.userName,
        action: 'APPROVE_MATCH',
        entityType: 'reconciliation',
        entityId: recordId,
        beforeState: { status: rec.status },
        afterState: { status: 'approved' },
        explanation: `Confirmed and approved reconciliation match between transaction ${rec.transaction_id} and ${rec.matched_entity_type} ${rec.matched_entity_id}.`
      });

      return NextResponse.json({
        success: true,
        message: 'Reconciliation match confirmed successfully',
        recordId,
        status: 'approved'
      });
    }

    if (action === 'REJECT_MATCH') {
      if (!recordId) {
        return NextResponse.json({ success: false, error: 'Missing recordId' }, { status: 400 });
      }

      const recRes = await db.query(
        `SELECT id, transaction_id, matched_entity_type, matched_entity_id, status
         FROM reconciliation_records
         WHERE id = $1 AND org_id = $2;`,
        [recordId, orgId]
      );

      if (recRes.rows.length === 0) {
        return NextResponse.json({ success: false, error: 'Reconciliation record not found' }, { status: 404 });
      }

      const rec = recRes.rows[0];
      const rejectionNote = reason ? ` [Rejected: ${reason}]` : ' [Rejected by CA review]';

      await db.transaction(async (trx) => {
        await trx.query(
          `UPDATE reconciliation_records
           SET status = 'rejected', reviewed_by = $1, reviewed_at = CURRENT_TIMESTAMP,
               match_reasoning = COALESCE(match_reasoning, '') || $2
           WHERE id = $3 AND org_id = $4;`,
          [auth.userId, rejectionNote, recordId, orgId]
        );

        await trx.query(
          `UPDATE transactions
           SET reconciliation_status = 'unreconciled'
           WHERE id = $1 AND org_id = $2;`,
          [rec.transaction_id, orgId]
        );
      });

      await logAuditEvent({
        orgId,
        userId: auth.userId,
        userName: auth.userName,
        action: 'REJECT_MATCH',
        entityType: 'reconciliation',
        entityId: recordId,
        beforeState: { status: rec.status },
        afterState: { status: 'rejected' },
        explanation: `Rejected reconciliation match for transaction ${rec.transaction_id}.${reason ? ` Reason: ${reason}` : ''}`
      });

      return NextResponse.json({
        success: true,
        message: 'Reconciliation match rejected',
        recordId,
        status: 'rejected'
      });
    }

    if (action === 'MANUAL_MATCH') {
      if (!transactionId || !matchedEntityType || !matchedEntityId) {
        return NextResponse.json(
          { success: false, error: 'transactionId, matchedEntityType (invoice|bill), and matchedEntityId are required' },
          { status: 400 }
        );
      }

      if (!['invoice', 'bill'].includes(matchedEntityType)) {
        return NextResponse.json({ success: false, error: 'matchedEntityType must be "invoice" or "bill"' }, { status: 400 });
      }

      // Verify transaction belongs to org
      const txnRes = await db.query(
        `SELECT id, amount, description FROM transactions WHERE id = $1 AND org_id = $2;`,
        [transactionId, orgId]
      );
      if (txnRes.rows.length === 0) {
        return NextResponse.json({ success: false, error: 'Transaction not found in this organization' }, { status: 404 });
      }

      // Verify target entity belongs to org
      const table = matchedEntityType === 'invoice' ? 'invoices' : 'bills';
      const docRes = await db.query(
        `SELECT id, total_amount FROM ${table} WHERE id = $1 AND org_id = $2;`,
        [matchedEntityId, orgId]
      );
      if (docRes.rows.length === 0) {
        return NextResponse.json({ success: false, error: `${matchedEntityType} not found in this organization` }, { status: 404 });
      }

      const newRecordId = `rec-manual-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const note = reasoning || `Manual match created by CA (${auth.userName})`;

      await db.transaction(async (trx) => {
        await trx.query(
          `INSERT INTO reconciliation_records (
             id, org_id, transaction_id, matched_entity_type, matched_entity_id,
             match_confidence, match_reasoning, status, reviewed_by, reviewed_at
           ) VALUES ($1, $2, $3, $4, $5, 100, $6, 'approved', $7, CURRENT_TIMESTAMP);`,
          [newRecordId, orgId, transactionId, matchedEntityType, matchedEntityId, note, auth.userId]
        );

        await trx.query(
          `UPDATE transactions SET reconciliation_status = 'reconciled' WHERE id = $1 AND org_id = $2;`,
          [transactionId, orgId]
        );

        await trx.query(
          `UPDATE ${table} SET status = 'paid' WHERE id = $1 AND org_id = $2;`,
          [matchedEntityId, orgId]
        );
      });

      await logAuditEvent({
        orgId,
        userId: auth.userId,
        userName: auth.userName,
        action: 'APPROVE_MATCH',
        entityType: 'reconciliation',
        entityId: newRecordId,
        explanation: `Created manual CA match between transaction ${transactionId} and ${matchedEntityType} ${matchedEntityId}.`
      });

      return NextResponse.json({
        success: true,
        message: 'Manual match established and approved',
        recordId: newRecordId,
        status: 'approved'
      });
    }

    if (action === 'UNMATCH') {
      if (!recordId) {
        return NextResponse.json({ success: false, error: 'Missing recordId' }, { status: 400 });
      }

      const recRes = await db.query(
        `SELECT id, transaction_id, matched_entity_type, matched_entity_id
         FROM reconciliation_records
         WHERE id = $1 AND org_id = $2;`,
        [recordId, orgId]
      );

      if (recRes.rows.length === 0) {
        return NextResponse.json({ success: false, error: 'Reconciliation record not found' }, { status: 404 });
      }

      const rec = recRes.rows[0];

      await db.transaction(async (trx) => {
        await trx.query(
          `UPDATE reconciliation_records
           SET status = 'unmatched', reviewed_by = $1, reviewed_at = CURRENT_TIMESTAMP
           WHERE id = $2 AND org_id = $3;`,
          [auth.userId, recordId, orgId]
        );

        await trx.query(
          `UPDATE transactions SET reconciliation_status = 'unreconciled' WHERE id = $1 AND org_id = $2;`,
          [rec.transaction_id, orgId]
        );

        const table = rec.matched_entity_type === 'invoice' ? 'invoices' : 'bills';
        await trx.query(
          `UPDATE ${table} SET status = 'unpaid' WHERE id = $1 AND org_id = $2;`,
          [rec.matched_entity_id, orgId]
        );
      });

      await logAuditEvent({
        orgId,
        userId: auth.userId,
        userName: auth.userName,
        action: 'REJECT_MATCH',
        entityType: 'reconciliation',
        entityId: recordId,
        explanation: `Unmatched reconciliation record ${recordId}. Reverted transaction and document statuses.`
      });

      return NextResponse.json({
        success: true,
        message: 'Reconciliation unlatched successfully',
        recordId,
        status: 'unmatched'
      });
    }

    return NextResponse.json(
      { success: false, error: 'Invalid action. Supported actions: CONFIRM_MATCH, REJECT_MATCH, MANUAL_MATCH, UNMATCH' },
      { status: 400 }
    );
  } catch (error: any) {
    logger.error('Reconciliation API POST Error:', { route: '/api/reconciliation', err: String(error) });
    const status = error.message?.includes('403 Forbidden') ? 403 : error.message?.includes('401') ? 401 : 500;
    return NextResponse.json({ success: false, error: error.message }, { status });
  }
}
