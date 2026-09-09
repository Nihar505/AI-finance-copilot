import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getAuthContext } from '@/lib/auth';
import { parseBankStatement, parseSalesInvoices, parseVendorBills } from '@/lib/normalizer';
import { runCategorizationBatch } from '@/lib/categorizationEngine';
import { runReconciliationBatch } from '@/lib/reconciliationEngine';
import { runExceptionDetection } from '@/lib/exceptionEngine';
import { logAuditEvent } from '@/lib/auditLogger';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    const orgId = auth.activeOrgId;
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const fileType = formData.get('fileType') as string;

    if (!file) {
      return NextResponse.json({ success: false, error: 'File is required' }, { status: 400 });
    }

    if (!['bank_statement', 'sales_invoices', 'vendor_bills'].includes(fileType)) {
      return NextResponse.json({ success: false, error: 'Invalid fileType' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const db = await getDb();

    // Check bank account for this org
    const bankRes = await db.query(
      `SELECT id FROM bank_accounts WHERE org_id = $1 LIMIT 1;`,
      [orgId]
    );
    const bankAccountId = bankRes.rows[0]?.id || `bank-${orgId}-01`;

    const docId = `doc-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    if (fileType === 'bank_statement') {
      const txns = parseBankStatement(buffer, file.name);
      if (txns.length === 0) {
        return NextResponse.json({ success: false, error: 'No valid transactions found in statement file' }, { status: 400 });
      }

      await db.query(
        `INSERT INTO documents (id, org_id, filename, file_type, file_size, status, row_count, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, 'processed', $6, $7);`,
        [docId, orgId, file.name, fileType, buffer.length, txns.length, auth.userId]
      );

      for (let i = 0; i < txns.length; i++) {
        const t = txns[i];
        const txnId = `txn-up-${Date.now()}-${i}`;
        await db.query(
          `INSERT INTO transactions (
             id, org_id, bank_account_id, document_id, date, description, raw_description,
             amount, type, counterparty, reference_number, reconciliation_status, status, is_approved
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'unreconciled', 'unreconciled', FALSE);`,
          [txnId, orgId, bankAccountId, docId, t.date, t.description, t.raw_description, t.amount, t.type, t.counterparty, t.reference_number || null]
        );
      }

      // Automatically run pipeline for this specific organization
      await runCategorizationBatch(orgId);
      await runReconciliationBatch(orgId);
      await runExceptionDetection(orgId);

      await logAuditEvent({
        orgId,
        userId: auth.userId,
        userName: auth.userName,
        action: 'IMPORT_DATA',
        entityType: 'document',
        entityId: docId,
        explanation: `Uploaded bank statement "${file.name}" (${txns.length} transactions) for organization ${auth.activeOrgName}. Ingestion pipeline executed.`
      });

      return NextResponse.json({
        success: true,
        message: `Successfully ingested ${txns.length} transactions from "${file.name}".`,
        rowCount: txns.length
      });
    }

    if (fileType === 'sales_invoices') {
      const invoices = parseSalesInvoices(buffer, file.name);
      if (invoices.length === 0) {
        return NextResponse.json({ success: false, error: 'No valid invoices found in file' }, { status: 400 });
      }

      await db.query(
        `INSERT INTO documents (id, org_id, filename, file_type, file_size, status, row_count, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, 'processed', $6, $7);`,
        [docId, orgId, file.name, fileType, buffer.length, invoices.length, auth.userId]
      );

      for (let i = 0; i < invoices.length; i++) {
        const inv = invoices[i];
        const invId = `inv-up-${Date.now()}-${i}`;
        await db.query(
          `INSERT INTO invoices (
             id, org_id, document_id, customer_name, invoice_number, date, due_date, total_amount, tax_amount, status
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'unpaid');`,
          [invId, orgId, docId, inv.customer_name, inv.invoice_number, inv.date, inv.due_date || null, inv.total_amount, inv.tax_amount || 0]
        );
      }

      await runReconciliationBatch(orgId);
      await runExceptionDetection(orgId);

      await logAuditEvent({
        orgId,
        userId: auth.userId,
        userName: auth.userName,
        action: 'IMPORT_DATA',
        entityType: 'document',
        entityId: docId,
        explanation: `Uploaded sales invoices batch "${file.name}" (${invoices.length} invoices).`
      });

      return NextResponse.json({
        success: true,
        message: `Successfully ingested ${invoices.length} sales invoices from "${file.name}".`,
        rowCount: invoices.length
      });
    }

    if (fileType === 'vendor_bills') {
      const bills = parseVendorBills(buffer, file.name);
      if (bills.length === 0) {
        return NextResponse.json({ success: false, error: 'No valid vendor bills found in file' }, { status: 400 });
      }

      await db.query(
        `INSERT INTO documents (id, org_id, filename, file_type, file_size, status, row_count, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, 'processed', $6, $7);`,
        [docId, orgId, file.name, fileType, buffer.length, bills.length, auth.userId]
      );

      for (let i = 0; i < bills.length; i++) {
        const b = bills[i];
        const billId = `bill-up-${Date.now()}-${i}`;
        await db.query(
          `INSERT INTO bills (
             id, org_id, document_id, vendor_name, bill_number, date, due_date, total_amount, tax_amount, status
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'unpaid');`,
          [billId, orgId, docId, b.vendor_name, b.bill_number, b.date, b.due_date || null, b.total_amount, b.tax_amount || 0]
        );
      }

      await runReconciliationBatch(orgId);
      await runExceptionDetection(orgId);

      await logAuditEvent({
        orgId,
        userId: auth.userId,
        userName: auth.userName,
        action: 'IMPORT_DATA',
        entityType: 'document',
        entityId: docId,
        explanation: `Uploaded vendor payables batch "${file.name}" (${bills.length} bills).`
      });

      return NextResponse.json({
        success: true,
        message: `Successfully ingested ${bills.length} vendor bills from "${file.name}".`,
        rowCount: bills.length
      });
    }

    return NextResponse.json({ success: false, error: 'Unknown upload type' }, { status: 400 });
  } catch (error: any) {
    console.error('Upload Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
