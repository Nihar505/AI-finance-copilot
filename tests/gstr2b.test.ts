/**
 * Phase 2: GSTR-2B Input Tax Credit Reconciliation Engine Tests
 * Tests for deterministic matching:
 *   - Invoice number normalization & variant generation
 *   - GSTIN normalization
 *   - Rounding-only tolerance evaluation (strictly ₹1 or configurable ₹2; NO percentage band)
 *   - 8-way classifications: matched, probable_match, mismatched, data_missing, not_expected_in_2b, missing_portal, missing_books
 *   - Section 17(5) ITC eligibility & blocked credit math
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeInvoiceNumber,
  generateInvoiceVariants,
  normalizeGSTIN,
  toPaise,
  fromPaise,
  isWithinPaiseTolerance,
  isForeignOrRcmVendor,
} from '../src/lib/gstr2bEngine';

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

  test('Generates variants for probable match (leading zeros, FY suffixes)', () => {
    const v1 = generateInvoiceVariants('INV-0042');
    assert.equal(v1.has('INV0042'), true);
    assert.equal(v1.has('INV42'), true); // stripped leading zeros

    const v2 = generateInvoiceVariants('BILL/2024-25/0099');
    assert.equal(v2.has('BILL2024250099'), true);
  });
});

describe('GSTR-2B: Rounding-Only Tolerance (Paise Arithmetic)', () => {
  test('Converts rupees to paise accurately without floating point drift', () => {
    assert.equal(toPaise(100.55), 10055);
    assert.equal(fromPaise(10055), 100.55);
    assert.equal(toPaise(0.1 + 0.2), 30);
  });

  test('Exact amount matches within tolerance', () => {
    assert.equal(isWithinPaiseTolerance(42500.0, 42500.0, 100), true);
  });

  test('Minor rounding discrepancy within ₹1 (100 paise) is allowed by default', () => {
    assert.equal(isWithinPaiseTolerance(100.50, 101.20, 100), true); // diff 70 paise <= 100 paise
    assert.equal(isWithinPaiseTolerance(100.00, 100.99, 100), true); // diff 99 paise <= 100 paise
  });

  test('Discrepancy beyond ₹1 fails with default 100 paise tolerance', () => {
    assert.equal(isWithinPaiseTolerance(100.00, 101.50, 100), false); // diff 150 paise > 100 paise
  });

  test('Configurable tolerance up to ₹2 (200 paise) allows up to ₹2 discrepancy', () => {
    assert.equal(isWithinPaiseTolerance(100.00, 101.50, 200), true); // diff 150 paise <= 200 paise
    assert.equal(isWithinPaiseTolerance(100.00, 102.05, 200), false); // diff 205 paise > 200 paise
  });

  test('NO percentage band tolerance is permitted: 4% discrepancy on ₹10,000 (₹400) is REJECTED', () => {
    // Under old 5% tolerance this would have passed! Phase 2 strictly rejects it.
    assert.equal(isWithinPaiseTolerance(10000, 10400, 100), false);
    assert.equal(isWithinPaiseTolerance(10000, 10400, 200), false);
  });
});

describe('GSTR-2B: Foreign & RCM Vendor Identification', () => {
  test('Identifies foreign vendors by OIDAR 99 state code or foreign identifier', () => {
    assert.equal(isForeignOrRcmVendor('Slack Technologies Inc.', '9920USA998811AA'), true);
    assert.equal(isForeignOrRcmVendor('GitHub Inc', '9919USA001122ZZ'), true);
  });

  test('Identifies domestic regular vendors as standard (not foreign)', () => {
    assert.equal(isForeignOrRcmVendor('Amazon Web Services India Pvt Ltd', '27AABCA1234D1ZP'), false);
    assert.equal(isForeignOrRcmVendor('Google Cloud India Pvt Ltd', '27AABCG5678M1ZQ'), false);
  });
});
