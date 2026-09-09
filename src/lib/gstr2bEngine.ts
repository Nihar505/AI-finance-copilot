import { getDb } from './db';

/**
 * Milestone: GSTR-2B ITC Reconciliation Engine
 *
 * Matches the supplier-filed GSTR-2B portal entries against the company's
 * own purchase register (bills table). Surfaces:
 *   - matched       : invoice found in both portal and books, amounts within tolerance
 *   - mismatched    : found in both but amounts/GSTIN differ (claim at risk)
 *   - missing_portal: in books but supplier hasn't filed (ITC blocked for this month)
 *   - missing_books : portal shows invoice but it is not in our purchase register
 *
 * CRITICAL: All arithmetic is deterministic SQL/TypeScript — AI is not involved.
 */

export interface GSTR2BEntry {
  id: string;
  period: string;
  supplier_gstin: string;
  supplier_name: string;
  invoice_number: string;
  invoice_date: string;
  invoice_value: number;
  taxable_value: number;
  igst: number;
  cgst: number;
  sgst: number;
  total_tax: number;
  itc_available: boolean;
}

export interface BillEntry {
  id: string;
  bill_number: string;
  vendor_name: string;
  vendor_gstin: string | null;
  date: string;
  total_amount: number;
  tax_amount: number;
}

export type MatchStatus = 'matched' | 'mismatched' | 'missing_portal' | 'missing_books';

export interface ITCReconciliationRow {
  status: MatchStatus;
  portal?: GSTR2BEntry;
  book?: BillEntry;
  // Computed deltas (only for mismatched)
  amount_diff?: number;
  tax_diff?: number;
  // ITC impact
  itc_eligible: number;     // ITC that can be claimed
  itc_blocked: number;      // ITC that cannot be claimed this period
  mismatch_reason?: string;
}

export interface ITCSummary {
  period: string;
  total_portal_entries: number;
  total_book_entries: number;
  matched: number;
  mismatched: number;
  missing_portal: number;
  missing_books: number;
  total_itc_eligible: number;       // Sum of tax on matched entries where itc_available=true
  total_itc_blocked: number;        // Sum of tax on missing_portal + mismatched + itc_available=false
  total_itc_mismatch_risk: number;  // Tax on mismatched entries
  net_itc_position: number;         // eligible - blocked
}

// Amount tolerance: ±5% or ₹1 (whichever is larger) — handles rounding in GST invoices
const AMOUNT_TOLERANCE_PCT = 0.05;
const AMOUNT_TOLERANCE_ABS = 1.0;

function withinTolerance(a: number, b: number): boolean {
  if (a === 0 && b === 0) return true;
  const diff = Math.abs(a - b);
  const pctThreshold = Math.max(a, b) * AMOUNT_TOLERANCE_PCT;
  return diff <= Math.max(pctThreshold, AMOUNT_TOLERANCE_ABS);
}

function normalizeInvoiceNumber(inv: string): string {
  return (inv || '').trim().toUpperCase().replace(/[\s\-_\/]+/g, '');
}

function normalizeGSTIN(gstin: string | null | undefined): string {
  return (gstin || '').trim().toUpperCase();
}

/**
 * Seed GSTR-2B mock data for a given org+period if none exists.
 * Matches against the bills seeded in seed.ts for realistic demo.
 */
export async function seedGSTR2BIfEmpty(orgId: string, period: string): Promise<void> {
  const db = await getDb();
  const existing = await db.query(
    'SELECT COUNT(*) as cnt FROM gstr2b_entries WHERE org_id = $1 AND period = $2;',
    [orgId, period]
  );
  if (Number(existing.rows[0]?.cnt) > 0) return;

  // Mock GSTR-2B for Oct 2024 — mirrors bills in seed.ts with realistic variations:
  //   bill-801 (AWS)     → matched
  //   bill-802 (Google)  → matched
  //   bill-803 (WeWork)  → mismatched (portal shows ₹116,000, books have ₹115,000)
  //   bill-805 (Airtel)  → matched
  //   bill-806 (Razorpay)→ matched
  //   bill-804 (Dell)    → MISSING from portal (Dell hasn't filed GSTR-1, ITC blocked)
  //   bill-807 (Slack)   → MISSING from portal (foreign supplier, no GST)
  //   extra (Mystery Co) → in portal but NOT in books (missing_books)
  const entries = [
    {
      id: `gstr2b-${orgId}-${period}-aws`,
      supplier_gstin: '27AABCA1234D1ZP',
      supplier_name: 'Amazon Web Services India Pvt Ltd',
      invoice_number: 'AWS-OCT24-7723',
      invoice_date: '2024-10-02',
      invoice_value: 42500.00,
      taxable_value: 36016.95,
      igst: 0,
      cgst: 3241.52,
      sgst: 3241.53,
      itc_available: true,
    },
    {
      id: `gstr2b-${orgId}-${period}-google`,
      supplier_gstin: '27AABCG5678M1ZQ',
      supplier_name: 'Google Cloud India Pvt Ltd',
      invoice_number: 'GGL-WS-OCT-2024',
      invoice_date: '2024-10-04',
      invoice_value: 18400.00,
      taxable_value: 15593.22,
      igst: 0,
      cgst: 1403.39,
      sgst: 1403.39,
      itc_available: true,
    },
    {
      id: `gstr2b-${orgId}-${period}-wework`,
      supplier_gstin: '27AACCW9988L1ZT',
      supplier_name: 'WeWork India Management Pvt Ltd',
      invoice_number: 'WW-MUM-OCT2024-001',
      invoice_date: '2024-10-05',
      // Deliberate mismatch: portal shows ₹116,000 but books have ₹115,000
      invoice_value: 116000.00,
      taxable_value: 98305.08,
      igst: 0,
      cgst: 8847.46,
      sgst: 8847.46,
      itc_available: true,
    },
    {
      id: `gstr2b-${orgId}-${period}-airtel`,
      supplier_gstin: '27AAACB0011F1ZX',
      supplier_name: 'Bharti Airtel Limited',
      invoice_number: 'AIRTEL-LL-99201',
      invoice_date: '2024-10-17',
      invoice_value: 12800.00,
      taxable_value: 10847.46,
      igst: 0,
      cgst: 976.27,
      sgst: 976.27,
      itc_available: true,
    },
    {
      id: `gstr2b-${orgId}-${period}-razorpay`,
      supplier_gstin: '27AABCR4433P1ZR',
      supplier_name: 'Razorpay Software Pvt Ltd',
      invoice_number: 'RZP-STMT-OCT24',
      invoice_date: '2024-10-24',
      invoice_value: 6450.00,
      taxable_value: 5466.10,
      igst: 0,
      cgst: 491.95,
      sgst: 491.95,
      itc_available: true,
    },
    // This supplier is in GSTR-2B but not in our books (mystery invoice)
    {
      id: `gstr2b-${orgId}-${period}-mystery`,
      supplier_gstin: '29AABCM8811R1ZZ',
      supplier_name: 'Mystery Vendor Co. Ltd',
      invoice_number: 'MYS-INV-OCT-001',
      invoice_date: '2024-10-15',
      invoice_value: 25000.00,
      taxable_value: 21186.44,
      igst: 0,
      cgst: 1906.78,
      sgst: 1906.78,
      itc_available: true,
    },
  ];

  for (const e of entries) {
    await db.query(
      `INSERT INTO gstr2b_entries
         (id, org_id, period, supplier_gstin, supplier_name, invoice_number,
          invoice_date, invoice_value, taxable_value, igst, cgst, sgst, itc_available, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'portal')
       ON CONFLICT (id) DO NOTHING;`,
      [e.id, orgId, period, e.supplier_gstin, e.supplier_name, e.invoice_number,
       e.invoice_date, e.invoice_value, e.taxable_value, e.igst, e.cgst, e.sgst, e.itc_available]
    );
  }
}

/**
 * Main reconciliation function.
 * Deterministic matching: GSTIN + normalised invoice number, with amount tolerance.
 */
export async function reconcileITC(
  orgId: string,
  period: string
): Promise<{ rows: ITCReconciliationRow[]; summary: ITCSummary }> {
  const db = await getDb();

  // Fetch GSTR-2B portal entries for this period
  const portalRes = await db.query<GSTR2BEntry>(
    `SELECT id, period, supplier_gstin, supplier_name, invoice_number, invoice_date,
            invoice_value, taxable_value, igst, cgst, sgst,
            (igst + cgst + sgst) AS total_tax, itc_available
     FROM gstr2b_entries
     WHERE org_id = $1 AND period = $2
     ORDER BY supplier_name, invoice_number;`,
    [orgId, period]
  );
  const portalEntries: GSTR2BEntry[] = portalRes.rows;

  // Fetch all purchase bills within ±45 days of the period (to catch timing differences)
  const [year, month] = period.split('-').map(Number);
  const periodStart = new Date(year, month - 2, 1).toISOString().slice(0, 10); // one month before
  const periodEnd = new Date(year, month, 15).toISOString().slice(0, 10);      // mid of next month

  const billsRes = await db.query<any>(
    `SELECT b.id, b.bill_number, b.vendor_name, b.total_amount, b.tax_amount, b.date,
            v.tax_id AS vendor_gstin
     FROM bills b
     LEFT JOIN vendors v ON b.vendor_id = v.id AND v.org_id = b.org_id
     WHERE b.org_id = $1
       AND b.date >= $2 AND b.date <= $3
     ORDER BY b.vendor_name, b.bill_number;`,
    [orgId, periodStart, periodEnd]
  );
  const bookEntries: BillEntry[] = billsRes.rows.map((r: any) => ({
    id: r.id,
    bill_number: r.bill_number,
    vendor_name: r.vendor_name,
    vendor_gstin: r.vendor_gstin,
    date: r.date,
    total_amount: Number(r.total_amount),
    tax_amount: Number(r.tax_amount),
  }));

  const rows: ITCReconciliationRow[] = [];
  const matchedBookIds = new Set<string>();
  const matchedPortalIds = new Set<string>();

  // Phase 1: match each portal entry against books
  for (const portal of portalEntries) {
    const pGSTIN = normalizeGSTIN(portal.supplier_gstin);
    const pInv = normalizeInvoiceNumber(portal.invoice_number);
    const pTax = Number(portal.total_tax);
    const pVal = Number(portal.invoice_value);

    // Find matching book entry: GSTIN match + invoice number match
    const bookMatch = bookEntries.find((b) => {
      const bGSTIN = normalizeGSTIN(b.vendor_gstin);
      const bInv = normalizeInvoiceNumber(b.bill_number);
      return bGSTIN === pGSTIN && bInv === pInv;
    });

    if (bookMatch && !matchedBookIds.has(bookMatch.id)) {
      matchedBookIds.add(bookMatch.id);
      matchedPortalIds.add(portal.id);

      const amountOk = withinTolerance(pVal, bookMatch.total_amount);
      const taxOk = withinTolerance(pTax, bookMatch.tax_amount);

      if (amountOk && taxOk) {
        rows.push({
          status: 'matched',
          portal,
          book: bookMatch,
          itc_eligible: portal.itc_available ? pTax : 0,
          itc_blocked: portal.itc_available ? 0 : pTax,
        });
      } else {
        const reasons: string[] = [];
        if (!amountOk) reasons.push(`Invoice value: portal ₹${pVal.toLocaleString('en-IN')} vs books ₹${bookMatch.total_amount.toLocaleString('en-IN')}`);
        if (!taxOk) reasons.push(`Tax: portal ₹${pTax.toLocaleString('en-IN')} vs books ₹${bookMatch.tax_amount.toLocaleString('en-IN')}`);
        rows.push({
          status: 'mismatched',
          portal,
          book: bookMatch,
          amount_diff: pVal - bookMatch.total_amount,
          tax_diff: pTax - bookMatch.tax_amount,
          itc_eligible: 0,
          itc_blocked: pTax,
          mismatch_reason: reasons.join('; '),
        });
      }
    } else if (!matchedPortalIds.has(portal.id)) {
      // In portal but not in books
      matchedPortalIds.add(portal.id);
      rows.push({
        status: 'missing_books',
        portal,
        itc_eligible: 0,
        itc_blocked: 0,
        mismatch_reason: 'Invoice present in GSTN portal but not found in purchase register. Book the bill to claim ITC.',
      });
    }
  }

  // Phase 2: book entries with no portal match → missing from portal (ITC blocked)
  for (const book of bookEntries) {
    if (!matchedBookIds.has(book.id)) {
      rows.push({
        status: 'missing_portal',
        book,
        itc_eligible: 0,
        itc_blocked: book.tax_amount,
        mismatch_reason: 'Invoice not found in GSTN GSTR-2B. Supplier may not have filed GSTR-1 — ITC blocked for this period.',
      });
    }
  }

  // Compute summary
  const matched = rows.filter(r => r.status === 'matched').length;
  const mismatched = rows.filter(r => r.status === 'mismatched').length;
  const missingPortal = rows.filter(r => r.status === 'missing_portal').length;
  const missingBooks = rows.filter(r => r.status === 'missing_books').length;

  const totalITCEligible = rows.reduce((s, r) => s + r.itc_eligible, 0);
  const totalITCBlocked = rows.reduce((s, r) => s + r.itc_blocked, 0);
  const totalMismatchRisk = rows
    .filter(r => r.status === 'mismatched')
    .reduce((s, r) => s + r.itc_blocked, 0);

  const summary: ITCSummary = {
    period,
    total_portal_entries: portalEntries.length,
    total_book_entries: bookEntries.length,
    matched,
    mismatched,
    missing_portal: missingPortal,
    missing_books: missingBooks,
    total_itc_eligible: totalITCEligible,
    total_itc_blocked: totalITCBlocked,
    total_itc_mismatch_risk: totalMismatchRisk,
    net_itc_position: totalITCEligible - totalITCBlocked,
  };

  return { rows, summary };
}
