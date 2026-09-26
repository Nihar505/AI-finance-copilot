/**
 * Milestone 6: Reconciliation Engine Tests
 * Tests for deterministic 3-way matching:
 *   - Exact amount match
 *   - TDS net-receipt matching (10%, 2% deduction)
 *   - Date boundary cutoff (±15 days)
 *   - Counterparty name matching with variance
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { calculateDateDiffDays, cleanText, matchTransaction } from '../src/lib/reconciliationEngine';

// ─── Pure Function Tests (no DB) ─────────────────────────────────────────────
describe('Milestone 6: Date Difference Calculation', () => {
  test('Same date returns 0 days', () => {
    const diff = calculateDateDiffDays('2024-03-15', '2024-03-15');
    assert.equal(diff, 0);
  });

  test('7 days apart returns 7', () => {
    const diff = calculateDateDiffDays('2024-03-01', '2024-03-08');
    assert.equal(diff, 7);
  });

  test('Boundary: 15 days apart', () => {
    const diff = calculateDateDiffDays('2024-03-01', '2024-03-16');
    assert.equal(diff, 15);
  });

  test('Cross-month boundary: March 31 to April 5 = 5 days', () => {
    const diff = calculateDateDiffDays('2024-03-31', '2024-04-05');
    assert.equal(diff, 5);
  });

  test('Order-independent (absolute value)', () => {
    const diff1 = calculateDateDiffDays('2024-03-15', '2024-03-01');
    const diff2 = calculateDateDiffDays('2024-03-01', '2024-03-15');
    assert.equal(diff1, diff2);
  });

  test('Cross-year boundary: Dec 31 to Jan 1 = 1 day', () => {
    const diff = calculateDateDiffDays('2023-12-31', '2024-01-01');
    assert.equal(diff, 1);
  });
});

describe('Milestone 6: Clean Text for Fuzzy Name Matching', () => {
  test('Normalizes to lowercase', () => {
    assert.equal(cleanText('TATA CONSULTANCY SERVICES'), 'tata consultancy services');
  });

  test('Strips special characters', () => {
    const cleaned = cleanText('Wipro Ltd. & Co.');
    assert.ok(!cleaned.includes('.'), 'Must strip periods');
    assert.ok(!cleaned.includes('&'), 'Must strip ampersands');
    assert.ok(cleaned.includes('wipro') && cleaned.includes('ltd') && cleaned.includes('co'), 'Must preserve words');
  });

  test('Handles null/empty string', () => {
    assert.equal(cleanText(''), '');
    assert.equal(cleanText(undefined as any), '');
  });
});

// ─── TDS Matching Logic Tests ────────────────────────────────────────────────
describe('Milestone 6: TDS Deduction Matching Logic', () => {
  test('10% TDS: ₹90,000 receipt matches ₹1,00,000 invoice (Section 194J)', () => {
    const invoiceAmount = 100000;
    const receivedAmount = 90000; // After 10% TDS deduction
    const diff = Math.abs(receivedAmount - invoiceAmount);
    const tdsPercent = diff / invoiceAmount;

    // Check if this is a valid TDS deduction match (within 10-11% tolerance)
    const isProbableTdsMatch = receivedAmount < invoiceAmount && tdsPercent <= 0.11;
    assert.equal(isProbableTdsMatch, true, '₹90,000 receipt should match ₹1,00,000 invoice as TDS deduction');
  });

  test('2% TDS: ₹98,000 receipt matches ₹1,00,000 invoice (Section 194C)', () => {
    const invoiceAmount = 100000;
    const receivedAmount = 98000; // After 2% TDS deduction
    const diff = Math.abs(receivedAmount - invoiceAmount);
    const tdsPercent = diff / invoiceAmount;

    const isProbableTdsMatch = receivedAmount < invoiceAmount && tdsPercent <= 0.11;
    assert.equal(isProbableTdsMatch, true, '₹98,000 receipt should match ₹1,00,000 invoice as TDS deduction');
  });

  test('0.1% TDS: ₹99,900 receipt matches ₹1,00,000 invoice (Section 194Q)', () => {
    const invoiceAmount = 100000;
    const receivedAmount = 99900; // After 0.1% TDS deduction
    const diff = Math.abs(receivedAmount - invoiceAmount);
    const tdsPercent = diff / invoiceAmount;

    const isProbableTdsMatch = receivedAmount < invoiceAmount && tdsPercent <= 0.11;
    assert.equal(isProbableTdsMatch, true, '₹99,900 receipt should match ₹1,00,000 invoice as TDS deduction');
  });

  test('Non-TDS shortfall: ₹70,000 against ₹1,00,000 invoice is NOT a TDS match', () => {
    const invoiceAmount = 100000;
    const receivedAmount = 70000;
    const diff = Math.abs(receivedAmount - invoiceAmount);
    const tdsPercent = diff / invoiceAmount;

    const isProbableTdsMatch = receivedAmount < invoiceAmount && tdsPercent <= 0.11;
    assert.equal(isProbableTdsMatch, false, '₹70,000 shortfall is too large to be TDS — not a match');
  });

  test('Exact amount match: ₹1,00,000 against ₹1,00,000 invoice', () => {
    const invoiceAmount = 100000;
    const receivedAmount = 100000;
    const amtDiff = Math.abs(receivedAmount - invoiceAmount);
    const isExactMatch = amtDiff < 0.01;
    assert.equal(isExactMatch, true, 'Exact amount should match within ₹0.01 tolerance');
  });
});

// ─── Reconciliation Classification Logic Tests ───────────────────────────────
describe('Milestone 6: Reconciliation Classification', () => {
  type MatchType = 'exact_match' | 'probable_tds_match' | 'date_out_of_window' | 'no_match';

  function classifyMatch(params: {
    txnAmount: number;
    invAmount: number;
    daysDiff: number;
    counterpartyMatch: boolean;
    dateWindowDays?: number;
  }): MatchType {
    const { txnAmount, invAmount, daysDiff, counterpartyMatch } = params;
    const dateWindow = params.dateWindowDays ?? 15;
    const amtDiff = Math.abs(txnAmount - invAmount);
    const tdsPercent = amtDiff / invAmount;

    if (amtDiff < 0.01 && daysDiff <= dateWindow) {
      return 'exact_match';
    }
    if (txnAmount < invAmount && tdsPercent <= 0.11 && daysDiff <= dateWindow) {
      return 'probable_tds_match';
    }
    if (daysDiff > dateWindow) {
      return 'date_out_of_window';
    }
    return 'no_match';
  }

  test('Exact match: same amount, within 7 days → exact_match', () => {
    assert.equal(classifyMatch({ txnAmount: 100000, invAmount: 100000, daysDiff: 7, counterpartyMatch: true }), 'exact_match');
  });

  test('TDS match: 10% deduction, within 15 days → probable_tds_match', () => {
    assert.equal(classifyMatch({ txnAmount: 90000, invAmount: 100000, daysDiff: 10, counterpartyMatch: true }), 'probable_tds_match');
  });

  test('Date out of window: exact amount but 30+ days apart → date_out_of_window', () => {
    assert.equal(classifyMatch({ txnAmount: 100000, invAmount: 100000, daysDiff: 30, counterpartyMatch: true }), 'date_out_of_window');
  });

  test('No match: amount mismatch and no TDS pattern → no_match', () => {
    assert.equal(classifyMatch({ txnAmount: 70000, invAmount: 100000, daysDiff: 5, counterpartyMatch: false }), 'no_match');
  });

  test('Boundary: exactly 15 days apart is still within window', () => {
    assert.equal(classifyMatch({ txnAmount: 100000, invAmount: 100000, daysDiff: 15, counterpartyMatch: true }), 'exact_match');
  });

  test('Boundary: 16 days apart triggers date_out_of_window', () => {
    assert.equal(classifyMatch({ txnAmount: 100000, invAmount: 100000, daysDiff: 16, counterpartyMatch: true }), 'date_out_of_window');
  });
});

// ─── Phase 3 Quality Fixture Tests & Precision/Recall Benchmark ──────────────
import {
  matchTransactionWithIndexedData,
  CachedInvoice,
  CachedBill,
  RECONCILIATION_WEIGHTS,
  RECONCILIATION_THRESHOLDS
} from '../src/lib/reconciliationEngine';

describe('Phase 3: Reconciliation Quality & Fixture Benchmark', () => {
  const fixtureInvoices: CachedInvoice[] = [
    {
      id: 'inv-01',
      invoice_number: 'INV-2024-001',
      customer_name: 'Acme Corp Ltd',
      date: '2024-10-01',
      total_amount: 100000,
      status: 'unpaid'
    },
    {
      id: 'inv-02',
      invoice_number: 'INV-2024-002',
      customer_name: 'Beta Global Tech',
      date: '2024-10-05',
      total_amount: 250000,
      status: 'unpaid'
    }
  ];

  const fixtureBills: CachedBill[] = [
    {
      id: 'bill-01',
      bill_number: 'BILL-AWS-901',
      vendor_name: 'Amazon Web Services India Pvt Ltd',
      vendor_id: 'ven-aws',
      date: '2024-10-02',
      total_amount: 50000,
      status: 'unpaid',
      tds_section: '194C' // 2% TDS -> Net ₹49,000
    },
    {
      id: 'bill-02',
      bill_number: 'BILL-CONSULT-101',
      vendor_name: 'Pinnacle Legal & Advisory LLP',
      vendor_id: 'ven-pin',
      date: '2024-10-04',
      total_amount: 100000,
      status: 'unpaid',
      tds_section: '194J' // 10% TDS -> Net ₹90,000
    },
    {
      id: 'bill-03A',
      bill_number: 'BILL-OFFICE-01',
      vendor_name: 'Standard Office Supplies Pvt Ltd',
      vendor_id: 'ven-off',
      date: '2024-10-08',
      total_amount: 30000,
      status: 'unpaid',
      tds_section: '194Q'
    },
    {
      id: 'bill-03B',
      bill_number: 'BILL-OFFICE-02',
      vendor_name: 'Standard Office Supplies Pvt Ltd',
      vendor_id: 'ven-off',
      date: '2024-10-10',
      total_amount: 20000,
      status: 'unpaid',
      tds_section: '194Q'
    }
  ];

  test('Named scoring weights and thresholds are exposed as constants', () => {
    assert.equal(RECONCILIATION_WEIGHTS.EXPLICIT_NUMBER_MATCH, 45);
    assert.equal(RECONCILIATION_WEIGHTS.EXACT_AMOUNT_MATCH, 45);
    assert.equal(RECONCILIATION_WEIGHTS.TDS_NET_MATCH, 35);
    assert.equal(RECONCILIATION_THRESHOLDS.MIN_CONFIDENCE_SUGGESTION, 60);
  });

  test('Fixture 1: Exact 1:1 invoice match (Credit transaction)', () => {
    const txn = {
      id: 'txn-exact-1',
      description: 'NEFT INWARD ACME CORP INV-2024-001',
      counterparty: 'Acme Corp Ltd',
      amount: 100000,
      date: '2024-10-03',
      type: 'credit' as const
    };

    const match = matchTransactionWithIndexedData(txn, fixtureInvoices, fixtureBills);
    assert.ok(match, 'Must produce a match candidate');
    assert.equal(match.matchedEntityType, 'invoice');
    assert.equal(match.matchedEntityId, 'inv-01');
    assert.equal(match.matchType, 'exact');
    assert.ok(match.confidence >= 80, `Expected high confidence >= 80, got ${match.confidence}`);
  });

  test('Fixture 2: TDS-Net vendor payment under Section 194J (10% TDS withholding)', () => {
    // Bill ₹100,000 minus 10% TDS = Net ₹90,000
    const txn = {
      id: 'txn-tds-1',
      description: 'RTGS OUT PINNACLE LEGAL ADVISORY FEES',
      counterparty: 'Pinnacle Legal & Advisory LLP',
      amount: 90000,
      date: '2024-10-07',
      type: 'debit' as const
    };

    const match = matchTransactionWithIndexedData(txn, fixtureInvoices, fixtureBills);
    assert.ok(match, 'Must produce a suggested TDS-net match');
    assert.equal(match.matchedEntityType, 'bill');
    assert.equal(match.matchedEntityId, 'bill-02');
    assert.equal(match.matchType, 'tds_net');
    assert.match(match.reasoning, /194J/);
    assert.match(match.reasoning, /10%/);
  });

  test('Fixture 3: TDS-Net vendor payment under Section 194C (2% TDS withholding)', () => {
    // Bill ₹50,000 minus 2% TDS = Net ₹49,000
    const txn = {
      id: 'txn-tds-2',
      description: 'NEFT PAYMENT AMAZON WEB SERVICES INDIA',
      counterparty: 'Amazon Web Services India Pvt Ltd',
      amount: 49000,
      date: '2024-10-05',
      type: 'debit' as const
    };

    const match = matchTransactionWithIndexedData(txn, fixtureInvoices, fixtureBills);
    assert.ok(match, 'Must produce a suggested TDS-net match');
    assert.equal(match.matchedEntityType, 'bill');
    assert.equal(match.matchedEntityId, 'bill-01');
    assert.equal(match.matchType, 'tds_net');
    assert.match(match.reasoning, /194C/);
    assert.match(match.reasoning, /2%/);
  });

  test('Fixture 4: Batched vendor payment (One-to-many: single debit paying 2 bills)', () => {
    // 2 bills: ₹30,000 + ₹20,000 = ₹50,000 total
    const txn = {
      id: 'txn-batch-1',
      description: 'CONSOLIDATED VENDOR PAY STANDARD OFFICE SUPPLIES',
      counterparty: 'Standard Office Supplies Pvt Ltd',
      amount: 50000,
      date: '2024-10-12',
      type: 'debit' as const
    };

    const match = matchTransactionWithIndexedData(txn, fixtureInvoices, fixtureBills);
    assert.ok(match, 'Must produce a suggested batched match');
    assert.equal(match.matchedEntityType, 'bill');
    assert.equal(match.matchType, 'batched');
    assert.ok(match.batchedEntityIds && match.batchedEntityIds.length === 2);
    assert.match(match.reasoning, /Batched payment of 2 bills/);
  });

  test('Fixture 5: Partial payment receipt (Many-to-one suggested match)', () => {
    // Invoice is ₹250,000; customer pays part payment of ₹100,000
    const txn = {
      id: 'txn-partial-1',
      description: 'PART PAYMENT BETA GLOBAL TECH INV-2024-002',
      counterparty: 'Beta Global Tech',
      amount: 100000,
      date: '2024-10-08',
      type: 'credit' as const
    };

    const match = matchTransactionWithIndexedData(txn, fixtureInvoices, fixtureBills);
    assert.ok(match, 'Must produce a suggested partial match');
    assert.equal(match.matchedEntityType, 'invoice');
    assert.equal(match.matchedEntityId, 'inv-02');
    assert.equal(match.matchType, 'partial');
    assert.equal(match.remainingBalance, 150000);
  });

  test('Fixture 6: Deliberate False-Positive Rejection (Mismatched party & date out of window)', () => {
    // Random unrelated transaction with coincidence amount of ₹50,000 but wrong counterparty and 60 days later
    const txn = {
      id: 'txn-false-positive-1',
      description: 'PAYMENT TO UNRELATED TRAVEL AGENCY FLIGHT TICKET',
      counterparty: 'Global Travel Voyages',
      amount: 50000,
      date: '2024-12-25', // > 45 days after bills
      type: 'debit' as const
    };

    const match = matchTransactionWithIndexedData(txn, fixtureInvoices, fixtureBills);
    assert.equal(match, null, 'Unrelated transaction with coincidence amount must NOT match');
  });

  test('Fixture Precision & Recall Benchmark', () => {
    interface TestCase {
      txn: {
        id: string;
        description: string;
        counterparty: string;
        amount: number;
        date: string;
        type: 'credit' | 'debit';
      };
      shouldMatch: boolean;
      expectedTargetId?: string;
    }

    const testSet: TestCase[] = [
      // True Positive Cases (should match)
      {
        txn: { id: 't1', description: 'NEFT ACME INV-2024-001', counterparty: 'Acme Corp Ltd', amount: 100000, date: '2024-10-03', type: 'credit' },
        shouldMatch: true,
        expectedTargetId: 'inv-01'
      },
      {
        txn: { id: 't2', description: 'PINNACLE 10% TDS NET', counterparty: 'Pinnacle Legal & Advisory LLP', amount: 90000, date: '2024-10-07', type: 'debit' },
        shouldMatch: true,
        expectedTargetId: 'bill-02'
      },
      {
        txn: { id: 't3', description: 'AWS 2% TDS NET', counterparty: 'Amazon Web Services India Pvt Ltd', amount: 49000, date: '2024-10-05', type: 'debit' },
        shouldMatch: true,
        expectedTargetId: 'bill-01'
      },
      {
        txn: { id: 't4', description: 'STANDARD OFFICE BATCHED PAY', counterparty: 'Standard Office Supplies Pvt Ltd', amount: 50000, date: '2024-10-12', type: 'debit' },
        shouldMatch: true,
        expectedTargetId: 'bill-03A'
      },
      {
        txn: { id: 't5', description: 'BETA GLOBAL TECH PARTIAL', counterparty: 'Beta Global Tech', amount: 100000, date: '2024-10-08', type: 'credit' },
        shouldMatch: true,
        expectedTargetId: 'inv-02'
      },
      // True Negative Cases (deliberate false positives / noise that must NOT match)
      {
        txn: { id: 'tn1', description: 'RANDOM TRAVEL AGENCY', counterparty: 'Global Travel Voyages', amount: 50000, date: '2024-12-25', type: 'debit' },
        shouldMatch: false
      },
      {
        txn: { id: 'tn2', description: 'COFFEE MACHINE EXPENSE', counterparty: 'Cafe Beans Ltd', amount: 3200, date: '2024-10-05', type: 'debit' },
        shouldMatch: false
      },
      {
        txn: { id: 'tn3', description: 'REFUND FROM UNKNOWN VENDOR', counterparty: 'Unknown Corp', amount: 100000, date: '2024-10-01', type: 'credit' },
        shouldMatch: false
      }
    ];

    let tp = 0; // True Positives
    let fp = 0; // False Positives
    let tn = 0; // True Negatives
    let fn = 0; // False Negatives

    for (const testCase of testSet) {
      const match = matchTransactionWithIndexedData(testCase.txn, fixtureInvoices, fixtureBills);
      if (testCase.shouldMatch) {
        if (match && match.matchedEntityId === testCase.expectedTargetId) {
          tp++;
        } else {
          fn++;
        }
      } else {
        if (match) {
          fp++;
        } else {
          tn++;
        }
      }
    }

    const precision = tp / (tp + fp);
    const recall = tp / (tp + fn);

    assert.equal(precision, 1.0, `Expected Precision = 1.0 (100%), got ${precision}`);
    assert.equal(recall, 1.0, `Expected Recall = 1.0 (100%), got ${recall}`);
    assert.equal(fp, 0, 'Must have zero False Positives');
    assert.equal(fn, 0, 'Must have zero False Negatives');
  });
});

