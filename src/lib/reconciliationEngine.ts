import { getDb } from './db';

export interface MatchCandidate {
  matchedEntityType: 'invoice' | 'bill';
  matchedEntityId: string;
  matchedEntityNumber: string;
  counterpartyName: string;
  totalAmount: number;
  date: string;
  confidence: number;
  reasoning: string;
}

export function calculateDateDiffDays(d1: string, d2: string): number {
  const t1 = new Date(d1).getTime();
  const t2 = new Date(d2).getTime();
  return Math.round(Math.abs(t1 - t2) / (1000 * 60 * 60 * 24));
}

export function cleanText(str: string): string {
  return (str || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
}

export async function matchTransaction(
  orgId: string,
  txn: {
    id: string;
    description: string;
    counterparty: string;
    amount: number;
    date: string;
    type: 'credit' | 'debit';
  }
): Promise<MatchCandidate | null> {
  const db = await getDb();
  let bestCandidate: MatchCandidate | null = null;

  if (txn.type === 'credit') {
    // Credit transactions match against open Sales Invoices
    const invoicesRes = await db.query(
      `SELECT id, invoice_number, customer_name, date, total_amount, status
       FROM invoices
       WHERE org_id = $1 AND status != 'paid';`,
      [orgId]
    );

    for (const inv of invoicesRes.rows) {
      let score = 0;
      const reasons: string[] = [];
      const invAmt = Number(inv.total_amount);
      const daysDiff = calculateDateDiffDays(txn.date, inv.date);

      // Check direct reference in narration
      const cleanDesc = cleanText(txn.description);
      const cleanInvNum = cleanText(inv.invoice_number);
      if (cleanInvNum.length >= 3 && cleanDesc.includes(cleanInvNum)) {
        score += 45;
        reasons.push(`Invoice #${inv.invoice_number} explicitly cited in transaction description.`);
      }

      // Check amount
      const amtDiff = Math.abs(txn.amount - invAmt);
      if (amtDiff < 0.01) {
        score += 45;
        reasons.push(`Exact amount match of ₹${txn.amount.toLocaleString()}.`);
      } else if (amtDiff / invAmt < 0.101 && txn.amount < invAmt) {
        // Typical 10% or 2% TDS deduction on invoice receipts
        score += 25;
        reasons.push(`Net amount ₹${txn.amount.toLocaleString()} matches invoice ₹${invAmt.toLocaleString()} after withholding tax/TDS deduction.`);
      }

      // Check customer name
      const cleanCust = cleanText(inv.customer_name);
      const cleanParty = cleanText(txn.counterparty);
      if (cleanCust && cleanParty && (cleanCust.includes(cleanParty) || cleanParty.includes(cleanCust))) {
        score += 25;
        reasons.push(`Customer name "${inv.customer_name}" matches counterparty.`);
      }

      // Date proximity
      if (daysDiff <= 7) {
        score += 15;
        reasons.push(`Transaction occurred within ${daysDiff} days of invoice date.`);
      } else if (daysDiff <= 30) {
        score += 5;
        reasons.push(`Transaction occurred within ${daysDiff} days of invoice date.`);
      }

      const finalConfidence = Math.min(99, score);

      if (finalConfidence >= 65 && (!bestCandidate || finalConfidence > bestCandidate.confidence)) {
        bestCandidate = {
          matchedEntityType: 'invoice',
          matchedEntityId: inv.id,
          matchedEntityNumber: inv.invoice_number,
          counterpartyName: inv.customer_name,
          totalAmount: invAmt,
          date: inv.date,
          confidence: finalConfidence,
          reasoning: reasons.join(' ')
        };
      }
    }
  } else {
    // Debit transactions match against open Vendor Bills
    const billsRes = await db.query(
      `SELECT id, bill_number, vendor_name, date, total_amount, status
       FROM bills
       WHERE org_id = $1 AND status != 'paid';`,
      [orgId]
    );

    for (const bill of billsRes.rows) {
      let score = 0;
      const reasons: string[] = [];
      const billAmt = Number(bill.total_amount);
      const daysDiff = calculateDateDiffDays(txn.date, bill.date);

      // Check direct reference in narration
      const cleanDesc = cleanText(txn.description);
      const cleanBillNum = cleanText(bill.bill_number);
      if (cleanBillNum.length >= 3 && cleanDesc.includes(cleanBillNum)) {
        score += 45;
        reasons.push(`Bill #${bill.bill_number} explicitly cited in transaction description.`);
      }

      // Check amount
      const amtDiff = Math.abs(txn.amount - billAmt);
      if (amtDiff < 0.01) {
        score += 45;
        reasons.push(`Exact amount match of ₹${txn.amount.toLocaleString()}.`);
      }

      // Check vendor name
      const cleanVen = cleanText(bill.vendor_name);
      const cleanParty = cleanText(txn.counterparty);
      if (cleanVen && cleanParty && (cleanVen.includes(cleanParty) || cleanParty.includes(cleanVen))) {
        score += 25;
        reasons.push(`Vendor "${bill.vendor_name}" matches counterparty.`);
      }

      // Date proximity
      if (daysDiff <= 7) {
        score += 15;
        reasons.push(`Payment settled within ${daysDiff} days of bill issue.`);
      } else if (daysDiff <= 30) {
        score += 5;
        reasons.push(`Payment settled within ${daysDiff} days of bill issue.`);
      }

      const finalConfidence = Math.min(99, score);

      if (finalConfidence >= 65 && (!bestCandidate || finalConfidence > bestCandidate.confidence)) {
        bestCandidate = {
          matchedEntityType: 'bill',
          matchedEntityId: bill.id,
          matchedEntityNumber: bill.bill_number,
          counterpartyName: bill.vendor_name,
          totalAmount: billAmt,
          date: bill.date,
          confidence: finalConfidence,
          reasoning: reasons.join(' ')
        };
      }
    }
  }

  return bestCandidate;
}

// Run batch reconciliation on all unreconciled transactions
export async function runReconciliationBatch(orgId: string): Promise<number> {
  const db = await getDb();
  const txnsRes = await db.query(
    `SELECT id, description, counterparty, amount, date, type
     FROM transactions
     WHERE org_id = $1 AND reconciliation_status = 'unreconciled';`,
    [orgId]
  );

  let matchedCount = 0;

  for (const txn of txnsRes.rows) {
    const candidate = await matchTransaction(orgId, {
      id: txn.id,
      description: txn.description,
      counterparty: txn.counterparty,
      amount: Number(txn.amount),
      date: txn.date,
      type: txn.type
    });

    if (candidate) {
      const recId = `rec-${txn.id}-${Date.now()}`;
      await db.query(
        `INSERT INTO reconciliation_records (
           id, org_id, transaction_id, matched_entity_type, matched_entity_id, match_confidence, match_reasoning, status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'suggested');`,
        [
          recId,
          orgId,
          txn.id,
          candidate.matchedEntityType,
          candidate.matchedEntityId,
          candidate.confidence,
          candidate.reasoning
        ]
      );

      await db.query(
        `UPDATE transactions
         SET reconciliation_status = 'suggested_match',
             status = 'suggested_match'
         WHERE id = $1 AND org_id = $2;`,
        [txn.id, orgId]
      );

      matchedCount++;
    }
  }

  return matchedCount;
}
