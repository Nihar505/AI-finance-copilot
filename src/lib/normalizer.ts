import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { isValidDate } from './security';

export interface NormalizedTransaction {
  date: string; // YYYY-MM-DD
  description: string;
  raw_description: string;
  amount: number;
  type: 'credit' | 'debit';
  counterparty: string;
  reference_number?: string;
}

export interface NormalizedInvoice {
  invoice_number: string;
  customer_name: string;
  date: string;
  due_date?: string;
  total_amount: number;
  tax_amount?: number;
}

export interface NormalizedBill {
  bill_number: string;
  vendor_name: string;
  date: string;
  due_date?: string;
  total_amount: number;
  tax_amount?: number;
}

/**
 * Sanitizes input text against CSV / Excel formula injection (DDE / Command Execution).
 * Neutralizes leading =, +, -, @, \t, \r characters.
 */
export function sanitizeFormulaInjection(field: string | null | undefined): string {
  if (!field || typeof field !== 'string') return '';
  const trimmed = field.trim();
  if (/^[=+\-@\t\r%]/.test(trimmed)) {
    return `'${trimmed}`;
  }
  return trimmed;
}

// Clean date helper to YYYY-MM-DD with strict calendar validation
export function normalizeDate(rawDate: string | Date | number | undefined): string {
  if (rawDate === undefined || rawDate === null || rawDate === '') {
    return new Date().toISOString().split('T')[0];
  }

  let candidate: string | null = null;

  if (typeof rawDate === 'number') {
    // Excel serial date format
    const dateObj = new Date((rawDate - (25567 + 2)) * 86400 * 1000);
    if (!isNaN(dateObj.getTime())) {
      candidate = dateObj.toISOString().split('T')[0];
    }
  } else {
    const str = String(rawDate).trim();
    // Check ISO format YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
      candidate = str.substring(0, 10);
    } else {
      // Check DD/MM/YYYY or DD-MM-YYYY
      const ddmmyyyy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
      if (ddmmyyyy) {
        const day = ddmmyyyy[1].padStart(2, '0');
        const month = ddmmyyyy[2].padStart(2, '0');
        const year = ddmmyyyy[3];
        candidate = `${year}-${month}-${day}`;
      } else {
        // Check MM/DD/YYYY or other standard Date parse
        const parsed = new Date(str);
        if (!isNaN(parsed.getTime())) {
          candidate = parsed.toISOString().split('T')[0];
        }
      }
    }
  }

  if (candidate && isValidDate(candidate)) {
    return candidate;
  }

  // Reject impossible or invalid calendar dates (e.g. 2024-02-31, 2023-02-29, 2024-04-31)
  throw new Error(`Invalid or impossible date rejected: "${rawDate}". Valid calendar date required.`);
}

// Clean amount helper
export function normalizeAmount(raw: any): number {
  if (typeof raw === 'number') return Math.abs(raw);
  if (!raw) return 0;
  const cleaned = String(raw).replace(/[^0-9.-]+/g, '');
  const val = parseFloat(cleaned);
  return isNaN(val) ? 0 : Math.abs(val);
}

// Extract counterparty from raw bank narration
export function extractCounterparty(description: string): string {
  if (!description) return '';
  let cleaned = description.trim();

  // Remove common banking prefixes (space/dash/underscore/colon delimited)
  cleaned = cleaned.replace(/^(neft|rtgs|imps|ach|pos|card|upi|cms|chq|inb|bil|transfer)[\s\-_:]+/i, '');
  cleaned = cleaned.replace(/^(cr|db|dr)[\s\-_:]+/i, '');

  // Remove slash-delimited prefix codes: CMS/XXXX, INB/XXXX, BIL/XXXX, POS/XXXX, ACH/XXXX
  // Pattern: 2-4 uppercase letters followed by '/' → skip that segment
  cleaned = cleaned.replace(/^[A-Z]{2,5}\/(?=[A-Z])/i, '');

  // Split on common delimiters like '/' or '-'
  const parts = cleaned.split(/[\/]/);
  if (parts.length > 1 && parts[0].trim().length >= 3) {
    return parts[0].trim();
  }
  // For dash-delimited, only return first segment if subsequent parts look like refs
  const dashParts = cleaned.split('-');
  if (dashParts.length > 1 && /^\d+$/.test(dashParts[dashParts.length - 1])) {
    return dashParts.slice(0, -1).join('-').trim().substring(0, 60);
  }
  return cleaned.substring(0, 60).trim();
}

// Parse Bank Statement CSV/Excel text or buffer
export function parseBankStatement(fileBuffer: Buffer | string, filename: string): NormalizedTransaction[] {
  let rows: any[] = [];

  if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) {
    const workbook = XLSX.read(fileBuffer, { type: typeof fileBuffer === 'string' ? 'string' : 'buffer' });
    const sheetName = workbook.SheetNames[0];
    rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
  } else {
    const text = typeof fileBuffer === 'string' ? fileBuffer : fileBuffer.toString('utf8');
    const result = Papa.parse(text, { header: true, skipEmptyLines: true });
    rows = result.data as any[];
  }

  const results: NormalizedTransaction[] = [];

  for (const row of rows) {
    // Find keys regardless of case
    const keys = Object.keys(row);
    const findKey = (patterns: string[]) => keys.find(k => patterns.some(p => k.toLowerCase().includes(p.toLowerCase())));

    const dateKey = findKey(['date', 'txn date', 'transaction date', 'value date']);
    const descKey = findKey(['desc', 'narration', 'particulars', 'detail', 'remarks']);
    const debitKey = findKey(['debit', 'withdrawal', 'dr', 'out']);
    const creditKey = findKey(['credit', 'deposit', 'cr', 'in']);
    const amountKey = findKey(['amount', 'txn amount', 'net']);
    const refKey = findKey(['ref', 'reference', 'chq', 'utr', 'txn id']);
    const counterpartyKey = findKey(['counterparty', 'beneficiary', 'party', 'merchant', 'vendor', 'customer']);

    let date: string;
    try {
      date = normalizeDate(dateKey ? row[dateKey] : undefined);
    } catch {
      continue;
    }

    const rawDesc = sanitizeFormulaInjection(descKey ? String(row[descKey]).trim() : 'Transaction');
    const ref = refKey ? sanitizeFormulaInjection(String(row[refKey]).trim()) : undefined;

    let amount = 0;
    let type: 'credit' | 'debit' = 'debit';

    if (creditKey && row[creditKey] && normalizeAmount(row[creditKey]) > 0) {
      amount = normalizeAmount(row[creditKey]);
      type = 'credit';
    } else if (debitKey && row[debitKey] && normalizeAmount(row[debitKey]) > 0) {
      amount = normalizeAmount(row[debitKey]);
      type = 'debit';
    } else if (amountKey && row[amountKey]) {
      const rawVal = String(row[amountKey]);
      amount = normalizeAmount(rawVal);
      if (rawVal.includes('-') || (debitKey && String(row[debitKey]).toLowerCase() === 'debit')) {
        type = 'debit';
      } else {
        type = 'credit';
      }
    }

    if (amount <= 0) continue;

    const counterparty = counterpartyKey && row[counterpartyKey]
      ? sanitizeFormulaInjection(String(row[counterpartyKey]).trim())
      : sanitizeFormulaInjection(extractCounterparty(rawDesc));

    results.push({
      date,
      description: rawDesc,
      raw_description: rawDesc,
      amount,
      type,
      counterparty,
      reference_number: ref
    });
  }

  return results;
}

// Parse Sales Invoices CSV/Excel
export function parseSalesInvoices(fileBuffer: Buffer | string, filename: string): NormalizedInvoice[] {
  let rows: any[] = [];

  if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) {
    const workbook = XLSX.read(fileBuffer, { type: typeof fileBuffer === 'string' ? 'string' : 'buffer' });
    const sheetName = workbook.SheetNames[0];
    rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
  } else {
    const text = typeof fileBuffer === 'string' ? fileBuffer : fileBuffer.toString('utf8');
    const result = Papa.parse(text, { header: true, skipEmptyLines: true });
    rows = result.data as any[];
  }

  const results: NormalizedInvoice[] = [];

  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx];
    const keys = Object.keys(row);
    const findKey = (patterns: string[]) => keys.find(k => patterns.some(p => k.toLowerCase().includes(p.toLowerCase())));

    const numKey = findKey(['invoice', 'inv', 'bill no', 'number']);
    const custKey = findKey(['customer', 'client', 'party', 'name', 'billed to']);
    const dateKey = findKey(['date', 'inv date', 'issue']);
    const dueKey = findKey(['due', 'expiry', 'payment due']);
    const totalKey = findKey(['total', 'amount', 'net', 'invoice value']);
    const taxKey = findKey(['tax', 'gst', 'vat']);

    let date: string;
    let due_date: string | undefined;
    try {
      date = normalizeDate(dateKey ? row[dateKey] : undefined);
      due_date = dueKey && row[dueKey] ? normalizeDate(row[dueKey]) : undefined;
    } catch {
      continue;
    }

    const total_amount = totalKey ? normalizeAmount(row[totalKey]) : 0;
    if (total_amount <= 0) continue;

    const invoice_number = sanitizeFormulaInjection(numKey ? String(row[numKey]).trim() : `INV-${idx + 100}`);
    const customer_name = sanitizeFormulaInjection(custKey ? String(row[custKey]).trim() : 'Customer');
    const tax_amount = taxKey ? normalizeAmount(row[taxKey]) : 0;

    results.push({
      invoice_number,
      customer_name,
      date,
      due_date,
      total_amount,
      tax_amount
    });
  }

  return results;
}

// Parse Vendor Bills CSV/Excel
export function parseVendorBills(fileBuffer: Buffer | string, filename: string): NormalizedBill[] {
  let rows: any[] = [];

  if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) {
    const workbook = XLSX.read(fileBuffer, { type: typeof fileBuffer === 'string' ? 'string' : 'buffer' });
    const sheetName = workbook.SheetNames[0];
    rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
  } else {
    const text = typeof fileBuffer === 'string' ? fileBuffer : fileBuffer.toString('utf8');
    const result = Papa.parse(text, { header: true, skipEmptyLines: true });
    rows = result.data as any[];
  }

  const results: NormalizedBill[] = [];

  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx];
    const keys = Object.keys(row);
    const findKey = (patterns: string[]) => keys.find(k => patterns.some(p => k.toLowerCase().includes(p.toLowerCase())));

    const numKey = findKey(['bill', 'inv', 'reference', 'number', 'ref']);
    const venKey = findKey(['vendor', 'supplier', 'payee', 'name']);
    const dateKey = findKey(['date', 'bill date', 'issue']);
    const dueKey = findKey(['due', 'payment due']);
    const totalKey = findKey(['total', 'amount', 'net', 'cost']);
    const taxKey = findKey(['tax', 'gst', 'vat']);

    let date: string;
    let due_date: string | undefined;
    try {
      date = normalizeDate(dateKey ? row[dateKey] : undefined);
      due_date = dueKey && row[dueKey] ? normalizeDate(row[dueKey]) : undefined;
    } catch {
      continue;
    }

    const total_amount = totalKey ? normalizeAmount(row[totalKey]) : 0;
    if (total_amount <= 0) continue;

    const bill_number = sanitizeFormulaInjection(numKey ? String(row[numKey]).trim() : `BILL-${idx + 200}`);
    const vendor_name = sanitizeFormulaInjection(venKey ? String(row[venKey]).trim() : 'Vendor');
    const tax_amount = taxKey ? normalizeAmount(row[taxKey]) : 0;

    results.push({
      bill_number,
      vendor_name,
      date,
      due_date,
      total_amount,
      tax_amount
    });
  }

  return results;
}


