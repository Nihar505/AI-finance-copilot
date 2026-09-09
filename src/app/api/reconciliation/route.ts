import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getAuthContext, assertTenantAccess } from '@/lib/auth';
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
    logger.error('Reconciliation API Error:', { route: '/api/reconciliation', err: String(error) });
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
