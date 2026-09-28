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
  matchType?: 'exact' | 'tds_net' | 'partial' | 'batched';
  batchedEntityIds?: string[];
  remainingBalance?: number;
}

export interface CachedInvoice {
  id: string;
  invoice_number: string;
  customer_name: string;
  date: string;
  total_amount: number;
  status: string;
}

export interface CachedBill {
  id: string;
  bill_number: string;
  vendor_name: string;
  vendor_id?: string | null;
  date: string;
  total_amount: number;
  taxable_amount?: number;
  tax_amount?: number;
  status: string;
  tds_section?: string | null;
}

/**
 * Named scoring weights for deterministic and rule-based reconciliation.
 */
export const RECONCILIATION_WEIGHTS = {
  EXPLICIT_NUMBER_MATCH: 45,
  EXACT_AMOUNT_MATCH: 45,
  TDS_NET_MATCH: 35,
  PARTIAL_AMOUNT_MATCH: 25,
  BATCHED_AMOUNT_MATCH: 35,
  COUNTERPARTY_NAME_MATCH: 25,
  DATE_WITHIN_7_DAYS: 15,
  DATE_WITHIN_30_DAYS: 5,
} as const;

/**
 * Named thresholds for reconciliation matching decisions.
 */
export const RECONCILIATION_THRESHOLDS = {
  MIN_CONFIDENCE_SUGGESTION: 65,
  MAX_DATE_DIFF_DAYS: 45,
  ROUNDING_TOLERANCE_PAISE: 100, // ₹1.00 (100 paise)
  MAX_MATCH_CONFIDENCE: 99,
} as const;

import { STATUTORY_TDS_RULES, lookupStatutoryRule, StatutoryTdsRule } from './statutoryRules';

/**
 * Standard TDS section percentage rates for vendor payment withholding.
 * Baseline lookup with sub-section specific rates.
 */
export const STANDARD_TDS_SECTION_RATES: Record<string, number> = {
  '194C': 2.0,       // Contractors / Sub-contractors (corporate/firm 2%)
  '194J': 10.0,      // Professional / Technical services (standard 10%)
  '194J(a)': 2.0,    // Fees for Technical Services / Call center (2%)
  '194J(b)': 10.0,   // Professional fees / Royalty (10%)
  '194H': 2.0,       // Commission / Brokerage (2%)
  '194I': 10.0,      // Rent land / building (10%)
  '194I(a)': 2.0,    // Rent plant / machinery (2%)
  '194Q': 0.1,       // Purchase of goods (0.1%)
};

/**
 * Dynamically resolves the statutory TDS rate for a section or sub-section
 * using lookupStatutoryRule (respecting effective dates and legal regimes).
 */
export function resolveStatutoryTdsRate(
  section: string | null | undefined,
  paymentDate?: string,
  candidateRules?: StatutoryTdsRule[]
): number | null {
  if (!section) return null;
  const date = paymentDate || new Date().toISOString().slice(0, 10);
  const rule = lookupStatutoryRule(section, date, candidateRules);
  if (rule && rule.rate !== null && rule.rate !== undefined) {
    return rule.rate;
  }
  return STANDARD_TDS_SECTION_RATES[section] ?? null;
}

export function calculateDateDiffDays(d1: string, d2: string): number {
  const t1 = new Date(d1).getTime();
  const t2 = new Date(d2).getTime();
  return Math.round(Math.abs(t1 - t2) / (1000 * 60 * 60 * 24));
}

export function cleanText(str: string): string {
  return (str || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
}

/**
 * Pure matching function against indexed/pre-loaded invoices and bills.
 */
export function matchTransactionWithIndexedData(
  txn: {
    id: string;
    description: string;
    counterparty: string;
    amount: number;
    date: string;
    type: 'credit' | 'debit';
  },
  invoices: CachedInvoice[],
  bills: CachedBill[]
): MatchCandidate | null {
  let bestCandidate: MatchCandidate | null = null;
  const cleanDesc = cleanText(txn.description);
  const cleanParty = cleanText(txn.counterparty);

  if (txn.type === 'credit') {
    // Credit transactions match against open Sales Invoices
    for (const inv of invoices) {
      let score = 0;
      const reasons: string[] = [];
      const invAmt = Number(inv.total_amount);
      const daysDiff = calculateDateDiffDays(txn.date, inv.date);
      let matchType: MatchCandidate['matchType'] = 'exact';

      if (daysDiff > RECONCILIATION_THRESHOLDS.MAX_DATE_DIFF_DAYS) {
        continue; // Outside acceptable reconciliation window
      }

      // 1. Check direct reference in narration
      const cleanInvNum = cleanText(inv.invoice_number);
      if (cleanInvNum.length >= 3 && cleanDesc.includes(cleanInvNum)) {
        score += RECONCILIATION_WEIGHTS.EXPLICIT_NUMBER_MATCH;
        reasons.push(`Invoice #${inv.invoice_number} explicitly cited in transaction description.`);
      }

      // 2. Amount matching: exact vs TDS-net vs partial
      const amtDiff = Math.abs(txn.amount - invAmt);
      if (amtDiff <= (RECONCILIATION_THRESHOLDS.ROUNDING_TOLERANCE_PAISE / 100)) {
        score += RECONCILIATION_WEIGHTS.EXACT_AMOUNT_MATCH;
        matchType = 'exact';
        reasons.push(`Exact amount match of ₹${txn.amount.toLocaleString()}.`);
      } else if (txn.amount < invAmt) {
        // Check for 10% or 2% withholding by customer
        const isTenPercent = Math.abs(txn.amount - (invAmt * 0.90)) <= 1.00;
        const isTwoPercent = Math.abs(txn.amount - (invAmt * 0.98)) <= 1.00;
        const isPointOnePercent = Math.abs(txn.amount - (invAmt * 0.999)) <= 1.00;

        if (isTenPercent || isTwoPercent || isPointOnePercent) {
          const rateStr = isTenPercent ? '10%' : isTwoPercent ? '2%' : '0.1%';
          score += RECONCILIATION_WEIGHTS.TDS_NET_MATCH;
          matchType = 'tds_net';
          reasons.push(`Net receipt of ₹${txn.amount.toLocaleString()} matches invoice ₹${invAmt.toLocaleString()} after ${rateStr} withholding tax/TDS deduction.`);
        } else if (amtDiff / invAmt < 0.101) {
          score += RECONCILIATION_WEIGHTS.TDS_NET_MATCH;
          matchType = 'tds_net';
          reasons.push(`Net amount ₹${txn.amount.toLocaleString()} matches invoice ₹${invAmt.toLocaleString()} after withholding tax/TDS deduction.`);
        } else {
          // Partial payment suggestion (requires counterparty or invoice number match)
          score += RECONCILIATION_WEIGHTS.PARTIAL_AMOUNT_MATCH;
          matchType = 'partial';
          reasons.push(`Partial payment receipt of ₹${txn.amount.toLocaleString()} against invoice total ₹${invAmt.toLocaleString()} (remaining ₹${(invAmt - txn.amount).toLocaleString()}).`);
        }
      }

      // 3. Counterparty name matching
      const cleanCust = cleanText(inv.customer_name);
      if (cleanCust && cleanParty && (cleanCust.includes(cleanParty) || cleanParty.includes(cleanCust))) {
        score += RECONCILIATION_WEIGHTS.COUNTERPARTY_NAME_MATCH;
        reasons.push(`Customer name "${inv.customer_name}" matches counterparty.`);
      }

      // 4. Date proximity
      if (daysDiff <= 7) {
        score += RECONCILIATION_WEIGHTS.DATE_WITHIN_7_DAYS;
        reasons.push(`Transaction occurred within ${daysDiff} days of invoice date.`);
      } else if (daysDiff <= 30) {
        score += RECONCILIATION_WEIGHTS.DATE_WITHIN_30_DAYS;
        reasons.push(`Transaction occurred within ${daysDiff} days of invoice date.`);
      }

      const finalConfidence = Math.min(RECONCILIATION_THRESHOLDS.MAX_MATCH_CONFIDENCE, score);

      if (finalConfidence >= RECONCILIATION_THRESHOLDS.MIN_CONFIDENCE_SUGGESTION &&
          (!bestCandidate || finalConfidence > bestCandidate.confidence)) {
        bestCandidate = {
          matchedEntityType: 'invoice',
          matchedEntityId: inv.id,
          matchedEntityNumber: inv.invoice_number,
          counterpartyName: inv.customer_name,
          totalAmount: invAmt,
          date: inv.date,
          confidence: finalConfidence,
          reasoning: reasons.join(' '),
          matchType,
          remainingBalance: matchType === 'partial' ? (invAmt - txn.amount) : undefined,
        };
      }
    }
  } else {
    // Debit transactions match against open Vendor Bills
    // 1. Single bill matching
    for (const bill of bills) {
      let score = 0;
      const reasons: string[] = [];
      const billAmt = Number(bill.total_amount);
      const daysDiff = calculateDateDiffDays(txn.date, bill.date);
      let matchType: MatchCandidate['matchType'] = 'exact';

      if (daysDiff > RECONCILIATION_THRESHOLDS.MAX_DATE_DIFF_DAYS) {
        continue;
      }

      // Check direct reference in narration
      const cleanBillNum = cleanText(bill.bill_number);
      if (cleanBillNum.length >= 3 && cleanDesc.includes(cleanBillNum)) {
        score += RECONCILIATION_WEIGHTS.EXPLICIT_NUMBER_MATCH;
        reasons.push(`Bill #${bill.bill_number} explicitly cited in transaction description.`);
      }

      // Check vendor TDS section if configured
      const vendorSection = bill.tds_section;
      const tdsRate = resolveStatutoryTdsRate(vendorSection, txn.date || bill.date);
      const preGstBase = bill.taxable_amount !== undefined
        ? Number(bill.taxable_amount)
        : (bill.tax_amount !== undefined ? (billAmt - Number(bill.tax_amount)) : billAmt);

      const amtDiff = Math.abs(txn.amount - billAmt);

      if (amtDiff <= (RECONCILIATION_THRESHOLDS.ROUNDING_TOLERANCE_PAISE / 100)) {
        score += RECONCILIATION_WEIGHTS.EXACT_AMOUNT_MATCH;
        matchType = 'exact';
        reasons.push(`Exact amount match of ₹${txn.amount.toLocaleString()}.`);
      } else if (tdsRate !== null && txn.amount < billAmt) {
        const withheldTds = (preGstBase * tdsRate) / 100;
        const expectedNet = billAmt - withheldTds;
        const tdsDiff = Math.abs(txn.amount - expectedNet);
        if (tdsDiff <= (RECONCILIATION_THRESHOLDS.ROUNDING_TOLERANCE_PAISE / 100)) {
          score += RECONCILIATION_WEIGHTS.TDS_NET_MATCH;
          matchType = 'tds_net';
          reasons.push(`Vendor payment net of Section ${vendorSection} TDS (${tdsRate}% on pre-GST base ₹${preGstBase.toLocaleString()}). Gross bill ₹${billAmt.toLocaleString()}, net payment ₹${txn.amount.toLocaleString()}, withheld TDS ₹${withheldTds.toLocaleString()}.`);
        } else {
          // Check for partial payment
          score += RECONCILIATION_WEIGHTS.PARTIAL_AMOUNT_MATCH;
          matchType = 'partial';
          reasons.push(`Partial payment of ₹${txn.amount.toLocaleString()} against bill total ₹${billAmt.toLocaleString()} (remaining ₹${(billAmt - txn.amount).toLocaleString()}).`);
        }
      } else if (txn.amount < billAmt) {
        // Check if generic 10%, 2%, or 0.1% TDS deduction applies
        const isTenPercent = Math.abs(txn.amount - (billAmt * 0.90)) <= 1.00;
        const isTwoPercent = Math.abs(txn.amount - (billAmt * 0.98)) <= 1.00;
        const isPointOnePercent = Math.abs(txn.amount - (billAmt * 0.999)) <= 1.00;

        if (isTenPercent || isTwoPercent || isPointOnePercent) {
          const rateStr = isTenPercent ? '10%' : isTwoPercent ? '2%' : '0.1%';
          score += RECONCILIATION_WEIGHTS.TDS_NET_MATCH;
          matchType = 'tds_net';
          reasons.push(`Vendor payment net of estimated ${rateStr} TDS. Gross bill ₹${billAmt.toLocaleString()}, net payment ₹${txn.amount.toLocaleString()}.`);
        } else {
          // Partial payment suggestion
          score += RECONCILIATION_WEIGHTS.PARTIAL_AMOUNT_MATCH;
          matchType = 'partial';
          reasons.push(`Partial payment of ₹${txn.amount.toLocaleString()} against bill total ₹${billAmt.toLocaleString()} (remaining ₹${(billAmt - txn.amount).toLocaleString()}).`);
        }
      }

      // Check vendor name
      const cleanVen = cleanText(bill.vendor_name);
      if (cleanVen && cleanParty && (cleanVen.includes(cleanParty) || cleanParty.includes(cleanVen))) {
        score += RECONCILIATION_WEIGHTS.COUNTERPARTY_NAME_MATCH;
        reasons.push(`Vendor "${bill.vendor_name}" matches counterparty.`);
      }

      // Date proximity
      if (daysDiff <= 7) {
        score += RECONCILIATION_WEIGHTS.DATE_WITHIN_7_DAYS;
        reasons.push(`Payment settled within ${daysDiff} days of bill issue.`);
      } else if (daysDiff <= 30) {
        score += RECONCILIATION_WEIGHTS.DATE_WITHIN_30_DAYS;
        reasons.push(`Payment settled within ${daysDiff} days of bill issue.`);
      }

      const finalConfidence = Math.min(RECONCILIATION_THRESHOLDS.MAX_MATCH_CONFIDENCE, score);

      if (finalConfidence >= RECONCILIATION_THRESHOLDS.MIN_CONFIDENCE_SUGGESTION &&
          (!bestCandidate || finalConfidence > bestCandidate.confidence)) {
        bestCandidate = {
          matchedEntityType: 'bill',
          matchedEntityId: bill.id,
          matchedEntityNumber: bill.bill_number,
          counterpartyName: bill.vendor_name,
          totalAmount: billAmt,
          date: bill.date,
          confidence: finalConfidence,
          reasoning: reasons.join(' '),
          matchType,
          remainingBalance: matchType === 'partial' ? (billAmt - txn.amount) : undefined,
        };
      }
    }

    // 2. Batched payment matching (One-to-Many): single debit paying multiple bills of the same vendor
    if (!bestCandidate || bestCandidate.confidence < 80) {
      // Group open bills by vendor
      const billsByVendor = new Map<string, CachedBill[]>();
      for (const bill of bills) {
        const key = cleanText(bill.vendor_name);
        if (!key) continue;
        const list = billsByVendor.get(key) || [];
        list.push(bill);
        billsByVendor.set(key, list);
      }

      for (const [venKey, vendorBills] of billsByVendor.entries()) {
        if (vendorBills.length < 2) continue;
        if (cleanParty && (venKey.includes(cleanParty) || cleanParty.includes(venKey))) {
          // Check if sum of any 2 or all bills equals txn amount (or sum net of TDS)
          const totalGross = vendorBills.reduce((acc, b) => acc + Number(b.total_amount), 0);
          const amtDiff = Math.abs(txn.amount - totalGross);

          if (amtDiff <= (RECONCILIATION_THRESHOLDS.ROUNDING_TOLERANCE_PAISE / 100)) {
            const billNums = vendorBills.map(b => b.bill_number).join(', ');
            const score = RECONCILIATION_WEIGHTS.BATCHED_AMOUNT_MATCH +
                          RECONCILIATION_WEIGHTS.COUNTERPARTY_NAME_MATCH +
                          RECONCILIATION_WEIGHTS.DATE_WITHIN_7_DAYS;
            const finalConfidence = Math.min(88, score);

            if (!bestCandidate || finalConfidence > bestCandidate.confidence) {
              bestCandidate = {
                matchedEntityType: 'bill',
                matchedEntityId: vendorBills[0].id,
                matchedEntityNumber: billNums,
                counterpartyName: vendorBills[0].vendor_name,
                totalAmount: totalGross,
                date: vendorBills[0].date,
                confidence: finalConfidence,
                reasoning: `Batched payment of ${vendorBills.length} bills (${billNums}) totaling ₹${totalGross.toLocaleString()} for vendor "${vendorBills[0].vendor_name}". Suggested batch match.`,
                matchType: 'batched',
                batchedEntityIds: vendorBills.map(b => b.id),
              };
            }
          }
        }
      }
    }
  }

  return bestCandidate;
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
  },
  cachedData?: { invoices: CachedInvoice[]; bills: CachedBill[] }
): Promise<MatchCandidate | null> {
  let invoices: CachedInvoice[] = cachedData?.invoices || [];
  let bills: CachedBill[] = cachedData?.bills || [];

  if (!cachedData) {
    const db = await getDb();
    if (txn.type === 'credit') {
      const invoicesRes = await db.query(
        `SELECT id, invoice_number, customer_name, date, total_amount, status
         FROM invoices
         WHERE org_id = $1 AND status != 'paid';`,
        [orgId]
      );
      invoices = invoicesRes.rows;
    } else {
      const billsRes = await db.query(
        `SELECT b.id, b.bill_number, b.vendor_name, b.vendor_id, b.date, b.total_amount, b.tax_amount, b.status, v.tds_section
         FROM bills b
         LEFT JOIN vendors v ON b.vendor_id = v.id
         WHERE b.org_id = $1 AND b.status != 'paid';`,
        [orgId]
      );
      bills = billsRes.rows;
    }
  }

  return matchTransactionWithIndexedData(txn, invoices, bills);
}

// Run batch reconciliation on all unreconciled transactions with single-pass indexed loading
export async function runReconciliationBatch(orgId: string): Promise<number> {
  const db = await getDb();

  // 1. Single indexed query for all open invoices
  const invoicesRes = await db.query<CachedInvoice>(
    `SELECT id, invoice_number, customer_name, date, total_amount, status
     FROM invoices
     WHERE org_id = $1 AND status != 'paid';`,
    [orgId]
  );
  const openInvoices = invoicesRes.rows;

  // 2. Single indexed query for all open bills with vendor TDS sections
  const billsRes = await db.query<CachedBill>(
    `SELECT b.id, b.bill_number, b.vendor_name, b.vendor_id, b.date, b.total_amount, b.tax_amount, b.status, v.tds_section
     FROM bills b
     LEFT JOIN vendors v ON b.vendor_id = v.id
     WHERE b.org_id = $1 AND b.status != 'paid';`,
    [orgId]
  );
  const openBills = billsRes.rows;

  // 3. Fetch all unreconciled transactions for the org
  const txnsRes = await db.query(
    `SELECT id, description, counterparty, amount, date, type
     FROM transactions
     WHERE org_id = $1 AND reconciliation_status = 'unreconciled';`,
    [orgId]
  );

  let matchedCount = 0;
  const cachedData = { invoices: openInvoices, bills: openBills };

  for (const txn of txnsRes.rows) {
    const candidate = matchTransactionWithIndexedData(
      {
        id: txn.id,
        description: txn.description,
        counterparty: txn.counterparty,
        amount: Number(txn.amount),
        date: txn.date,
        type: txn.type
      },
      cachedData.invoices,
      cachedData.bills
    );

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

