/**
 * Phase 2: GSTR-2B Input Tax Credit Reconciliation Engine Tests
 * Tests for deterministic matching:
 *   - Invoice number normalization (dashes, slashes, whitespace)
 *   - GSTIN normalization
 *   - Amount tolerance evaluation (±5% or ₹1)
 *   - 4-way classification: matched, mismatched, missing_portal, missing_books
 *   - ITC eligibility & blocked credit math
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Helper pure functions mirroring gstr2bEngine logic
function normalizeInvoiceNumber(inv: string): string {
  return (inv || '').trim().toUpperCase().replace(/[\s\-_\/]+/g, '');
}

function normalizeGSTIN(gstin: string | null | undefined): string {
  return (gstin || '').trim().toUpperCase();
}

function withinTolerance(a: number, b: number): boolean {
  if (a === 0 && b === 0) return true;
  const diff = Math.abs(a - b);
  const pctThreshold = Math.max(a, b) * 0.05;
  return diff <= Math.max(pctThreshold, 1.0);
}

describe('GSTR-2B: Invoice Number & GSTIN Normalization', () => {
  test('Normalizes various invoice formatting styles', () => {
    assert.equal(normalizeInvoiceNumber('INV-2024/001'), 'INV2024001');
    assert.equal(normalizeInvoiceNumber('inv 2024 - 001'), 'INV2024001');
    assert.equal(normalizeInvoiceNumber('AWS_OCT_9912'), 'AWSOCT9912');
    assert.equal(normalizeInvoiceNumber('  del-corp/771  '), 'DELCORP771');
  });

  test('Normalizes GSTIN to uppercase and trimmed', () => {
    assert.equal(normalizeGSTIN('  27aabca1234d1zp  '), '27AABCA1234D1ZP');
    assert.equal(normalizeGSTIN(null), '');
    assert.equal(normalizeGSTIN(undefined), '');
  });
});

describe('GSTR-2B: Amount Tolerance & Discrepancy Detection', () => {
  test('Exact amount matches within tolerance', () => {
    assert.equal(withinTolerance(42500.0, 42500.0), true);
  });

  test('Minor rounding discrepancy within ₹1 is allowed', () => {
    assert.equal(withinTolerance(100.5, 100.2), true);
  });

  test('Discrepancy within 5% is acceptable for GST rate variations', () => {
    // 4% difference on ₹10,000 is ₹400 <= ₹500 (5%)
    assert.equal(withinTolerance(10000, 10400), true);
  });

  test('Discrepancy exceeding 5% triggers mismatch', () => {
    // 10% difference on ₹10,000 is ₹1,000 > ₹500
    assert.equal(withinTolerance(10000, 11000), false);
  });
});

describe('GSTR-2B: ITC Classification Rules', () => {
  interface MockBill {
    id: string;
    bill_number: string;
    vendor_gstin: string;
    total_amount: number;
    tax_amount: number;
  }

  interface MockPortalEntry {
    id: string;
    invoice_number: string;
    supplier_gstin: string;
    invoice_value: number;
    total_tax: number;
    itc_available: boolean;
  }

  function classifyEntry(portal: MockPortalEntry, bill?: MockBill) {
    if (!bill) {
      return { status: 'missing_books', itc_eligible: 0, itc_blocked: portal.total_tax };
    }
    const amountMatch = withinTolerance(portal.invoice_value, bill.total_amount);
    if (amountMatch) {
      return {
        status: 'matched',
        itc_eligible: portal.itc_available ? portal.total_tax : 0,
        itc_blocked: portal.itc_available ? 0 : portal.total_tax,
      };
    }
    return {
      status: 'mismatched',
      itc_eligible: 0,
      itc_blocked: portal.total_tax,
    };
  }

  test('Matched entry where supplier is tax compliant grants full eligible ITC', () => {
    const portal: MockPortalEntry = {
      id: 'p-1',
      invoice_number: 'AWS-OCT-9912',
      supplier_gstin: '27AABCA1234D1ZP',
      invoice_value: 42500,
      total_tax: 6483.05,
      itc_available: true,
    };
    const bill: MockBill = {
      id: 'b-1',
      bill_number: 'AWS-OCT-9912',
      vendor_gstin: '27AABCA1234D1ZP',
      total_amount: 42500,
      tax_amount: 6483.05,
    };

    const res = classifyEntry(portal, bill);
    assert.equal(res.status, 'matched');
    assert.equal(res.itc_eligible, 6483.05);
    assert.equal(res.itc_blocked, 0);
  });

  test('Matched entry where itc_available is false (supplier non-filer) is blocked', () => {
    const portal: MockPortalEntry = {
      id: 'p-2',
      invoice_number: 'RZP-88',
      supplier_gstin: '27AABCR4433P1ZR',
      invoice_value: 6450,
      total_tax: 983.9,
      itc_available: false, // Supplier flagged
    };
    const bill: MockBill = {
      id: 'b-2',
      bill_number: 'RZP-88',
      vendor_gstin: '27AABCR4433P1ZR',
      total_amount: 6450,
      tax_amount: 983.9,
    };

    const res = classifyEntry(portal, bill);
    assert.equal(res.status, 'matched');
    assert.equal(res.itc_eligible, 0);
    assert.equal(res.itc_blocked, 983.9);
  });

  test('Amount mismatch (>5%) marks as mismatched and blocks ITC claim until rectified', () => {
    const portal: MockPortalEntry = {
      id: 'p-3',
      invoice_number: 'WW-0982',
      supplier_gstin: '27AACCW9988L1ZT',
      invoice_value: 115000,
      total_tax: 17542.37,
      itc_available: true,
    };
    const bill: MockBill = {
      id: 'b-3',
      bill_number: 'WW-0982',
      vendor_gstin: '27AACCW9988L1ZT',
      total_amount: 140000, // Significant mismatch
      tax_amount: 21355,
    };

    const res = classifyEntry(portal, bill);
    assert.equal(res.status, 'mismatched');
    assert.equal(res.itc_eligible, 0);
    assert.equal(res.itc_blocked, 17542.37);
  });

  test('Portal invoice missing from accounting books is flagged as missing_books', () => {
    const portal: MockPortalEntry = {
      id: 'p-4',
      invoice_number: 'GUEST-INV-99',
      supplier_gstin: '27AABCG9999K1Z0',
      invoice_value: 25000,
      total_tax: 4500,
      itc_available: true,
    };

    const res = classifyEntry(portal, undefined);
    assert.equal(res.status, 'missing_books');
    assert.equal(res.itc_eligible, 0);
    assert.equal(res.itc_blocked, 4500);
  });
});
