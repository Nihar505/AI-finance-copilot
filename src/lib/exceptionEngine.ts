import { getDb } from './db';

export interface ExceptionFinding {
  id: string;
  orgId: string;
  entityType: 'transaction' | 'invoice' | 'bill';
  entityId: string;
  exceptionType: 'duplicate_invoice' | 'exact_amount_duplicate' | 'missing_required_fields' | 'amount_mismatch' | 'unreconciled_threshold';
  severity: 'critical' | 'high' | 'medium' | 'low';
  explanation: string;
}

export async function runExceptionDetection(orgId: string): Promise<number> {
  const db = await getDb();
  let count = 0;

  // Clear existing open exceptions for fresh deterministic rerun
  await db.query(`DELETE FROM exceptions WHERE org_id = $1 AND status = 'open';`, [orgId]);

  // Check 1: Duplicate Invoices (identical invoice_number within org)
  const dupInvsRes = await db.query(
    `SELECT invoice_number, customer_name, count(*) as cnt, max(total_amount) as amount, array_agg(id) as ids
     FROM invoices
     WHERE org_id = $1
     GROUP BY invoice_number, customer_name
     HAVING count(*) > 1;`,
    [orgId]
  );

  for (const row of dupInvsRes.rows) {
    const ids = row.ids as string[];
    const explanation = `Duplicate Invoice Number: Invoice #${row.invoice_number} appears ${row.cnt} times in customer records for "${row.customer_name}" (amount: ₹${Number(row.amount).toLocaleString()}). Potential duplicate billing or re-upload.`;
    
    for (const invId of ids) {
      const excId = `exc-dupinv-${invId}`;
      await db.query(
        `INSERT INTO exceptions (id, org_id, entity_type, entity_id, exception_type, severity, explanation, status)
         VALUES ($1, $2, 'invoice', $3, 'duplicate_invoice', 'critical', $4, 'open')
         ON CONFLICT (id) DO NOTHING;`,
        [excId, orgId, invId, explanation]
      );
      count++;
    }
  }

  // Check 2: Exact-Amount Duplicate Transactions (same amount + same counterparty within 48 hours)
  const txnsRes = await db.query(
    `SELECT t1.id as id1, t2.id as id2, t1.counterparty, t1.amount, t1.date as date1, t2.date as date2, t1.description
     FROM transactions t1
     JOIN transactions t2 ON t1.org_id = t2.org_id 
       AND t1.id < t2.id
       AND t1.amount = t2.amount 
       AND t1.type = t2.type
       AND lower(t1.counterparty) = lower(t2.counterparty)
       AND abs(t1.date - t2.date) <= 2
     WHERE t1.org_id = $1;`,
    [orgId]
  );

  for (const row of txnsRes.rows) {
    const explanation = `Potential Duplicate Transaction: Found 2 identical ${row.amount > 0 ? 'debit' : 'credit'} transactions to "${row.counterparty}" on ${row.date1} and ${row.date2} for exact amount ₹${Number(row.amount).toLocaleString()}. Review for duplicate card swipe, double debit, or duplicate batch payout.`;
    
    for (const txnId of [row.id1, row.id2]) {
      const excId = `exc-duptxn-${txnId}`;
      await db.query(
        `INSERT INTO exceptions (id, org_id, entity_type, entity_id, exception_type, severity, explanation, status)
         VALUES ($1, $2, 'transaction', $3, 'exact_amount_duplicate', 'high', $4, 'open')
         ON CONFLICT (id) DO NOTHING;`,
        [excId, orgId, txnId, explanation]
      );
      count++;
    }
  }

  // Check 3: Missing Required Fields
  // (a) Transactions missing counterparty
  const missingPartyRes = await db.query(
    `SELECT id, date, amount, description
     FROM transactions
     WHERE org_id = $1 AND (counterparty IS NULL OR trim(counterparty) = '');`,
    [orgId]
  );

  for (const txn of missingPartyRes.rows) {
    const excId = `exc-missfield-${txn.id}`;
    const explanation = `Missing Required Field: Bank transaction on ${txn.date} for ₹${Number(txn.amount).toLocaleString()} ("${txn.description}") is missing a identified counterparty or merchant name. Ledger classification requires beneficiary identification.`;
    
    await db.query(
      `INSERT INTO exceptions (id, org_id, entity_type, entity_id, exception_type, severity, explanation, status)
       VALUES ($1, $2, 'transaction', $3, 'missing_required_fields', 'medium', $4, 'open')
       ON CONFLICT (id) DO NOTHING;`,
      [excId, orgId, txn.id, explanation]
    );
    count++;
  }

  // (b) Vendor Bills missing Tax ID / GSTIN for high value (> ₹50,000)
  const missingTaxRes = await db.query(
    `SELECT b.id, b.bill_number, b.vendor_name, b.total_amount, v.tax_id
     FROM bills b
     LEFT JOIN vendors v ON b.vendor_id = v.id
     WHERE b.org_id = $1 AND b.total_amount > 50000 AND (v.tax_id IS NULL OR trim(v.tax_id) = '');`,
    [orgId]
  );

  for (const bill of missingTaxRes.rows) {
    const excId = `exc-misstax-${bill.id}`;
    const explanation = `Compliance Exception: High-value vendor bill #${bill.bill_number} for ₹${Number(bill.total_amount).toLocaleString()} from "${bill.vendor_name}" has no statutory Tax ID / GSTIN on record. Input tax credit cannot be claimed without valid vendor tax registration.`;
    
    await db.query(
      `INSERT INTO exceptions (id, org_id, entity_type, entity_id, exception_type, severity, explanation, status)
       VALUES ($1, $2, 'bill', $3, 'missing_required_fields', 'high', $4, 'open')
       ON CONFLICT (id) DO NOTHING;`,
      [excId, orgId, bill.id, explanation]
    );
    count++;
  }

  // Check 4: High-Value Unreconciled Transactions (> ₹50,000 without suggested match)
  const unrecHighRes = await db.query(
    `SELECT id, date, amount, counterparty, description, type
     FROM transactions
     WHERE org_id = $1 
       AND amount >= 50000 
       AND reconciliation_status = 'unreconciled'
       AND is_approved = FALSE;`,
    [orgId]
  );

  for (const txn of unrecHighRes.rows) {
    const excId = `exc-unrec-${txn.id}`;
    const direction = txn.type === 'credit' ? 'inflow remittance' : 'outflow disbursement';
    const explanation = `Material Unreconciled Item: High-value ${direction} of ₹${Number(txn.amount).toLocaleString()} on ${txn.date} ("${txn.description}") has no matching ${txn.type === 'credit' ? 'sales invoice' : 'vendor bill'} or recognized schedule. Requires human review and documentation before ledger posting.`;
    
    await db.query(
      `INSERT INTO exceptions (id, org_id, entity_type, entity_id, exception_type, severity, explanation, status)
       VALUES ($1, $2, 'transaction', $3, 'unreconciled_threshold', 'high', $4, 'open')
       ON CONFLICT (id) DO NOTHING;`,
      [excId, orgId, txn.id, explanation]
    );
    count++;
  }

  return count;
}
