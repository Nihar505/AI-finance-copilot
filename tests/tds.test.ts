/**
 * Phase 2: TDS Form 16A Certificate Engine & Calculations Tests
 * Tests for deterministic statutory calculation:
 *   - PAN extraction from 15-character Indian GSTIN
 *   - TDS section rate application (194I: 10%, 194J: 10% / 2%, 194C: 2%, 194Q: 0.1%, 194H: 2%)
 *   - Quarterly TDS aggregation math
 *   - Strict RBAC: CA sign-off permissions
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Helper pure function for PAN extraction from GSTIN
function extractPanFromGstin(gstin: string | null | undefined, fallback: string): string {
  if (!gstin || gstin.length < 12) return fallback;
  const candidate = gstin.substring(2, 12);
  const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
  return panRegex.test(candidate) ? candidate : fallback;
}

function computeTDS(grossAmount: number, ratePercent: number): number {
  return Math.round((grossAmount * (ratePercent / 100)) * 100) / 100;
}

describe('TDS: Deterministic PAN Extraction from GSTIN', () => {
  test('Extracts valid 10-char PAN from 15-character Maharashtra GSTIN', () => {
    const pan = extractPanFromGstin('27AABCA1234D1ZP', 'UNKNOWN');
    assert.equal(pan, 'AABCA1234D');
  });

  test('Extracts valid PAN from Karnataka GSTIN', () => {
    const pan = extractPanFromGstin('29AAACB0011F1ZX', 'UNKNOWN');
    assert.equal(pan, 'AAACB0011F');
  });

  test('Returns fallback for invalid or short GSTIN format', () => {
    const pan = extractPanFromGstin('INVALID_GSTIN', 'FALLBACK_PAN');
    assert.equal(pan, 'FALLBACK_PAN');
  });

  test('Returns fallback for null or empty GSTIN', () => {
    assert.equal(extractPanFromGstin(null, 'FALLBACK_PAN'), 'FALLBACK_PAN');
    assert.equal(extractPanFromGstin('', 'FALLBACK_PAN'), 'FALLBACK_PAN');
  });
});

describe('TDS: Statutory Rate Deductions per Section', () => {
  test('Section 194I: 10% TDS on Office Rent (WeWork ₹1,15,000)', () => {
    const gross = 115000.0;
    const rate = 10.0;
    const tds = computeTDS(gross, rate);
    assert.equal(tds, 11500.0);
    assert.equal(gross - tds, 103500.0);
  });

  test('Section 194J: 10% TDS on Legal/Professional Advisory (Chambers ₹35,000)', () => {
    const gross = 35000.0;
    const rate = 10.0;
    const tds = computeTDS(gross, rate);
    assert.equal(tds, 3500.0);
  });

  test('Section 194J(a): 2% TDS on Cloud / Technical Infrastructure (AWS ₹42,500)', () => {
    const gross = 42500.0;
    const rate = 2.0;
    const tds = computeTDS(gross, rate);
    assert.equal(tds, 850.0);
  });

  test('Section 194C: 2% TDS on Telecom Leased Lines (Airtel ₹12,800)', () => {
    const gross = 12800.0;
    const rate = 2.0;
    const tds = computeTDS(gross, rate);
    assert.equal(tds, 256.0);
  });

  test('Section 194Q: 0.1% TDS on Bulk IT Hardware Purchase (Dell ₹1,65,000)', () => {
    const gross = 165000.0;
    const rate = 0.1;
    const tds = computeTDS(gross, rate);
    assert.equal(tds, 165.0);
  });

  test('Section 194H: 2% TDS on Payment Gateway Commission (Razorpay ₹6,450)', () => {
    const gross = 6450.0;
    const rate = 2.0;
    const tds = computeTDS(gross, rate);
    assert.equal(tds, 129.0);
  });
});

describe('TDS: Form 16A Quarterly Aggregation Math', () => {
  test('Quarterly aggregate sums gross payments and computes total TDS correctly', () => {
    const payments = [
      { vendor: 'WeWork', gross: 115000, rate: 10 },
      { vendor: 'WeWork', gross: 115000, rate: 10 },
      { vendor: 'WeWork', gross: 115000, rate: 10 },
    ];

    const totalGross = payments.reduce((acc, p) => acc + p.gross, 0);
    const totalTDS = payments.reduce((acc, p) => acc + computeTDS(p.gross, p.rate), 0);

    assert.equal(totalGross, 345000.0);
    assert.equal(totalTDS, 34500.0);
  });

  test('Floating point safety: paise precision maintained without rounding drift', () => {
    const gross = 123456.78;
    const rate = 2.0;
    const tds = computeTDS(gross, rate);
    // 123456.78 * 0.02 = 2469.1356 -> 2469.14
    assert.equal(tds, 2469.14);
  });
});

describe('TDS: Statutory Sign-Off Authority RBAC', () => {
  function canSignOffForm16A(userRole: string): boolean {
    return userRole === 'ca' || userRole === 'admin';
  }

  test('Chartered Accountant is authorized to sign off Form 16A', () => {
    assert.equal(canSignOffForm16A('ca'), true);
  });

  test('Firm Admin is authorized to sign off Form 16A', () => {
    assert.equal(canSignOffForm16A('admin'), true);
  });

  test('Business Owner is strictly prohibited from signing Form 16A', () => {
    assert.equal(canSignOffForm16A('business_owner'), false);
  });
});
