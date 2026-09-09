import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getAuthContext } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    const orgId = auth.activeOrgId;
    const db = await getDb();
    const { searchParams } = new URL(req.url);
    const filter = searchParams.get('filter') || 'all';

    let sql = `
      SELECT t.id, t.date, t.description, t.raw_description, t.amount, t.type,
             t.counterparty, t.reference_number, t.category_id,
             t.categorization_method, t.categorization_confidence, t.categorization_reasoning,
             t.reconciliation_status, t.is_approved, t.approved_by, t.approved_at,
             c.name as category_name, c.code as category_code,
             r.matched_entity_type, r.matched_entity_id, r.match_confidence, r.match_reasoning,
             CASE 
               WHEN r.matched_entity_type = 'invoice' THEN inv.invoice_number 
               WHEN r.matched_entity_type = 'bill' THEN b.bill_number 
               ELSE NULL 
             END as matched_document_number
      FROM transactions t
      LEFT JOIN chart_of_accounts c ON t.category_id = c.id
      LEFT JOIN reconciliation_records r ON t.id = r.transaction_id AND r.status != 'rejected'
      LEFT JOIN invoices inv ON r.matched_entity_type = 'invoice' AND r.matched_entity_id = inv.id
      LEFT JOIN bills b ON r.matched_entity_type = 'bill' AND r.matched_entity_id = b.id
      WHERE t.org_id = $1
    `;

    const params: any[] = [orgId];

    if (filter === 'pending_approval') {
      sql += ` AND t.is_approved = FALSE`;
    } else if (filter === 'approved') {
      sql += ` AND t.is_approved = TRUE`;
    } else if (filter === 'unreconciled') {
      sql += ` AND t.reconciliation_status = 'unreconciled'`;
    } else if (filter === 'suggested_match') {
      sql += ` AND t.reconciliation_status = 'suggested_match'`;
    }

    sql += ` ORDER BY t.date DESC;`;

    const res = await db.query(sql, params);

    return NextResponse.json({
      success: true,
      orgId,
      transactions: res.rows
    });
  } catch (error: any) {
    console.error('Transactions API Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
