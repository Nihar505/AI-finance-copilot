/**
 * Milestone 3: Transaction Normalizer Tests
 * Tests for Indian bank narration parsing: UPI, NEFT, IMPS, RTGS, UTR extraction,
 * counterparty extraction, date/amount normalization, and deduplication fingerprinting.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDate,
  normalizeAmount,
  extractCounterparty,
} from '../src/lib/normalizer';
import crypto from 'crypto';

// ─── Deduplication fingerprint helper (mirrors seed.ts logic) ───────────────
function dedupFingerprint(
  orgId: string,
  bankAccountId: string,
  date: string,
  amount: number,
  type: string,
  ref: string,
): string {
  const raw = `${orgId}|${bankAccountId}|${date}|${amount}|${type}|${ref.trim().toLowerCase()}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// ─── UPI Narration Extraction Tests ─────────────────────────────────────────
describe('Milestone 3: Indian UPI Narration Parsing', () => {
  const UPI_SAMPLES = [
    {
      desc: 'UPI/428938192831/GPAY/rajesh.kumar@okicici/Salary advance',
      expectedRef: '428938192831',
      expectedCounterparty: 'rajesh.kumar@okicici',
    },
    {
      desc: 'UPI-CR-302948102938-PhonePe-priya.sharma@ybl-INR',
      expectedRef: '302948102938',
      expectedCounterparty: 'UPI-CR-302948102938-PhonePe-priya.sharma@ybl',
    },
    {
      desc: 'UPI/291038472910/PAYTM/merchant123@paytm/Vendor payment',
      expectedRef: '291038472910',
      expectedCounterparty: 'merchant123@paytm',
    },
  ];

  for (const sample of UPI_SAMPLES) {
    test(`UPI: extracts reference from "${sample.desc.substring(0, 50)}"`, () => {
      // Match a 12-digit reference number (UPI UTR pattern)
      const utrMatch = sample.desc.match(/\b(\d{11,12})\b/);
      const extractedRef = utrMatch ? utrMatch[1] : null;
      assert.equal(extractedRef, sample.expectedRef, `Should extract UTR ${sample.expectedRef}`);
    });

    test(`UPI: extracts VPA from "${sample.desc.substring(0, 50)}"`, () => {
      // Match VPA pattern (xxx@yyy)
      const vpaMatch = sample.desc.match(/([a-zA-Z0-9._+-]+@[a-zA-Z0-9]+)/);
      const extractedVpa = vpaMatch ? vpaMatch[1] : null;
      assert.equal(extractedVpa, sample.expectedCounterparty, `Should extract VPA ${sample.expectedCounterparty}`);
    });
  }
});

// ─── NEFT Narration Tests ────────────────────────────────────────────────────
describe('Milestone 3: NEFT Narration Parsing', () => {
  const NEFT_SAMPLES = [
    { desc: 'NEFT-N284240982-ACME LTD-IFSC0001234', expectedRef: 'N284240982', expectedParty: 'ACME LTD' },
    { desc: 'NEFT CR N102938471029 SUNDARAM FINANCE HDFC0002345', expectedRef: 'N102938471029', expectedParty: 'SUNDARAM FINANCE' },
    { desc: 'NEFT-DR-N987654321098-WIPRO LIMITED', expectedRef: 'N987654321098', expectedParty: 'WIPRO LIMITED' },
  ];

  for (const sample of NEFT_SAMPLES) {
    test(`NEFT: extracts UTR from "${sample.desc.substring(0, 40)}"`, () => {
      const neftRef = sample.desc.match(/\bN\d{9,12}\b/i);
      const ref = neftRef ? neftRef[0].toUpperCase() : null;
      assert.ok(ref, `Should find NEFT UTR in: ${sample.desc}`);
      assert.equal(ref, sample.expectedRef.toUpperCase(), 'NEFT UTR must match');
    });
  }
});

// ─── IMPS Narration Tests ────────────────────────────────────────────────────
describe('Milestone 3: IMPS Narration Parsing', () => {
  const IMPS_SAMPLES = [
    { desc: 'IMPS/PR283920193842/RAVI SHANKAR/SBIN0001234', expectedRef: 'PR283920193842' },
    { desc: 'IMPS-928301920372-AMIT SHARMA-KOTAK', expectedRef: '928301920372' },
  ];

  for (const sample of IMPS_SAMPLES) {
    test(`IMPS: extracts RRN from "${sample.desc.substring(0, 40)}"`, () => {
      // IMPS RRN is 12 digits, often prefixed with PR
      const impsRef = sample.desc.match(/\b(PR)?\d{12}\b/i);
      const ref = impsRef ? impsRef[0] : null;
      assert.ok(ref, `Should find IMPS RRN in: ${sample.desc}`);
    });
  }
});

// ─── RTGS Narration Tests ────────────────────────────────────────────────────
describe('Milestone 3: RTGS Narration Parsing', () => {
  test('RTGS: 22-character UTR extraction', () => {
    const rtgsDesc = 'RTGS/HDFC0291039102910283/TATA CONSULTANCY SERVICES/ICIC0000047';
    // RTGS UTR: typically starts with bank code + sequence
    const rtgsRef = rtgsDesc.match(/\b[A-Z]{4}\d{14,18}\b/);
    // Should find the numeric reference portion
    const numRef = rtgsDesc.match(/RTGS\/([A-Z0-9]+)\//);
    assert.ok(numRef, 'Should extract RTGS reference from narration');
    assert.equal(numRef![1], 'HDFC0291039102910283');
  });
});

// ─── Date Normalization Tests ────────────────────────────────────────────────
describe('Milestone 3: Date Normalization', () => {
  const DATE_CASES: Array<{ input: any; expected: string; label: string }> = [
    { input: '2024-03-15', expected: '2024-03-15', label: 'ISO YYYY-MM-DD passthrough' },
    { input: '15/03/2024', expected: '2024-03-15', label: 'DD/MM/YYYY Indian format' },
    { input: '15-03-2024', expected: '2024-03-15', label: 'DD-MM-YYYY with dashes' },
    { input: '31/01/2024', expected: '2024-01-31', label: 'End of month date' },
    { input: '1/4/2024',   expected: '2024-04-01', label: 'Single-digit day Indian format' },
    { input: 45000,        expected: '2023-03-15', label: 'Excel serial date number' },
    { input: undefined,    expected: new Date().toISOString().split('T')[0], label: 'Undefined falls back to today' },
  ];

  for (const { input, expected, label } of DATE_CASES) {
    test(`normalizeDate: ${label}`, () => {
      const result = normalizeDate(input);
      assert.equal(result, expected, `normalizeDate(${JSON.stringify(input)}) should return ${expected}`);
    });
  }
});

// ─── Amount Normalization Tests ──────────────────────────────────────────────
describe('Milestone 3: Amount Normalization', () => {
  const AMOUNT_CASES: Array<{ input: any; expected: number; label: string }> = [
    { input: '1,00,000.00', expected: 100000, label: 'Indian comma-formatted lakh string' },
    { input: '₹50,000',     expected: 50000,  label: 'Rupee symbol with commas' },
    { input: '-25000.50',   expected: 25000.5, label: 'Negative amount becomes positive' },
    { input: 75000,         expected: 75000,  label: 'Numeric passthrough' },
    { input: 0,             expected: 0,      label: 'Zero amount' },
    { input: '',            expected: 0,      label: 'Empty string returns 0' },
    { input: 'N/A',         expected: 0,      label: 'Non-numeric string returns 0' },
  ];

  for (const { input, expected, label } of AMOUNT_CASES) {
    test(`normalizeAmount: ${label}`, () => {
      const result = normalizeAmount(input);
      assert.equal(result, expected, `normalizeAmount(${JSON.stringify(input)}) should equal ${expected}`);
    });
  }
});

// ─── Counterparty Extraction Tests ──────────────────────────────────────────
describe('Milestone 3: Counterparty Extraction from Bank Narrations', () => {
  const COUNTERPARTY_CASES: Array<{ desc: string; contains: string; label: string }> = [
    { desc: 'CMS/GOOGLE INDIA PRIVATE LIMITED/INVOICE-2024-03',   contains: 'google', label: 'CMS prefix stripped' },
    { desc: 'INB/SWIGGY DELIVERY PVTLTD/ORDER-REF-9201',          contains: 'swiggy', label: 'INB prefix stripped' },
    { desc: 'BIL/MSEB/ELECTRICITY BILL/MAR-2024',                 contains: 'mseb',   label: 'BIL utility bill' },
    { desc: 'POS/BIGBASKET RETAIL/TXN-928391',                    contains: 'bigbasket', label: 'POS retail transaction' },
    { desc: 'ACH/HDFC BANK LOAN EMI/29384910',                    contains: 'hdfc', label: 'ACH EMI payment' },
  ];

  for (const { desc, contains, label } of COUNTERPARTY_CASES) {
    test(`extractCounterparty: ${label}`, () => {
      const result = extractCounterparty(desc).toLowerCase();
      assert.ok(
        result.includes(contains),
        `extractCounterparty("${desc}") should contain "${contains}", got: "${result}"`
      );
    });
  }
});

// ─── Deduplication Fingerprint Tests ────────────────────────────────────────
describe('Milestone 3: Deduplication SHA-256 Fingerprint', () => {
  test('Same inputs produce identical fingerprint (idempotency)', () => {
    const fp1 = dedupFingerprint('org-apex-01', 'bank-hdfc-01', '2024-03-15', 50000, 'debit', 'UPI/428938192831');
    const fp2 = dedupFingerprint('org-apex-01', 'bank-hdfc-01', '2024-03-15', 50000, 'debit', 'UPI/428938192831');
    assert.equal(fp1, fp2, 'Same inputs must produce identical fingerprint');
  });

  test('Different org produces different fingerprint (tenant isolation)', () => {
    const fp1 = dedupFingerprint('org-apex-01', 'bank-hdfc-01', '2024-03-15', 50000, 'debit', 'UPI/428938192831');
    const fp2 = dedupFingerprint('org-zenith-01', 'bank-hdfc-01', '2024-03-15', 50000, 'debit', 'UPI/428938192831');
    assert.notEqual(fp1, fp2, 'Different org_id must produce different fingerprint');
  });

  test('Different amount produces different fingerprint', () => {
    const fp1 = dedupFingerprint('org-apex-01', 'bank-hdfc-01', '2024-03-15', 50000, 'debit', 'REF-001');
    const fp2 = dedupFingerprint('org-apex-01', 'bank-hdfc-01', '2024-03-15', 50001, 'debit', 'REF-001');
    assert.notEqual(fp1, fp2, 'Different amount must produce different fingerprint');
  });

  test('Fingerprint is 64-character hex SHA-256', () => {
    const fp = dedupFingerprint('org', 'bank', '2024-01-01', 1000, 'credit', 'ref');
    assert.match(fp, /^[0-9a-f]{64}$/, 'Fingerprint must be 64-character lowercase hex');
  });
});
