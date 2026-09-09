import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getAuthContext, checkRoleAccess } from '@/lib/auth';
import { logAuditEvent, recordApproval } from '@/lib/auditLogger';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    
    // RBAC: Only CA or Admin can approve, override, or reject accounting entries
    const access = checkRoleAccess(auth, ['ca', 'admin']);
    if (!access.allowed) {
      return NextResponse.json(
        { success: false, error: access.reason },
        { status: 403 }
      );
    }

    const db = await getDb();
    const body = await req.json();
    const { action, transactionId, newCategoryId, notes } = body;
    const orgId = auth.activeOrgId;
    const userId = auth.userId;
    const userName = auth.userName;
    const materialityThreshold = auth.materialityThreshold || 50000.00;

    if (action === 'BATCH_APPROVE') {
      // Find all high-confidence (>=85%) unapproved transactions strictly BELOW materiality threshold
      const txnsRes = await db.query(
        `SELECT t.id, t.description, t.amount, t.category_id, t.categorization_method, t.categorization_confidence, c.name as category_name
         FROM transactions t
         LEFT JOIN chart_of_accounts c ON t.category_id = c.id
         WHERE t.org_id = $1 
           AND t.is_approved = FALSE 
           AND t.categorization_confidence >= 85
           AND t.amount <= $2;`,
        [orgId, materialityThreshold]
      );

      let approvedCount = 0;
      for (const t of txnsRes.rows) {
        await db.query(
          `UPDATE transactions 
           SET is_approved = TRUE, approved_by = $1, approved_at = CURRENT_TIMESTAMP
           WHERE id = $2 AND org_id = $3;`,
          [userId, t.id, orgId]
        );

        // Update reconciliation record status if exists
        await db.query(
          `UPDATE reconciliation_records 
           SET status = 'approved', reviewed_by = $1, reviewed_at = CURRENT_TIMESTAMP
           WHERE transaction_id = $2 AND org_id = $3 AND status = 'suggested';`,
          [userId, t.id, orgId]
        );

        await logAuditEvent({
          orgId,
          userId,
          userName,
          action: 'BATCH_APPROVE',
          entityType: 'transaction',
          entityId: t.id,
          beforeState: { is_approved: false, category: t.category_name, confidence: t.categorization_confidence },
          afterState: { is_approved: true, category: t.category_name },
          explanation: `Batch approved high-confidence suggestion for ₹${Number(t.amount).toLocaleString()} ("${t.description}") into "${t.category_name}". Within materiality threshold (₹${materialityThreshold.toLocaleString()}).`
        });

        approvedCount++;
      }

      return NextResponse.json({ success: true, count: approvedCount });
    }

    if (!transactionId) {
      return NextResponse.json({ success: false, error: 'Transaction ID is required' }, { status: 400 });
    }

    // Fetch existing transaction
    const txnRes = await db.query(
      `SELECT t.*, c.name as category_name, c.code as category_code
       FROM transactions t
       LEFT JOIN chart_of_accounts c ON t.category_id = c.id
       WHERE t.id = $1 AND t.org_id = $2;`,
      [transactionId, orgId]
    );

    if (txnRes.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Transaction not found in current organization' }, { status: 404 });
    }

    const txn = txnRes.rows[0];

    if (action === 'APPROVE') {
      await db.query(
        `UPDATE transactions 
         SET is_approved = TRUE, approved_by = $1, approved_at = CURRENT_TIMESTAMP
         WHERE id = $2 AND org_id = $3;`,
        [userId, transactionId, orgId]
      );

      // Also approve any suggested reconciliation match and mark invoice/bill paid
      const recRes = await db.query(
        `SELECT * FROM reconciliation_records WHERE transaction_id = $1 AND org_id = $2 AND status = 'suggested';`,
        [transactionId, orgId]
      );

      if (recRes.rows.length > 0) {
        const rec = recRes.rows[0];
        await db.query(
          `UPDATE reconciliation_records 
           SET status = 'approved', reviewed_by = $1, reviewed_at = CURRENT_TIMESTAMP
           WHERE id = $2 AND org_id = $3;`,
          [userId, rec.id, orgId]
        );

        if (rec.matched_entity_type === 'invoice') {
          await db.query(`UPDATE invoices SET status = 'paid' WHERE id = $1 AND org_id = $2;`, [rec.matched_entity_id, orgId]);
        } else if (rec.matched_entity_type === 'bill') {
          await db.query(`UPDATE bills SET status = 'paid' WHERE id = $1 AND org_id = $2;`, [rec.matched_entity_id, orgId]);
        }

        await db.query(
          `UPDATE transactions SET reconciliation_status = 'reconciled', status = 'reconciled' WHERE id = $1 AND org_id = $2;`,
          [transactionId, orgId]
        );
      }

      await recordApproval({
        orgId,
        entityType: 'transaction_categorization',
        entityId: transactionId,
        userId,
        userName,
        decision: 'approved',
        decisionNotes: notes || 'Approved suggested categorization'
      });

      await logAuditEvent({
        orgId,
        userId,
        userName,
        action: 'APPROVE_CATEGORIZATION',
        entityType: 'transaction',
        entityId: transactionId,
        beforeState: { is_approved: false, category: txn.category_name, confidence: txn.categorization_confidence },
        afterState: { is_approved: true, category: txn.category_name },
        explanation: `Reviewer approved transaction #${txn.id} (₹${Number(txn.amount).toLocaleString()} - ${txn.description}) to "${txn.category_name}". Posted to active ledger.`
      });

      return NextResponse.json({ success: true, message: 'Transaction approved and posted to ledger.' });
    }

    if (action === 'OVERRIDE') {
      if (!newCategoryId) {
        return NextResponse.json({ success: false, error: 'New Category ID required for override' }, { status: 400 });
      }

      const newCatRes = await db.query(
        `SELECT name, code FROM chart_of_accounts WHERE id = $1 AND org_id = $2;`,
        [newCategoryId, orgId]
      );

      if (newCatRes.rows.length === 0) {
        return NextResponse.json({ success: false, error: 'Invalid category' }, { status: 400 });
      }

      const newCat = newCatRes.rows[0];

      await db.query(
        `UPDATE transactions 
         SET category_id = $1, categorization_method = 'manual', categorization_confidence = 100,
             categorization_reasoning = $2, is_approved = TRUE, approved_by = $3, approved_at = CURRENT_TIMESTAMP
         WHERE id = $4 AND org_id = $5;`,
        [newCategoryId, `Manual override by reviewer: ${notes || 'Updated category'}`, userId, transactionId, orgId]
      );

      await recordApproval({
        orgId,
        entityType: 'transaction_categorization',
        entityId: transactionId,
        userId,
        userName,
        decision: 'overridden',
        decisionNotes: notes || `Overrode category to ${newCat.name}`
      });

      await logAuditEvent({
        orgId,
        userId,
        userName,
        action: 'OVERRIDE_CATEGORY',
        entityType: 'transaction',
        entityId: transactionId,
        beforeState: { category: txn.category_name, method: txn.categorization_method },
        afterState: { category: newCat.name, method: 'manual', notes },
        explanation: `Reviewer overrode categorization for transaction #${txn.id} from "${txn.category_name || 'None'}" to "${newCat.name}". Posted to active ledger.`
      });

      return NextResponse.json({ success: true, message: 'Transaction overridden and posted to ledger.' });
    }

    if (action === 'REJECT') {
      await db.query(
        `UPDATE transactions 
         SET is_approved = FALSE, categorization_method = 'manual',
             categorization_reasoning = $1, reconciliation_status = 'flagged', status = 'flagged'
         WHERE id = $2 AND org_id = $3;`,
        [`Rejected by reviewer: ${notes || 'Requires clarification'}`, transactionId, orgId]
      );

      await recordApproval({
        orgId,
        entityType: 'transaction_categorization',
        entityId: transactionId,
        userId,
        userName,
        decision: 'rejected',
        decisionNotes: notes || 'Rejected proposed categorization'
      });

      await logAuditEvent({
        orgId,
        userId,
        userName,
        action: 'REJECT_CATEGORIZATION',
        entityType: 'transaction',
        entityId: transactionId,
        beforeState: { is_approved: txn.is_approved, category: txn.category_name },
        afterState: { is_approved: false, status: 'flagged', notes },
        explanation: `Reviewer rejected proposed categorization for transaction #${txn.id}. Item flagged for follow-up and excluded from ledger.`
      });

      return NextResponse.json({ success: true, message: 'Transaction rejected and marked as flagged.' });
    }

    return NextResponse.json({ success: false, error: 'Invalid action specified' }, { status: 400 });
  } catch (error: any) {
    console.error('Approvals API Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
