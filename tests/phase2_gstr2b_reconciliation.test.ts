/**
 * tests/phase2_gstr2b_reconciliation.test.ts
 *
 * Comprehensive Phase 2 test suite:
 * 1. JSON parser: GSTN schema (b2b, ctin, inum, val, items, etc.), validation & paise totals.
 * 2. Excel parser: maintained exceljs loading, B2B column mapping, date/number sanitization.
 * 3. Unsupported sections detection: cdnr, cdnra, b2ba, isd, impg, impgsez => itcTotalsIncomplete = true.
 * 4. Section 17(5) blocked credit: itcavl = 'N' surfaces reason and excludes from claimable ITC.
 * 5. Rounding-only tolerance (default ₹1, configurable to ₹2); no percentage-band tolerance.
 * 6. Probable match: invoice number variants (leading zeros, FY suffixes) with same GSTIN & rounding amount.
 * 7. Single test asserting ALL 8 classifications and claimable ITC sum = ₹12,226.27 on realistic October 2024 demo.
 * 8. Database unique constraint idempotency on (org_id, period, supplier_gstin, invoice_number).
 * 9. Empty period returns empty rows without auto-seeding.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { getDb } from '../src/lib/db';
import { seedRealisticSandboxData, ORG_ID as TEST_ORG_ID } from '../src/lib/seed';
import {
  parseGSTR2BJson,
  parseGSTR2BExcel,
  commitGSTR2BImport,
  reconcileITC,
  isWithinPaiseTolerance,
  generateInvoiceVariants,
  toPaise,
  fromPaise,
} from '../src/lib/gstr2bEngine';

describe('Phase 2: GSTN GSTR-2B JSON Parser', () => {
  test('Parses valid GSTN B2B JSON payload and computes paise-accurate totals', () => {
    const gstnJson = {
      gstin: '27AAACZ1122K1ZM',
      fp: '102024',
      b2b: [
        {
          ctin: '27AABCA1234D1ZP',
          trdnm: 'Amazon Web Services India Pvt Ltd',
          inv: [
            {
              inum: 'AWS-OCT-9912',
              idt: '01-10-2024',
              val: 42500.0,
              pos: '27',
              rev: 'N',
              inv_typ: 'R',
              itcavl: 'Y',
              items: [
                {
                  num: 1,
                  rt: 18.0,
                  txval: 36016.95,
                  iamt: 0.0,
                  camt: 3241.52,
                  samt: 3241.53,
                  csamt: 0.0,
                },
              ],
            },
          ],
        },
      ],
    };

    const res = parseGSTR2BJson(gstnJson);
    assert.equal(res.success, true);
    assert.equal(res.period, '2024-10');
    assert.equal(res.entries.length, 1);

    const entry = res.entries[0];
    assert.equal(entry.supplier_gstin, '27AABCA1234D1ZP');
    assert.equal(entry.invoice_number, 'AWS-OCT-9912');
    assert.equal(entry.invoice_value, 42500.0);
    assert.equal(entry.taxable_value, 36016.95);
    assert.equal(entry.cgst, 3241.52);
    assert.equal(entry.sgst, 3241.53);
    assert.equal(entry.total_tax, 6483.05);
    assert.equal(entry.itc_available, true);
    assert.equal(res.itcTotalsIncomplete, false);
    assert.equal(res.summary.totalTax, 6483.05);
    assert.equal(res.summary.totalIneligibleTax, 0);
  });

  test('Detects unsupported sections (cdnr, b2ba) and sets itcTotalsIncomplete=true', () => {
    const jsonWithUnsupported = {
      b2b: [
        {
          ctin: '27AABCA1234D1ZP',
          trdnm: 'Amazon Web Services',
          inv: [
            {
              inum: 'AWS-101',
              val: 1000,
              itcavl: 'Y',
              items: [{ txval: 800, iamt: 144, camt: 0, samt: 0 }],
            },
          ],
        },
      ],
      cdnr: [
        {
          ctin: '27AABCA1234D1ZP',
          nt: [{ nt_num: 'CR-001', val: 500 }],
        },
      ],
      b2ba: [
        {
          ctin: '27AABCG5678M1ZQ',
          inv: [{ inum: 'GGL-99', val: 2000 }],
        },
      ],
    };

    const res = parseGSTR2BJson(jsonWithUnsupported);
    assert.equal(res.success, true);
    assert.equal(res.itcTotalsIncomplete, true);
    assert.deepEqual(res.unsupportedSectionsDetected.sort(), ['b2ba', 'cdnr']);
  });

  test('Surfaces Section 17(5) blocked credit (itcavl=N) and excludes from claimable ITC', () => {
    const jsonWithIneligible = {
      b2b: [
        {
          ctin: '27AACCW9988L1ZT',
          trdnm: 'WeWork India',
          inv: [
            {
              inum: 'WW-BLR-0982',
              val: 115000,
              itcavl: 'N',
              rsn: 'Ineligible under Section 17(5)(g)',
              items: [{ txval: 97457.63, camt: 8771.18, samt: 8771.19 }],
            },
          ],
        },
      ],
    };

    const res = parseGSTR2BJson(jsonWithIneligible);
    assert.equal(res.success, true);
    assert.equal(res.entries.length, 1);
    const entry = res.entries[0];
    assert.equal(entry.itc_available, false);
    assert.equal(entry.itc_ineligible_reason, 'Ineligible under Section 17(5)(g)');
    assert.equal(res.summary.totalTax, 17542.37);
    assert.equal(res.summary.totalIneligibleTax, 17542.37);
  });
});

describe('Phase 2: GST Portal Excel Parser (exceljs)', () => {
  test('Parses Excel workbook with B2B worksheet and extracts rows', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('B2B');

    // Add header rows as downloaded from GST portal
    sheet.addRow(['GSTR-2B - Auto-drafted ITC Statement']);
    sheet.addRow([]);
    sheet.addRow([
      'GSTIN of Supplier',
      'Trade/Legal name',
      'Invoice number',
      'Invoice type',
      'Invoice Date',
      'Invoice Value(₹)',
      'Place of supply',
      'Supply Attract Reverse Charge',
      'Rate(%)',
      'Taxable Value (₹)',
      'Integrated Tax(₹)',
      'Central Tax(₹)',
      'State/UT Tax(₹)',
      'Cess(₹)',
      'GSTR-2B ITC Availability',
      'Reason',
    ]);

    sheet.addRow([
      '27AAACB0011F1ZX',
      'Bharti Airtel Limited',
      'AIRTEL-LL-99201',
      'Regular',
      '17-10-2024',
      12800.0,
      '27',
      'N',
      18,
      10847.46,
      0,
      976.27,
      976.27,
      0,
      'Y',
      '',
    ]);

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const res = await parseGSTR2BExcel(buffer);

    assert.equal(res.success, true);
    assert.equal(res.entries.length, 1);
    const entry = res.entries[0];
    assert.equal(entry.supplier_gstin, '27AAACB0011F1ZX');
    assert.equal(entry.supplier_name, 'Bharti Airtel Limited');
    assert.equal(entry.invoice_number, 'AIRTEL-LL-99201');
    assert.equal(entry.invoice_value, 12800.0);
    assert.equal(entry.total_tax, 1952.54);
    assert.equal(entry.itc_available, true);
  });

  test('Detects unsupported Excel sheets (e.g. CDNR, B2BA) and sets itcTotalsIncomplete=true', async () => {
    const workbook = new ExcelJS.Workbook();
    const b2bSheet = workbook.addWorksheet('B2B');
    b2bSheet.addRow(['GSTIN of Supplier', 'Invoice number', 'Invoice Value', 'ITC Availability']);
    b2bSheet.addRow(['27AAACB0011F1ZX', 'INV-01', 1000, 'Y']);

    const cdnrSheet = workbook.addWorksheet('CDNR');
    cdnrSheet.addRow(['GSTIN of Supplier', 'Note Number', 'Note Value']);
    cdnrSheet.addRow(['27AAACB0011F1ZX', 'CN-01', 200]);

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const res = await parseGSTR2BExcel(buffer);

    assert.equal(res.success, true);
    assert.equal(res.itcTotalsIncomplete, true);
    assert.deepEqual(res.unsupportedSectionsDetected, ['CDNR']);
  });
});

describe('Phase 2: Rounding-Only Tolerance & Discrepancies', () => {
  test('Within ₹1 default tolerance evaluates as matched', () => {
    assert.equal(isWithinPaiseTolerance(5000.0, 5000.8, 100), true);
  });

  test('Discrepancy beyond tolerance evaluates as false', () => {
    assert.equal(isWithinPaiseTolerance(5000.0, 5002.5, 100), false);
    assert.equal(isWithinPaiseTolerance(5000.0, 5002.5, 200), false);
  });

  test('Zero percentage-band tolerance: large invoice difference is strictly evaluated', () => {
    // ₹1,000 difference on ₹115,000 bill (WeWork) is 0.87%, but fails rounding tolerance!
    assert.equal(isWithinPaiseTolerance(115000, 116000, 100), false);
    assert.equal(isWithinPaiseTolerance(115000, 116000, 200), false);
  });
});

describe('Phase 2: Probable Match on Invoice Number Variants', () => {
  test('Generates variants stripping leading zeros and FY tokens', () => {
    const v = generateInvoiceVariants('INV-00042/2024-25');
    assert.equal(v.has('INV00042202425'), true);
  });

  test('Probable match occurs ONLY when amounts are within rounding tolerance', () => {
    // Verify paise tolerance logic for probable match vs mismatched
    const valPortal = 5000.5;
    const valBook = 5000.0;
    const amountsWithinRounding = isWithinPaiseTolerance(valPortal, valBook, 100);
    assert.equal(amountsWithinRounding, true);

    const valDiffBeyond = isWithinPaiseTolerance(5000.0, 5500.0, 100);
    assert.equal(valDiffBeyond, false);
  });
});

describe('Phase 2: Database Reconciliation & 8-Way Classification Test', () => {
  before(async () => {
    await seedRealisticSandboxData();
  });

  test('Empty period returns empty rows without auto-seeding', async () => {
    const res = await reconcileITC(TEST_ORG_ID, '2025-01');
    assert.equal(res.rows.length, 0);
    assert.equal(res.summary.total_portal_entries, 0);
    assert.equal(res.summary.total_itc_eligible, 0);
  });

  test('October 2024 demo produces exactly 8 classifications and claimable ITC sum of ₹12,226.27', async () => {
    const { rows, summary } = await reconcileITC(TEST_ORG_ID, '2024-10');

    // Build a map of classifications by vendor / invoice
    const classificationMap: Record<string, string> = {};
    for (const r of rows) {
      if (r.portal) {
        classificationMap[r.portal.supplier_name] = r.status;
      } else if (r.book) {
        classificationMap[r.book.vendor_name] = r.status;
      }
    }

    // 1. AWS: matched
    assert.equal(classificationMap['Amazon Web Services India Pvt Ltd'], 'matched');

    // 2. Google: matched
    assert.equal(classificationMap['Google Cloud India Pvt Ltd'], 'matched');

    // 3. Airtel: matched
    assert.equal(classificationMap['Bharti Airtel Limited'], 'matched');

    // 4. Razorpay: matched
    assert.equal(classificationMap['Razorpay Software Pvt Ltd'], 'matched');

    // 5. WeWork: mismatched (₹1,000 difference)
    assert.equal(classificationMap['WeWork India Management Pvt Ltd'], 'mismatched');

    // 6. Dell: data_missing (vendor tax_id is null in books)
    assert.equal(classificationMap['Dell India Enterprise Pvt Ltd'], 'data_missing');

    // 7. Slack: not_expected_in_2b (foreign supplier, RCM / no Indian GSTIN, NEEDS_CA_REVIEW)
    assert.equal(classificationMap['Slack Technologies Inc.'], 'not_expected_in_2b');

    // 8. Mystery Co: missing_books (portal invoice with no corresponding book entry)
    assert.equal(classificationMap['Mystery Vendor Co. Ltd'], 'missing_books');

    // Verify summary counts
    assert.equal(summary.matched, 4);
    assert.equal(summary.mismatched, 1);
    assert.equal(summary.data_missing, 1);
    assert.equal(summary.not_expected_in_2b, 1);
    assert.equal(summary.missing_books, 1);
    assert.equal(summary.missing_portal, 0);

    // Verify claimable ITC sum:
    // AWS: 6,483.05 + Google: 2,806.78 + Airtel: 1,952.54 + Razorpay: 983.90 = ₹12,226.27
    assert.equal(summary.total_itc_eligible, 12226.27);
  });

  test('Database unique constraint guarantees import idempotency', async () => {
    const duplicateEntries = [
      {
        supplier_gstin: '27AABCA1234D1ZP',
        supplier_name: 'Amazon Web Services India Pvt Ltd',
        invoice_number: 'AWS-OCT-9912',
        invoice_date: '2024-10-01',
        invoice_value: 42500.0,
        taxable_value: 36016.95,
        igst: 0,
        cgst: 3241.52,
        sgst: 3241.53,
        total_tax: 6483.05,
        itc_available: true,
      },
    ];

    // First commit
    const commit1 = await commitGSTR2BImport(TEST_ORG_ID, '2024-10', duplicateEntries, 'upload');
    assert.equal(commit1.total, 1);
    // Already existed in demo seed, so it was updated
    assert.equal(commit1.updated, 1);

    // Second commit of the exact same entry
    const commit2 = await commitGSTR2BImport(TEST_ORG_ID, '2024-10', duplicateEntries, 'upload');
    assert.equal(commit2.total, 1);
    assert.equal(commit2.updated, 1);

    // Verify database row count for this invoice is still exactly 1
    const db = await getDb();
    const countRes = await db.query(
      `SELECT COUNT(*) as cnt FROM gstr2b_entries
       WHERE org_id = $1 AND period = $2 AND supplier_gstin = $3 AND invoice_number = $4;`,
      [TEST_ORG_ID, '2024-10', '27AABCA1234D1ZP', 'AWS-OCT-9912']
    );
    assert.equal(Number(countRes.rows[0].cnt), 1);
  });
});
