import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getAuthContext, assertTenantAccess, checkRoleAccess } from '@/lib/auth';
import { validateFinancialAmount, roundCurrency } from '@/lib/currency';
import { safeParseJson, sanitizeString, isValidDate } from '@/lib/security';
import { runCategorizationBatch } from '@/lib/categorizationEngine';
import { logAuditEvent } from '@/lib/auditLogger';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    const orgId = auth.activeOrgId;
    await assertTenantAccess(auth, orgId);

    const db = await getDb();
    const { searchParams } = new URL(req.url);
    const filter = searchParams.get('filter') || 'all';
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = searchParams.has('limit')
      ? Math.min(500, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)))
      : 0; // 0 indicates return all (backward compatibility)

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

    // Get total count before pagination
    const countSql = `SELECT COUNT(*) as total FROM (${sql}) sub;`;
    const countRes = await db.query(countSql, params);
    const totalCount = Number(countRes.rows[0]?.total || 0);

    sql += ` ORDER BY t.date DESC;`;

    if (limit > 0) {
      const offset = (page - 1) * limit;
      sql += ` LIMIT ${limit} OFFSET ${offset};`;
    }

    const res = await db.query(sql, params);

    return NextResponse.json({
      success: true,
      orgId,
      totalCount,
      page,
      limit: limit || totalCount,
      transactions: res.rows
    });
  } catch (error: any) {
    logger.error('Transactions API Error:', { route: '/api/transactions', err: String(error) });
    const status = error.message?.includes('403 Forbidden') ? 403 : 500;
    return NextResponse.json({ success: false, error: error.message }, { status });
  }
}

/**
 * POST /api/transactions — Manual Transaction Creation (BUG-001 & BUG-002 remediation)
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    const orgId = auth.activeOrgId;
    await assertTenantAccess(auth, orgId);

    const bodyParsed = await safeParseJson<any>(req);
    if (!bodyParsed.success || !bodyParsed.data) {
      return NextResponse.json({ success: false, error: bodyParsed.error || 'Invalid JSON body' }, { status: 400 });
    }

    const { date, description, amount, type, counterparty, reference_number, category_id } = bodyParsed.data;

    // Validation
    if (!date || !isValidDate(date)) {
      return NextResponse.json({ success: false, error: 'Valid transaction date (YYYY-MM-DD) is required' }, { status: 400 });
    }

    if (!description || typeof description !== 'string' || description.trim() === '') {
      return NextResponse.json({ success: false, error: 'Description is required' }, { status: 400 });
    }

    const amountCheck = validateFinancialAmount(amount);
    if (!amountCheck.valid) {
      return NextResponse.json({ success: false, error: amountCheck.error }, { status: 400 });
    }

    if (type !== 'credit' && type !== 'debit') {
      return NextResponse.json({ success: false, error: "Transaction type must be 'credit' or 'debit'" }, { status: 400 });
    }

    const db = await getDb();

    // Duplicate Check: Same org, date, amount, and reference_number / description
    const refNum = reference_number ? String(reference_number).trim() : null;
    let duplicateQuery = `SELECT id FROM transactions WHERE org_id = $1 AND date = $2 AND amount = $3`;
    const dupParams: any[] = [orgId, date, amountCheck.amount];

    if (refNum) {
      duplicateQuery += ` AND reference_number = $4;`;
      dupParams.push(refNum);
    } else {
      duplicateQuery += ` AND LOWER(description) = LOWER($4);`;
      dupParams.push(description.trim());
    }

    const dupRes = await db.query(duplicateQuery, dupParams);
    if (dupRes.rows.length > 0) {
      return NextResponse.json(
        { success: false, error: `Duplicate transaction detected. Identical record (${dupRes.rows[0].id}) already exists.` },
        { status: 409 }
      );
    }

    const txnId = `txn-man-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const cleanDesc = sanitizeString(description.trim());
    const cleanCounterparty = counterparty ? sanitizeString(String(counterparty).trim()) : null;

    await db.query(
      `INSERT INTO transactions (
         id, org_id, date, description, raw_description, amount, type, counterparty, 
         reference_number, category_id, categorization_method, reconciliation_status, status, is_approved
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'unreconciled', 'unreconciled', FALSE);`,
      [
        txnId,
        orgId,
        date,
        cleanDesc,
        cleanDesc,
        amountCheck.amount,
        type,
        cleanCounterparty,
        refNum,
        category_id || null,
        category_id ? 'manual' : 'pending'
      ]
    );

    // If no category was assigned manually, trigger automated categorization engine
    if (!category_id) {
      await runCategorizationBatch(orgId);
    }

    await logAuditEvent({
      orgId,
      userId: auth.userId,
      userName: auth.userName,
      action: 'IMPORT_DATA',
      entityType: 'transaction',
      entityId: txnId,
      explanation: `Manually created transaction ${txnId} for ₹${amountCheck.amount.toLocaleString()} (${cleanDesc})`
    });

    return NextResponse.json({
      success: true,
      transactionId: txnId,
      message: 'Transaction successfully created'
    }, { status: 201 });
  } catch (error: any) {
    logger.error('Create Transaction Error:', { route: '/api/transactions', err: String(error) });
    const status = error.message?.includes('403 Forbidden') ? 403 : 500;
    return NextResponse.json({ success: false, error: error.message }, { status });
  }
}

/**
 * DELETE /api/transactions — Delete unapproved transaction
 */
export async function DELETE(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    const orgId = auth.activeOrgId;
    await assertTenantAccess(auth, orgId);

    const bodyParsed = await safeParseJson<{ transactionId?: string }>(req);
    if (!bodyParsed.success || !bodyParsed.data?.transactionId) {
      return NextResponse.json({ success: false, error: 'transactionId is required' }, { status: 400 });
    }

    const { transactionId } = bodyParsed.data;
    const db = await getDb();

    // Check transaction exists and is not approved
    const existing = await db.query(
      `SELECT id, is_approved, description FROM transactions WHERE id = $1 AND org_id = $2;`,
      [transactionId, orgId]
    );

    if (existing.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Transaction not found' }, { status: 404 });
    }

    if (existing.rows[0].is_approved) {
      // Deleting approved transactions violates accounting audit integrity
      const roleCheck = checkRoleAccess(auth, ['ca', 'admin']);
      if (!roleCheck.allowed) {
        return NextResponse.json({ success: false, error: 'Cannot delete approved ledger transaction without CA auditor authorization' }, { status: 403 });
      }
    }

    await db.query(`DELETE FROM transactions WHERE id = $1 AND org_id = $2;`, [transactionId, orgId]);

    await logAuditEvent({
      orgId,
      userId: auth.userId,
      userName: auth.userName,
      action: 'OVERRIDE_CATEGORY',
      entityType: 'transaction',
      entityId: transactionId,
      explanation: `Deleted transaction ${transactionId} ("${existing.rows[0].description}")`
    });

    return NextResponse.json({ success: true, message: `Transaction ${transactionId} deleted successfully` });
  } catch (error: any) {
    logger.error('Delete Transaction Error:', { route: '/api/transactions', err: String(error) });
    const status = error.message?.includes('403 Forbidden') ? 403 : 500;
    return NextResponse.json({ success: false, error: error.message }, { status });
  }
}
