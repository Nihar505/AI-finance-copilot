import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getAuthContext, assertTenantAccess } from '@/lib/auth';
import { parseBankStatement, parseSalesInvoices, parseVendorBills } from '@/lib/normalizer';
import { runCategorizationBatch } from '@/lib/categorizationEngine';
import { runReconciliationBatch } from '@/lib/reconciliationEngine';
import { runExceptionDetection } from '@/lib/exceptionEngine';
import { logAuditEvent } from '@/lib/auditLogger';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB payload ceiling

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    const orgId = auth.activeOrgId;
    await assertTenantAccess(auth, orgId);

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const fileType = formData.get('fileType') as string;

    if (!file) {
      return NextResponse.json({ success: false, error: 'File is required' }, { status: 400 });
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { success: false, error: `File size (${(file.size / 1024 / 1024).toFixed(1)}MB) exceeds maximum limit of 25MB` },
        { status: 400 }
      );
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

      let insertedCount = 0;
      let duplicatesSkipped = 0;

      for (let i = 0; i < txns.length; i++) {
        const t = txns[i];

        // Deduplication guard: Check if transaction with same reference number or date+amount exists
        if (t.reference_number) {
          const dupRes = await db.query(
            `SELECT id FROM transactions WHERE org_id = $1 AND reference_number = $2;`,
            [orgId, t.reference_number]
          );
          if (dupRes.rows.length > 0) {
            duplicatesSkipped++;
            continue;
          }
        }

        const txnId = `txn-up-${Date.now()}-${i}`;
        await db.query(
          `INSERT INTO transactions (
             id, org_id, bank_account_id, document_id, date, description, raw_description,
             amount, type, counterparty, reference_number, reconciliation_status, status, is_approved
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'unreconciled', 'unreconciled', FALSE);`,
          [txnId, orgId, bankAccountId, docId, t.date, t.description, t.raw_description, t.amount, t.type, t.counterparty, t.reference_number || null]
        );
        insertedCount++;
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
        explanation: `Uploaded bank statement "${file.name}" (${insertedCount} ingested, ${duplicatesSkipped} duplicates skipped). Ingestion pipeline executed.`
      });

      return NextResponse.json({
        success: true,
        message: `Successfully ingested ${insertedCount} transactions from "${file.name}" (${duplicatesSkipped} duplicates skipped).`,
        rowCount: insertedCount,
        duplicatesSkipped
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

      let insertedCount = 0;
      let duplicatesSkipped = 0;

      for (let i = 0; i < invoices.length; i++) {
        const inv = invoices[i];

        if (inv.invoice_number) {
          const dupRes = await db.query(
            `SELECT id FROM invoices WHERE org_id = $1 AND invoice_number = $2;`,
            [orgId, inv.invoice_number]
          );
          if (dupRes.rows.length > 0) {
            duplicatesSkipped++;
            continue;
          }
        }

        const invId = `inv-up-${Date.now()}-${i}`;
        await db.query(
          `INSERT INTO invoices (
             id, org_id, document_id, customer_name, invoice_number, date, due_date, total_amount, tax_amount, status
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'unpaid');`,
          [invId, orgId, docId, inv.customer_name, inv.invoice_number, inv.date, inv.due_date || null, inv.total_amount, inv.tax_amount || 0]
        );
        insertedCount++;
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
        explanation: `Uploaded sales invoices batch "${file.name}" (${insertedCount} ingested, ${duplicatesSkipped} duplicates skipped).`
      });

      return NextResponse.json({
        success: true,
        message: `Successfully ingested ${insertedCount} sales invoices from "${file.name}" (${duplicatesSkipped} duplicates skipped).`,
        rowCount: insertedCount,
        duplicatesSkipped
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

      let insertedCount = 0;
      let duplicatesSkipped = 0;

      for (let i = 0; i < bills.length; i++) {
        const b = bills[i];

        if (b.bill_number) {
          const dupRes = await db.query(
            `SELECT id FROM bills WHERE org_id = $1 AND bill_number = $2;`,
            [orgId, b.bill_number]
          );
          if (dupRes.rows.length > 0) {
            duplicatesSkipped++;
            continue;
          }
        }

        const billId = `bill-up-${Date.now()}-${i}`;
        await db.query(
          `INSERT INTO bills (
             id, org_id, document_id, vendor_name, bill_number, date, due_date, total_amount, tax_amount, status
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'unpaid');`,
          [billId, orgId, docId, b.vendor_name, b.bill_number, b.date, b.due_date || null, b.total_amount, b.tax_amount || 0]
        );
        insertedCount++;
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
        explanation: `Uploaded vendor payables batch "${file.name}" (${insertedCount} ingested, ${duplicatesSkipped} duplicates skipped).`
      });

      return NextResponse.json({
        success: true,
        message: `Successfully ingested ${insertedCount} vendor bills from "${file.name}" (${duplicatesSkipped} duplicates skipped).`,
        rowCount: insertedCount,
        duplicatesSkipped
      });
    }

    return NextResponse.json({ success: false, error: 'Unknown upload type' }, { status: 400 });
  } catch (error: any) {
    logger.error('Upload Error:', { route: '/api/upload', err: String(error) });
    const status = error.message?.includes('403 Forbidden') ? 403 : 500;
    return NextResponse.json({ success: false, error: error.message }, { status });
  }
}
