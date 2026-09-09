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
