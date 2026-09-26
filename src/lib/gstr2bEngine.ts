import { getDb } from './db';
import ExcelJS from 'exceljs';

/**
 * Milestone: GSTR-2B Input Tax Credit (ITC) Reconciliation Engine
 *
 * Deterministic matching of supplier-filed GSTR-2B portal entries against
 * the entity's purchase register (bills table).
 *
 * 8 Explicit Classifications:
 *   - 'matched'            : Found in both, same GSTIN, exact normalized invoice number, amounts within rounding tolerance.
 *   - 'probable_match'     : Found in both, same GSTIN, invoice number matches under variant normalization
 *                            (leading zeros, FY suffixes, separators), amounts within rounding tolerance.
 *   - 'mismatched'         : Invoice found in both but amounts or tax exceed rounding tolerance (e.g. WeWork's ₹1,000 difference).
 *   - 'data_missing'       : Purchase bill in books has missing supplier GSTIN (e.g. Dell). Cannot reconcile against GSTR-2B.
 *   - 'not_expected_in_2b' : Foreign supplier, import of services, or Reverse Charge Mechanism (RCM) (e.g. Slack).
 *                            Tax paid via reverse charge; NOT expected in GSTR-2B. Marked NEEDS_CA_REVIEW.
 *   - 'missing_portal'     : Purchase bill in books with valid GSTIN not found in GSTR-2B (supplier hasn't filed GSTR-1, ITC blocked).
 *   - 'missing_books'      : Portal shows invoice filed by supplier, but not found in purchase books (e.g. Mystery Co).
 *
 * EXPLICIT KNOWN LIMITATION:
 * One-to-many and many-to-one invoice matching (e.g. multiple delivery challans booked as a single bill,
 * or partial billings against one portal invoice) is NOT supported in Phase 2. Matching is strictly 1:1.
 *
 * CRITICAL: All financial calculations use integer-paise arithmetic. Deterministic TypeScript/SQL only — NO AI.
 */

// ─────────────────────────────────────────────────────────────────────────────
// SOURCED GSTN SCHEMA TYPES & REFERENCES
// ─────────────────────────────────────────────────────────────────────────────
// Live Sources verified during session:
// - GST Developer Portal (Returns API): https://developer.gst.gov.in/pages/apiportal/tpreturn.html
//   (Fetched live; defines gstin, ret_period, rtn_typ, and OIDAR validation regex: [9][9][0-9]{2}[a-zA-Z]{3}[0-9]{5}[O][S][0-9a-zA-Z]{1})
// - GST Developer Portal Root: https://developer.gst.gov.in/ (Fetched live)
// - GST Portal Advisory 402: https://www.gst.gov.in/newsandupdates/read/402 (Fetched live)
//
// NOTICE: Full JSON payload structures for GSTR-2B require authenticated GSP credentials
// on the developer portal. Specific field names (b2b, ctin, inum, idt, val, itcavl, rsn, items,
// txval, iamt, camt, samt) are derived best-effort from public references and are tagged with
// NEEDS_VERIFICATION comments below. Handled defensively with fallbacks in all cases.
//
// Unsupported sections detected in JSON/Excel: 'b2ba', 'cdnr', 'cdnra', 'isd', 'impg', 'impgsez'.

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
  itc_ineligible_reason?: string | null;
  source?: string;
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

export type MatchStatus =
  | 'matched'
  | 'probable_match'
  | 'mismatched'
  | 'data_missing'
  | 'not_expected_in_2b'
  | 'missing_portal'
  | 'missing_books';

export interface ITCReconciliationRow {
  status: MatchStatus;
  portal?: GSTR2BEntry;
  book?: BillEntry;
  // Computed deltas
  amount_diff?: number;
  tax_diff?: number;
  // ITC impact
  itc_eligible: number;     // ITC that can be claimed this period
  itc_blocked: number;      // ITC that cannot be claimed or is blocked under Sec 17(5)
  mismatch_reason?: string;
  match_confidence?: 'exact' | 'variant' | 'none';
  review_status?: 'NEEDS_CA_REVIEW' | 'AUTO_ALIGNED' | 'RESOLVED';
}

export interface ITCSummary {
  period: string;
  total_portal_entries: number;
  total_book_entries: number;
  matched: number;
  probable_match: number;
  mismatched: number;
  data_missing: number;
  not_expected_in_2b: number;
  missing_portal: number;
  missing_books: number;
  total_itc_eligible: number;       // Sum of eligible tax on matched entries where itc_available=true
  total_itc_blocked: number;        // Sum of tax on missing_portal + mismatched + itc_available=false
  total_itc_mismatch_risk: number;  // Tax on mismatched entries
  net_itc_position: number;         // eligible - blocked
  itc_totals_incomplete?: boolean;
  unsupported_sections?: string[];
}

export interface ReconciliationOptions {
  taxTolerancePaise?: number;    // Default 100 paise (₹1.00), maximum 200 paise (₹2.00)
  valueTolerancePaise?: number;  // Default 100 paise (₹1.00), maximum 200 paise (₹2.00)
}

export interface ParsedGSTR2BEntry {
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
  itc_ineligible_reason?: string | null;
}

export interface GSTR2BParseResult {
  success: boolean;
  period?: string;
  entries: ParsedGSTR2BEntry[];
  errors: string[];
  warnings: string[];
  unsupportedSectionsDetected: string[];
  itcTotalsIncomplete: boolean;
  summary: {
    totalEntries: number;
    totalInvoiceValue: number;
    totalTaxableValue: number;
    totalIgst: number;
    totalCgst: number;
    totalSgst: number;
    totalTax: number;
    totalIneligibleTax: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// INTEGER-PAISE ARITHMETIC HELPERS
// ─────────────────────────────────────────────────────────────────────────────

export function toPaise(rupees: number | null | undefined): number {
  if (rupees === null || rupees === undefined || isNaN(rupees)) return 0;
  return Math.round(rupees * 100);
}

export function fromPaise(paise: number): number {
  return paise / 100;
}

/**
 * Checks if two rupee values are within an integer-paise tolerance.
 * Tolerance is strictly clamped to between 0 and 200 paise (₹0.00 to ₹2.00).
 * No percentage bands are applied!
 */
export function isWithinPaiseTolerance(
  a: number,
  b: number,
  tolerancePaise: number = 100
): boolean {
  const safeTolerance = Math.max(0, Math.min(200, Math.round(tolerancePaise)));
  const diff = Math.abs(toPaise(a) - toPaise(b));
  return diff <= safeTolerance;
}

// ─────────────────────────────────────────────────────────────────────────────
// STRING & INVOICE NORMALIZATION HELPERS
// ─────────────────────────────────────────────────────────────────────────────

export function normalizeGSTIN(gstin: string | null | undefined): string {
  return (gstin || '').trim().toUpperCase();
}

/**
 * Normalizes invoice number by stripping whitespace, slashes, hyphens, underscores.
 */
export function normalizeInvoiceNumber(inv: string | null | undefined): string {
  return (inv || '').trim().toUpperCase().replace(/[\s\-_/\\#.]+/g, '');
}

/**
 * Generates variants of an invoice number to detect probable matches:
 * 1. Exact normalized (separators stripped)
 * 2. Strip leading zeros in numeric segments: e.g. INV0042 -> INV42
 * 3. Strip standard Financial Year suffixes/prefixes: e.g. 24-25, 2024-25, 2425, 202425
 * 4. Strip month-year tokens: e.g. OCT24, OCT2024
 */
export function generateInvoiceVariants(inv: string | null | undefined): Set<string> {
  const variants = new Set<string>();
  if (!inv) return variants;

  const raw = inv.trim().toUpperCase();
  const baseNormalized = normalizeInvoiceNumber(raw);
  if (!baseNormalized) return variants;

  variants.add(baseNormalized);

  // Variant A: strip leading zeros from any numeric block (e.g. "INV00042" -> "INV42", "009912" -> "9912")
  const strippedZeros = baseNormalized.replace(/(?<=[A-Z]|^)0+(?=[1-9])/g, '');
  if (strippedZeros) variants.add(strippedZeros);

  // Variant B: strip financial year suffixes/tokens (e.g. 202425, 2425, 202324, 2324)
  const strippedFY = baseNormalized.replace(/(20\d\d\d\d|\d\d\d\d)$/g, '');
  if (strippedFY && strippedFY.length >= 3) {
    variants.add(strippedFY);
    const fyNoZeros = strippedFY.replace(/(?<=[A-Z]|^)0+(?=[1-9])/g, '');
    if (fyNoZeros) variants.add(fyNoZeros);
  }

  // Variant C: remove common 2-digit / 4-digit year tokens following month abbreviations
  const strippedMonthYear = baseNormalized.replace(/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(20\d\d|\d\d)/g, '$1');
  if (strippedMonthYear && strippedMonthYear.length >= 3) {
    variants.add(strippedMonthYear);
  }

  return variants;
}

/**
 * Detects if a vendor is foreign, RCM, or not expected to file an Indian GSTR-1.
 * Foreign SaaS vendors (e.g. Slack Technologies Inc.) have no Indian establishment
 * and NO Indian GSTIN. Their invoices do not appear in GSTR-2B; tax must be discharged
 * under Reverse Charge Mechanism (RCM) under Section 5(3) of the IGST Act.
 *
 * This function does NOT depend on a GSTIN being present — an overseas vendor with
 * vendorGstin=null is correctly identified by corporate form (Inc., LLC, etc.) or known SaaS vendor.
 */
export function isForeignOrRcmVendor(vendorName: string, vendorGstin?: string | null): boolean {
  const nameUpper = (vendorName || '').toUpperCase();
  const gstinUpper = normalizeGSTIN(vendorGstin);

  // If a GSTIN was provided, check if it explicitly indicates foreign/non-resident/OIDAR
  if (gstinUpper) {
    if (gstinUpper.startsWith('99')) return true;
    if (/USA|CORP|LLC|INC|FOREIGN/i.test(gstinUpper)) return true;
    if (gstinUpper.length !== 15) return true;
  }

  // Detect foreign legal entities (Inc., LLC, Corp., GmbH without Indian Ltd/Pvt Ltd suffix)
  const hasForeignCorporateSuffix =
    /\b(INC\.?|L\.?L\.?C\.?|CORP\.?|CORPORATION|GMBH|S\.?A\.?R\.?L\.?)\b/i.test(nameUpper) &&
    !/\b(INDIA|PVT|PRIVATE|LIMITED|LTD)\b/i.test(nameUpper);

  // Known overseas cloud/SaaS providers with no domestic GSTR-1 obligation
  const isKnownOverseasSaaS =
    nameUpper.includes('SLACK TECHNOLOGIES') ||
    nameUpper.includes('GITHUB') ||
    nameUpper.includes('STRIPE PAYMENTS') ||
    nameUpper.includes('FIGMA') ||
    nameUpper.includes('ATLASSIAN') ||
    nameUpper.includes('ZOOM VIDEO') ||
    nameUpper.includes('NOTION LABS');

  return hasForeignCorporateSuffix || isKnownOverseasSaaS;
}

// ─────────────────────────────────────────────────────────────────────────────
// PARSER: GSTR-2B JSON (GSTN OFFICIAL STRUCTURE)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parses raw GSTR-2B JSON payload according to GSTN specifications.
 * Supports unwrapped or wrapped ({ data: { b2b: [...] } }) JSON objects.
 * Sourced from GSTN portal specifications.
 */
export function parseGSTR2BJson(rawContent: string | Record<string, any>): GSTR2BParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const entries: ParsedGSTR2BEntry[] = [];
  const unsupportedSectionsDetected: string[] = [];

  let dataObj: any;
  if (typeof rawContent === 'string') {
    try {
      dataObj = JSON.parse(rawContent);
    } catch (e: any) {
      return {
        success: false,
        entries: [],
        errors: [`Invalid JSON format: ${e.message}`],
        warnings: [],
        unsupportedSectionsDetected: [],
        itcTotalsIncomplete: false,
        summary: { totalEntries: 0, totalInvoiceValue: 0, totalTaxableValue: 0, totalIgst: 0, totalCgst: 0, totalSgst: 0, totalTax: 0, totalIneligibleTax: 0 }
      };
    }
  } else {
    dataObj = rawContent;
  }

  if (!dataObj || typeof dataObj !== 'object') {
    return {
      success: false,
      entries: [],
      errors: ['JSON root must be an object'],
      warnings: [],
      unsupportedSectionsDetected: [],
      itcTotalsIncomplete: false,
      summary: { totalEntries: 0, totalInvoiceValue: 0, totalTaxableValue: 0, totalIgst: 0, totalCgst: 0, totalSgst: 0, totalTax: 0, totalIneligibleTax: 0 }
    };
  }

  // Handle optional { data: { ... } } wrapper
  const root = (dataObj.data && typeof dataObj.data === 'object') ? dataObj.data : dataObj;

  // Extract return period if provided: e.g. "102024" -> "2024-10" or "2024-10"
  let period: string | undefined = undefined;
  const rawFp = root.fp || dataObj.fp;
  if (rawFp && typeof rawFp === 'string') {
    if (/^\d{6}$/.test(rawFp)) {
      const month = rawFp.slice(0, 2);
      const year = rawFp.slice(2);
      period = `${year}-${month}`;
    } else if (/^\d{4}-\d{2}$/.test(rawFp)) {
      period = rawFp;
    }
  }

  // Check for unsupported sections: b2ba, cdnr, cdnra, isd, impg, impgsez
  const unsupportedKeys = ['b2ba', 'cdnr', 'cdnra', 'isd', 'impg', 'impgsez'];
  for (const sec of unsupportedKeys) {
    if (Array.isArray(root[sec]) && root[sec].length > 0) {
      unsupportedSectionsDetected.push(sec);
    }
  }

  // Parse supported section: b2b
  // NEEDS_VERIFICATION: 'b2b' is standard section key in public GSTN references; verify against live portal payload
  const b2bList = root.b2b;
  if (!Array.isArray(b2bList)) {
    if (unsupportedSectionsDetected.length > 0) {
      warnings.push(`No 'b2b' section found, but found unsupported sections: ${unsupportedSectionsDetected.join(', ')}`);
    } else {
      errors.push("Missing 'b2b' section in GSTR-2B data");
    }
  } else {
    for (let sIdx = 0; sIdx < b2bList.length; sIdx++) {
      const supplier = b2bList[sIdx];
      if (!supplier || typeof supplier !== 'object') continue;

      // NEEDS_VERIFICATION: 'ctin' represents counterparty supplier GSTIN
      const ctin = normalizeGSTIN(supplier.ctin);
      if (!ctin) {
        warnings.push(`Supplier at index ${sIdx} is missing 'ctin' (GSTIN)`);
        continue;
      }

      // NEEDS_VERIFICATION: supplier trade/legal name key in GSTN payload; handled defensively with trdnm/supp_name/trade_name/cname fallbacks
      const suppName = String(supplier.trdnm || supplier.supp_name || supplier.trade_name || supplier.cname || ctin).trim();
      // NEEDS_VERIFICATION: 'inv' array key holding supplier invoices
      const invList = supplier.inv;

      if (!Array.isArray(invList)) {
        warnings.push(`Supplier ${ctin} has no 'inv' array`);
        continue;
      }

      for (let iIdx = 0; iIdx < invList.length; iIdx++) {
        const inv = invList[iIdx];
        if (!inv || typeof inv !== 'object') continue;

        // NEEDS_VERIFICATION: 'inum' represents invoice number; handled defensively
        const inum = String(inv.inum || '').trim();
        if (!inum) {
          warnings.push(`Supplier ${ctin} invoice at index ${iIdx} missing 'inum'`);
          continue;
        }

        // NEEDS_VERIFICATION: 'idt' represents invoice date in DD-MM-YYYY format
        const idt = String(inv.idt || '').trim();
        // NEEDS_VERIFICATION: 'val' represents invoice total value
        const val = Number(inv.val) || 0;

        // NEEDS_VERIFICATION: 'itcavl' represents ITC availability ('Y'/'N'); default to 'Y' if omitted
        const itcAvailable = String(inv.itcavl || 'Y').toUpperCase() !== 'N';

        // NEEDS_VERIFICATION: field name for ineligibility reason in GSTN schema; handled defensively with rsn/reason/itc_reason fallbacks
        const ineligibleReason = !itcAvailable
          ? String(inv.rsn || inv.reason || inv.itc_reason || 'Ineligible under Section 17(5)').trim()
          : null;

        // Sum line items: txval, iamt, camt, samt
        // NEEDS_VERIFICATION: 'items' array key holding rate-wise line item details
        let taxableVal = 0;
        let igst = 0;
        let cgst = 0;
        let sgst = 0;

        if (Array.isArray(inv.items)) {
          for (const itm of inv.items) {
            // NEEDS_VERIFICATION: 'txval', 'iamt', 'camt', 'samt' line item breakdown fields
            taxableVal += Number(itm.txval) || 0;
            igst += Number(itm.iamt) || 0;
            cgst += Number(itm.camt) || 0;
            sgst += Number(itm.samt) || 0;
          }
        } else {
          // If items omitted, check top-level fields defensively
          taxableVal = Number(inv.txval) || 0;
          igst = Number(inv.iamt) || 0;
          cgst = Number(inv.camt) || 0;
          sgst = Number(inv.samt) || 0;
        }

        const totalTax = Math.round((igst + cgst + sgst) * 100) / 100;

        entries.push({
          supplier_gstin: ctin,
          supplier_name: suppName,
          invoice_number: inum,
          invoice_date: idt,
          invoice_value: Math.round(val * 100) / 100,
          taxable_value: Math.round(taxableVal * 100) / 100,
          igst: Math.round(igst * 100) / 100,
          cgst: Math.round(cgst * 100) / 100,
          sgst: Math.round(sgst * 100) / 100,
          total_tax: totalTax,
          itc_available: itcAvailable,
          itc_ineligible_reason: ineligibleReason,
        });
      }
    }
  }

  // Summary aggregation using integer-paise math
  let totalInvPaise = 0;
  let totalTaxablePaise = 0;
  let totalIgstPaise = 0;
  let totalCgstPaise = 0;
  let totalSgstPaise = 0;
  let totalTaxPaise = 0;
  let totalIneligibleTaxPaise = 0;

  for (const e of entries) {
    totalInvPaise += toPaise(e.invoice_value);
    totalTaxablePaise += toPaise(e.taxable_value);
    totalIgstPaise += toPaise(e.igst);
    totalCgstPaise += toPaise(e.cgst);
    totalSgstPaise += toPaise(e.sgst);
    totalTaxPaise += toPaise(e.total_tax);
    if (!e.itc_available) {
      totalIneligibleTaxPaise += toPaise(e.total_tax);
    }
  }

  return {
    success: errors.length === 0,
    period,
    entries,
    errors,
    warnings,
    unsupportedSectionsDetected,
    itcTotalsIncomplete: unsupportedSectionsDetected.length > 0,
    summary: {
      totalEntries: entries.length,
      totalInvoiceValue: fromPaise(totalInvPaise),
      totalTaxableValue: fromPaise(totalTaxablePaise),
      totalIgst: fromPaise(totalIgstPaise),
      totalCgst: fromPaise(totalCgstPaise),
      totalSgst: fromPaise(totalSgstPaise),
      totalTax: fromPaise(totalTaxPaise),
      totalIneligibleTax: fromPaise(totalIneligibleTaxPaise),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PARSER: GSTR-2B EXCEL (OFFICIAL GST PORTAL DOWNLOAD LAYOUT)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parses GSTR-2B Excel workbook downloaded from the GST Portal.
 * Uses maintained exceljs library.
 * Scans for B2B worksheet and identifies columns defensively.
 * Detects CDNR, CDNRA, B2BA, ISD, IMPG worksheets and flags them as unsupported.
 */
export async function parseGSTR2BExcel(buffer: Buffer): Promise<GSTR2BParseResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const unsupportedSectionsDetected: string[] = [];

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as any);
  } catch (err: any) {
    return {
      success: false,
      entries: [],
      errors: [`Failed to load Excel file: ${err.message}`],
      warnings: [],
      unsupportedSectionsDetected: [],
      itcTotalsIncomplete: false,
      summary: { totalEntries: 0, totalInvoiceValue: 0, totalTaxableValue: 0, totalIgst: 0, totalCgst: 0, totalSgst: 0, totalTax: 0, totalIneligibleTax: 0 }
    };
  }

  // Find all worksheets and check for unsupported sections
  let b2bSheet: ExcelJS.Worksheet | undefined;
  const unsupportedSheetNames = ['CDNR', 'CDNRA', 'B2BA', 'ISD', 'IMPG', 'IMPGSEZ'];

  for (const sheet of workbook.worksheets) {
    const sName = sheet.name.trim().toUpperCase();
    if (sName === 'B2B' || sName.includes('B2B -') || sName.includes('B2B_INVOICES') || sName === 'INVOICES') {
      b2bSheet = sheet;
    } else {
      for (const unsupp of unsupportedSheetNames) {
        if (sName === unsupp || sName.startsWith(`${unsupp} `) || sName.startsWith(`${unsupp}-`)) {
          if (sheet.rowCount > 1) {
            unsupportedSectionsDetected.push(unsupp);
          }
        }
      }
    }
  }

  if (!b2bSheet) {
    // If no sheet explicitly named B2B, check the first sheet
    b2bSheet = workbook.worksheets[0];
    if (!b2bSheet) {
      return {
        success: false,
        entries: [],
        errors: ['Excel workbook contains no worksheets'],
        warnings: [],
        unsupportedSectionsDetected,
        itcTotalsIncomplete: unsupportedSectionsDetected.length > 0,
        summary: { totalEntries: 0, totalInvoiceValue: 0, totalTaxableValue: 0, totalIgst: 0, totalCgst: 0, totalSgst: 0, totalTax: 0, totalIneligibleTax: 0 }
      };
    }
  }

  // Scan rows 1 through 10 to find header row containing GSTIN / Invoice Number
  let headerRowIndex = -1;
  const colMap = new Map<string, number>();

  for (let r = 1; r <= Math.min(15, b2bSheet.rowCount); r++) {
    const row = b2bSheet.getRow(r);
    const rowValues: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => {
      rowValues.push(String(cell.text || cell.value || '').trim());
    });

    const joined = rowValues.join(' ').toLowerCase();
    if (joined.includes('gstin') && (joined.includes('invoice') || joined.includes('inv'))) {
      headerRowIndex = r;
      // Map column positions
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        const text = String(cell.text || cell.value || '').trim().toLowerCase();
        if (text.includes('gstin of supplier') || text.includes('supplier gstin') || text === 'gstin') {
          colMap.set('gstin', colNumber);
        } else if (text.includes('trade/legal') || text.includes('trade name') || text.includes('supplier name') || text.includes('legal name')) {
          colMap.set('name', colNumber);
        } else if (text.includes('invoice number') || text.includes('invoice no') || text === 'inum') {
          colMap.set('invoice_number', colNumber);
        } else if (text.includes('invoice date') || text === 'date' || text === 'idt') {
          colMap.set('invoice_date', colNumber);
        } else if (text.includes('invoice value') || text.includes('total value') || text === 'val') {
          colMap.set('invoice_value', colNumber);
        } else if (text.includes('taxable value') || text === 'txval') {
          colMap.set('taxable_value', colNumber);
        } else if (text.includes('integrated tax') || text.includes('igst') || text === 'iamt') {
          colMap.set('igst', colNumber);
        } else if (text.includes('central tax') || text.includes('cgst') || text === 'camt') {
          colMap.set('cgst', colNumber);
        } else if (text.includes('state/ut tax') || text.includes('state tax') || text.includes('sgst') || text === 'samt') {
          colMap.set('sgst', colNumber);
        } else if (text.includes('itc availability') || text.includes('itc available') || text === 'itcavl') {
          colMap.set('itc_available', colNumber);
        } else if (text.includes('reason') || text.includes('ineligibility reason') || text === 'rsn') {
          // NEEDS_VERIFICATION: Excel column header for ineligibility reason in GST Portal export; handled defensively
          colMap.set('reason', colNumber);
        }
      });
      break;
    }
  }

  if (headerRowIndex === -1 || !colMap.has('gstin') || !colMap.has('invoice_number')) {
    errors.push('Could not locate valid GSTR-2B table headers (Supplier GSTIN, Invoice Number) in Excel sheet');
    return {
      success: false,
      entries: [],
      errors,
      warnings,
      unsupportedSectionsDetected,
      itcTotalsIncomplete: unsupportedSectionsDetected.length > 0,
      summary: { totalEntries: 0, totalInvoiceValue: 0, totalTaxableValue: 0, totalIgst: 0, totalCgst: 0, totalSgst: 0, totalTax: 0, totalIneligibleTax: 0 }
    };
  }

  const parsedEntries: ParsedGSTR2BEntry[] = [];

  for (let r = headerRowIndex + 1; r <= b2bSheet.rowCount; r++) {
    const row = b2bSheet.getRow(r);

    const getCellValue = (key: string): any => {
      const col = colMap.get(key);
      if (!col) return undefined;
      const cell = row.getCell(col);
      return cell.value;
    };

    const rawGstin = getCellValue('gstin');
    const rawInvNum = getCellValue('invoice_number');
    if (!rawGstin || !rawInvNum) continue;

    const gstin = normalizeGSTIN(String(rawGstin));
    const invNum = String(rawInvNum).trim();
    if (!gstin || !invNum) continue;

    const rawName = getCellValue('name');
    const suppName = rawName ? String(rawName).trim() : gstin;

    const rawDate = getCellValue('invoice_date');
    let invDate = '';
    if (rawDate instanceof Date) {
      invDate = rawDate.toISOString().slice(0, 10);
    } else if (rawDate) {
      invDate = String(rawDate).trim();
    }

    const parseNum = (val: any): number => {
      if (typeof val === 'number') return isNaN(val) ? 0 : val;
      if (!val) return 0;
      const clean = String(val).replace(/[^0-9.-]/g, '');
      const num = parseFloat(clean);
      return isNaN(num) ? 0 : num;
    };

    const invVal = parseNum(getCellValue('invoice_value'));
    const taxableVal = parseNum(getCellValue('taxable_value'));
    const igst = parseNum(getCellValue('igst'));
    const cgst = parseNum(getCellValue('cgst'));
    const sgst = parseNum(getCellValue('sgst'));

    const rawItc = getCellValue('itc_available');
    let itcAvailable = true;
    if (rawItc !== undefined && rawItc !== null) {
      const itcStr = String(rawItc).trim().toUpperCase();
      if (itcStr === 'N' || itcStr === 'NO' || itcStr === 'FALSE' || itcStr === 'INELIGIBLE') {
        itcAvailable = false;
      }
    }

    // NEEDS_VERIFICATION: field name for ineligibility reason in GSTN schema; handled defensively
    const rawReason = getCellValue('reason');
    const ineligibleReason = !itcAvailable
      ? (rawReason ? String(rawReason).trim() : 'Ineligible under Section 17(5)')
      : null;

    const totalTax = Math.round((igst + cgst + sgst) * 100) / 100;

    parsedEntries.push({
      supplier_gstin: gstin,
      supplier_name: suppName,
      invoice_number: invNum,
      invoice_date: invDate,
      invoice_value: Math.round(invVal * 100) / 100,
      taxable_value: Math.round(taxableVal * 100) / 100,
      igst: Math.round(igst * 100) / 100,
      cgst: Math.round(cgst * 100) / 100,
      sgst: Math.round(sgst * 100) / 100,
      total_tax: totalTax,
      itc_available: itcAvailable,
      itc_ineligible_reason: ineligibleReason,
    });
  }

  let totalInvPaise = 0;
  let totalTaxablePaise = 0;
  let totalIgstPaise = 0;
  let totalCgstPaise = 0;
  let totalSgstPaise = 0;
  let totalTaxPaise = 0;
  let totalIneligibleTaxPaise = 0;

  for (const e of parsedEntries) {
    totalInvPaise += toPaise(e.invoice_value);
    totalTaxablePaise += toPaise(e.taxable_value);
    totalIgstPaise += toPaise(e.igst);
    totalCgstPaise += toPaise(e.cgst);
    totalSgstPaise += toPaise(e.sgst);
    totalTaxPaise += toPaise(e.total_tax);
    if (!e.itc_available) {
      totalIneligibleTaxPaise += toPaise(e.total_tax);
    }
  }

  return {
    success: true,
    entries: parsedEntries,
    errors: [],
    warnings,
    unsupportedSectionsDetected,
    itcTotalsIncomplete: unsupportedSectionsDetected.length > 0,
    summary: {
      totalEntries: parsedEntries.length,
      totalInvoiceValue: fromPaise(totalInvPaise),
      totalTaxableValue: fromPaise(totalTaxablePaise),
      totalIgst: fromPaise(totalIgstPaise),
      totalCgst: fromPaise(totalCgstPaise),
      totalSgst: fromPaise(totalSgstPaise),
      totalTax: fromPaise(totalTaxPaise),
      totalIneligibleTax: fromPaise(totalIneligibleTaxPaise),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// DATABASE IMPORT: TRANSACTIONAL & IDEMPOTENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Commits parsed GSTR-2B entries into the database inside a transaction.
 * Uses the UNIQUE constraint (org_id, period, supplier_gstin, invoice_number)
 * to guarantee idempotency.
 */
export async function commitGSTR2BImport(
  orgId: string,
  period: string,
  entries: ParsedGSTR2BEntry[],
  source: string = 'upload'
): Promise<{ inserted: number; updated: number; total: number }> {
  const db = await getDb();

  return await db.transaction(async (trx) => {
    let inserted = 0;
    let updated = 0;

    for (const e of entries) {
      const id = `gstr2b-${orgId}-${period}-${normalizeGSTIN(e.supplier_gstin)}-${normalizeInvoiceNumber(e.invoice_number)}`.slice(0, 80);

      const res = await trx.query(
        `INSERT INTO gstr2b_entries
           (id, org_id, period, supplier_gstin, supplier_name, invoice_number,
            invoice_date, invoice_value, taxable_value, igst, cgst, sgst,
            itc_available, itc_ineligible_reason, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (org_id, period, supplier_gstin, invoice_number)
         DO UPDATE SET
           supplier_name = EXCLUDED.supplier_name,
           invoice_date = EXCLUDED.invoice_date,
           invoice_value = EXCLUDED.invoice_value,
           taxable_value = EXCLUDED.taxable_value,
           igst = EXCLUDED.igst,
           cgst = EXCLUDED.cgst,
           sgst = EXCLUDED.sgst,
           itc_available = EXCLUDED.itc_available,
           itc_ineligible_reason = EXCLUDED.itc_ineligible_reason,
           source = EXCLUDED.source
         RETURNING (xmax = 0) AS is_insert;`,
        [
          id,
          orgId,
          period,
          normalizeGSTIN(e.supplier_gstin),
          e.supplier_name,
          e.invoice_number,
          e.invoice_date || null,
          e.invoice_value,
          e.taxable_value,
          e.igst,
          e.cgst,
          e.sgst,
          e.itc_available,
          e.itc_ineligible_reason || null,
          source,
        ]
      );

      if (res.rows[0]?.is_insert) {
        inserted++;
      } else {
        updated++;
      }
    }

    return { inserted, updated, total: entries.length };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// RECONCILIATION ENGINE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Main ITC Reconciliation function.
 * Deterministic matching between GSTR-2B portal entries and purchase books.
 * Strictly uses integer-paise comparison and rounding-only tolerance (default ₹1, max ₹2).
 */
export async function reconcileITC(
  orgId: string,
  period: string,
  options: ReconciliationOptions = {}
): Promise<{ rows: ITCReconciliationRow[]; summary: ITCSummary }> {
  const db = await getDb();

  // Tolerance setup: default 100 paise (₹1.00), clamp to max 200 paise (₹2.00)
  const taxTolPaise = Math.max(0, Math.min(200, Math.round(options.taxTolerancePaise ?? 100)));
  const valTolPaise = Math.max(0, Math.min(200, Math.round(options.valueTolerancePaise ?? 100)));

  // 1. Fetch GSTR-2B portal entries for this org + period
  const portalRes = await db.query<GSTR2BEntry>(
    `SELECT id, period, supplier_gstin, supplier_name, invoice_number, invoice_date,
            invoice_value, taxable_value, igst, cgst, sgst,
            (igst + cgst + sgst) AS total_tax, itc_available, itc_ineligible_reason, source
     FROM gstr2b_entries
     WHERE org_id = $1 AND period = $2
     ORDER BY supplier_name, invoice_number;`,
    [orgId, period]
  );
  const portalEntries: GSTR2BEntry[] = portalRes.rows.map((r: any) => ({
    ...r,
    invoice_value: Number(r.invoice_value),
    taxable_value: Number(r.taxable_value),
    igst: Number(r.igst),
    cgst: Number(r.cgst),
    sgst: Number(r.sgst),
    total_tax: Number(r.total_tax),
    itc_available: Boolean(r.itc_available),
    itc_ineligible_reason: r.itc_ineligible_reason || null,
  }));

  // 2. Fetch all purchase bills within ±45 days of the period
  const [year, month] = period.split('-').map(Number);
  const periodStart = new Date(year, month - 2, 1).toISOString().slice(0, 10);
  const periodEnd = new Date(year, month, 15).toISOString().slice(0, 10);

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

  // ─── STEP 1: Attempt Exact Normalized Match on Portal Entries ─────────────
  for (const portal of portalEntries) {
    const pGSTIN = normalizeGSTIN(portal.supplier_gstin);
    const pInvExact = normalizeInvoiceNumber(portal.invoice_number);
    const pTax = portal.total_tax;
    const pVal = portal.invoice_value;

    const bookMatch = bookEntries.find((b) => {
      if (matchedBookIds.has(b.id)) return false;
      const bGSTIN = normalizeGSTIN(b.vendor_gstin);
      const bInvExact = normalizeInvoiceNumber(b.bill_number);
      return bGSTIN === pGSTIN && bInvExact === pInvExact;
    });

    if (bookMatch) {
      matchedBookIds.add(bookMatch.id);
      matchedPortalIds.add(portal.id);

      const valOk = isWithinPaiseTolerance(pVal, bookMatch.total_amount, valTolPaise);
      const taxOk = isWithinPaiseTolerance(pTax, bookMatch.tax_amount, taxTolPaise);

      if (valOk && taxOk) {
        // Matched
        const claimable = portal.itc_available ? pTax : 0;
        const blocked = portal.itc_available ? 0 : pTax;
        rows.push({
          status: 'matched',
          portal,
          book: bookMatch,
          itc_eligible: claimable,
          itc_blocked: blocked,
          match_confidence: 'exact',
          review_status: 'AUTO_ALIGNED',
          mismatch_reason: !portal.itc_available
            ? (portal.itc_ineligible_reason || 'Blocked credit under Section 17(5)')
            : undefined,
        });
      } else {
        // Mismatched
        const reasons: string[] = [];
        const amtDiff = Math.round((pVal - bookMatch.total_amount) * 100) / 100;
        const taxDiff = Math.round((pTax - bookMatch.tax_amount) * 100) / 100;
        if (!valOk) reasons.push(`Invoice value discrepancy: portal ₹${pVal.toFixed(2)} vs books ₹${bookMatch.total_amount.toFixed(2)} (diff ₹${amtDiff.toFixed(2)})`);
        if (!taxOk) reasons.push(`Tax discrepancy: portal ₹${pTax.toFixed(2)} vs books ₹${bookMatch.tax_amount.toFixed(2)} (diff ₹${taxDiff.toFixed(2)})`);

        rows.push({
          status: 'mismatched',
          portal,
          book: bookMatch,
          amount_diff: amtDiff,
          tax_diff: taxDiff,
          itc_eligible: 0,
          itc_blocked: pTax,
          match_confidence: 'exact',
          review_status: 'NEEDS_CA_REVIEW',
          mismatch_reason: reasons.join('; '),
        });
      }
    }
  }

  // ─── STEP 2: Attempt Variant Match on Remaining Portal Entries ─────────────
  // (probable_match ONLY when amounts are within rounding tolerance!)
  for (const portal of portalEntries) {
    if (matchedPortalIds.has(portal.id)) continue;

    const pGSTIN = normalizeGSTIN(portal.supplier_gstin);
    const pVariants = generateInvoiceVariants(portal.invoice_number);
    const pTax = portal.total_tax;
    const pVal = portal.invoice_value;

    const bookMatch = bookEntries.find((b) => {
      if (matchedBookIds.has(b.id)) return false;
      const bGSTIN = normalizeGSTIN(b.vendor_gstin);
      if (bGSTIN !== pGSTIN) return false;

      const bVariants = generateInvoiceVariants(b.bill_number);
      for (const pv of pVariants) {
        if (bVariants.has(pv)) return true;
      }
      return false;
    });

    if (bookMatch) {
      matchedBookIds.add(bookMatch.id);
      matchedPortalIds.add(portal.id);

      const valOk = isWithinPaiseTolerance(pVal, bookMatch.total_amount, valTolPaise);
      const taxOk = isWithinPaiseTolerance(pTax, bookMatch.tax_amount, taxTolPaise);

      if (valOk && taxOk) {
        // Probable Match: invoice number format variant, amounts within rounding
        const claimable = portal.itc_available ? pTax : 0;
        const blocked = portal.itc_available ? 0 : pTax;
        rows.push({
          status: 'probable_match',
          portal,
          book: bookMatch,
          itc_eligible: claimable,
          itc_blocked: blocked,
          match_confidence: 'variant',
          review_status: 'NEEDS_CA_REVIEW',
          mismatch_reason: `Probable match on invoice number variation: portal "${portal.invoice_number}" vs books "${bookMatch.bill_number}". Amounts align within ₹${(taxTolPaise / 100).toFixed(2)}.`,
        });
      } else {
        // Variant found but amounts differ -> mismatched!
        const amtDiff = Math.round((pVal - bookMatch.total_amount) * 100) / 100;
        const taxDiff = Math.round((pTax - bookMatch.tax_amount) * 100) / 100;
        rows.push({
          status: 'mismatched',
          portal,
          book: bookMatch,
          amount_diff: amtDiff,
          tax_diff: taxDiff,
          itc_eligible: 0,
          itc_blocked: pTax,
          match_confidence: 'variant',
          review_status: 'NEEDS_CA_REVIEW',
          mismatch_reason: `Invoice number variant matched ("${portal.invoice_number}" vs "${bookMatch.bill_number}"), but amounts differ: portal ₹${pVal.toFixed(2)} vs books ₹${bookMatch.total_amount.toFixed(2)} (diff ₹${amtDiff.toFixed(2)}).`,
        });
      }
    }
  }

  // ─── STEP 3: Remaining Portal Entries -> missing_books ────────────────────
  for (const portal of portalEntries) {
    if (!matchedPortalIds.has(portal.id)) {
      matchedPortalIds.add(portal.id);
      rows.push({
        status: 'missing_books',
        portal,
        itc_eligible: 0,
        itc_blocked: 0,
        review_status: 'NEEDS_CA_REVIEW',
        mismatch_reason: 'Invoice present in GSTN GSTR-2B portal but not found in purchase books. Record the bill to claim ITC.',
      });
    }
  }

  // ─── STEP 4: Remaining Book Entries -> not_expected_in_2b, data_missing, or missing_portal
  for (const book of bookEntries) {
    if (!matchedBookIds.has(book.id)) {
      const isForeign = isForeignOrRcmVendor(book.vendor_name, book.vendor_gstin);

      if (isForeign) {
        // Slack case: foreign vendor / import of services (RCM) — overseas vendors have NO Indian GSTIN!
        rows.push({
          status: 'not_expected_in_2b',
          book,
          itc_eligible: 0,
          itc_blocked: 0,
          review_status: 'NEEDS_CA_REVIEW',
          mismatch_reason: 'Foreign vendor / Import of Services (RCM). Overseas supplier has no Indian establishment or GSTIN; invoice is not expected in GSTR-2B. Tax must be discharged via Reverse Charge under Section 5(3) of IGST Act. NEEDS_CA_REVIEW.',
        });
      } else if (!normalizeGSTIN(book.vendor_gstin)) {
        // Dell case: domestic vendor missing GSTIN in books
        rows.push({
          status: 'data_missing',
          book,
          itc_eligible: 0,
          itc_blocked: book.tax_amount,
          review_status: 'NEEDS_CA_REVIEW',
          mismatch_reason: 'Vendor has no GSTIN recorded in purchase books. Cannot reconcile against GSTR-2B until GSTIN is provided.',
        });
      } else {
        // Regular domestic supplier missing from portal
        rows.push({
          status: 'missing_portal',
          book,
          itc_eligible: 0,
          itc_blocked: book.tax_amount,
          review_status: 'NEEDS_CA_REVIEW',
          mismatch_reason: 'Invoice not found in GSTN GSTR-2B. Supplier may not have filed GSTR-1 — ITC blocked for this tax period.',
        });
      }
    }
  }

  // ─── STEP 5: Aggregation of Summary Metrics (Integer-Paise Math) ───────────
  const matchedCount = rows.filter((r) => r.status === 'matched').length;
  const probableCount = rows.filter((r) => r.status === 'probable_match').length;
  const mismatchedCount = rows.filter((r) => r.status === 'mismatched').length;
  const dataMissingCount = rows.filter((r) => r.status === 'data_missing').length;
  const notExpectedCount = rows.filter((r) => r.status === 'not_expected_in_2b').length;
  const missingPortalCount = rows.filter((r) => r.status === 'missing_portal').length;
  const missingBooksCount = rows.filter((r) => r.status === 'missing_books').length;

  let totalEligiblePaise = 0;
  let totalBlockedPaise = 0;
  let totalMismatchRiskPaise = 0;

  for (const r of rows) {
    totalEligiblePaise += toPaise(r.itc_eligible);
    totalBlockedPaise += toPaise(r.itc_blocked);
    if (r.status === 'mismatched') {
      totalMismatchRiskPaise += toPaise(r.itc_blocked);
    }
  }

  const summary: ITCSummary = {
    period,
    total_portal_entries: portalEntries.length,
    total_book_entries: bookEntries.length,
    matched: matchedCount,
    probable_match: probableCount,
    mismatched: mismatchedCount,
    data_missing: dataMissingCount,
    not_expected_in_2b: notExpectedCount,
    missing_portal: missingPortalCount,
    missing_books: missingBooksCount,
    total_itc_eligible: fromPaise(totalEligiblePaise),
    total_itc_blocked: fromPaise(totalBlockedPaise),
    total_itc_mismatch_risk: fromPaise(totalMismatchRiskPaise),
    net_itc_position: fromPaise(totalEligiblePaise - totalBlockedPaise),
  };

  return { rows, summary };
}
