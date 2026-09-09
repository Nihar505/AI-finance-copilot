/**
 * Deterministic Financial and Currency Calculation Engine for Indian Statutory Compliance.
 * 
 * Rules:
 * 1. Financial calculations must NEVER rely on LLM floating-point guesses.
 * 2. All monetary calculations are performed with exact 2-decimal banker's precision or integer paisa.
 * 3. Handles GST (CGST/SGST vs IGST) and TDS statutory tax deduction schedules deterministically.
 */

export interface GstBreakdown {
  taxableValue: number;
  rate: number; // e.g., 18 for 18%
  isInterState: boolean;
  cgst: number;
  sgst: number;
  igst: number;
  totalTax: number;
  totalAmount: number;
}

export interface TdsCalculation {
  section: '194C' | '194J' | '194I' | '194Q' | '194H';
  grossAmount: number;
  applicableRate: number; // percentage
  tdsAmount: number;
  netPayable: number;
  isPenalRateApplied: boolean; // Section 206AA: 20% if PAN missing/invalid
  reasoning: string;
}

/**
 * Rounds a floating point currency value strictly to 2 decimal places.
 * Uses Number.EPSILON to eliminate IEEE 754 floating point arithmetic drift.
 */
export function roundCurrency(val: number): number {
  if (typeof val !== 'number' || isNaN(val) || !isFinite(val)) {
    return 0.00;
  }
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

/**
 * Converts INR rupees to integer paisa (prevents float inaccuracies in additions).
 */
export function toPaisa(rupees: number): number {
  return Math.round(roundCurrency(rupees) * 100);
}

/**
 * Converts integer paisa back to INR rupees.
 */
export function fromPaisa(paisa: number): number {
  return roundCurrency(paisa / 100);
}

/**
 * Validates a positive financial amount.
 * Rejects negative numbers, NaN, non-finite numbers, and excessive values (> ₹100 Crore).
 */
export function validateFinancialAmount(val: any): { valid: boolean; amount: number; error?: string } {
  if (val === null || val === undefined || val === '') {
    return { valid: false, amount: 0, error: 'Amount is required' };
  }
  const num = Number(val);
  if (isNaN(num) || !isFinite(num)) {
    return { valid: false, amount: 0, error: 'Amount must be a valid numeric value' };
  }
  if (num < 0) {
    return { valid: false, amount: 0, error: 'Financial amount cannot be negative. Use credit/debit transaction type instead.' };
  }
  const MAX_PERMISSIBLE = 1_000_000_000.00; // ₹100 Crores
  if (num > MAX_PERMISSIBLE) {
    return { valid: false, amount: 0, error: `Amount exceeds maximum permissible limit of ₹100 Crores` };
  }
  return { valid: true, amount: roundCurrency(num) };
}

/**
 * Deterministic GST Calculator per Indian CBIC rules.
 * Intrastate -> CGST (rate/2) + SGST (rate/2)
 * Interstate -> IGST (full rate)
 */
export function calculateGst(
  taxableValue: number,
  rate: number,
  isInterState: boolean
): GstBreakdown {
  const cleanTaxable = Math.max(0, roundCurrency(taxableValue));
  const cleanRate = Math.max(0, rate);

  if (isInterState) {
    const igst = roundCurrency(cleanTaxable * (cleanRate / 100));
    const totalTax = igst;
    const totalAmount = roundCurrency(cleanTaxable + totalTax);
    return {
      taxableValue: cleanTaxable,
      rate: cleanRate,
      isInterState: true,
      cgst: 0,
      sgst: 0,
      igst,
      totalTax,
      totalAmount
    };
  } else {
    const halfRate = cleanRate / 2;
    const cgst = roundCurrency(cleanTaxable * (halfRate / 100));
    const sgst = roundCurrency(cleanTaxable * (halfRate / 100));
    const totalTax = roundCurrency(cgst + sgst);
    const totalAmount = roundCurrency(cleanTaxable + totalTax);
    return {
      taxableValue: cleanTaxable,
      rate: cleanRate,
      isInterState: false,
      cgst,
      sgst,
      igst: 0,
      totalTax,
      totalAmount
    };
  }
}

/**
 * Deterministic TDS Calculation under the Indian Income Tax Act 1961.
 * Applies Section 206AA (mandatory 20% withholding if valid PAN is absent).
 */
export function calculateTds(
  grossAmount: number,
  section: '194C' | '194J' | '194I' | '194Q' | '194H',
  hasValidPan: boolean,
  isCompanyOrLLP: boolean = true
): TdsCalculation {
  const cleanGross = Math.max(0, roundCurrency(grossAmount));

  // Section 206AA Check: If valid PAN is missing, minimum rate is 20%
  if (!hasValidPan) {
    const penalRate = 20.0;
    const tdsAmount = roundCurrency(cleanGross * (penalRate / 100));
    return {
      section,
      grossAmount: cleanGross,
      applicableRate: penalRate,
      tdsAmount,
      netPayable: roundCurrency(cleanGross - tdsAmount),
      isPenalRateApplied: true,
      reasoning: `Section 206AA Penal Withholding applied at 20.0% due to invalid or missing PAN.`
    };
  }

  // Standard statutory rates under IT Act
  let rate = 10.0;
  let desc = '';

  switch (section) {
    case '194C':
      // 1% for individual/HUF, 2% for others
      rate = isCompanyOrLLP ? 2.0 : 1.0;
      desc = `Section 194C Payments to Contractors (${rate}%)`;
      break;
    case '194J':
      // 10% for professional services / royalty, 2% for technical services / call centers
      rate = isCompanyOrLLP ? 2.0 : 10.0;
      desc = `Section 194J Fees for Professional / Technical Services (${rate}%)`;
      break;
    case '194I':
      // 10% for land/building/furniture, 2% for plant & machinery
      rate = 10.0;
      desc = `Section 194I Rent for Land/Building/Office (${rate}%)`;
      break;
    case '194Q':
      // 0.1% on purchase of goods exceeding ₹50 Lakhs
      rate = 0.1;
      desc = `Section 194Q Purchase of Goods (> ₹50 Lakhs) (0.1%)`;
      break;
    case '194H':
      // 5% on Commission or Brokerage
      rate = 5.0;
      desc = `Section 194H Commission or Brokerage (5%)`;
      break;
    default:
      rate = 10.0;
      desc = `Standard TDS Rate (10%)`;
  }

  const tdsAmount = roundCurrency(cleanGross * (rate / 100));
  const netPayable = roundCurrency(cleanGross - tdsAmount);

  return {
    section,
    grossAmount: cleanGross,
    applicableRate: rate,
    tdsAmount,
    netPayable,
    isPenalRateApplied: false,
    reasoning: desc
  };
}

/**
 * Indian Rupee (INR) currency formatter with standard Lakhs and Crores grouping.
 */
export function formatINR(amount: number): string {
  const rounded = roundCurrency(amount);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(rounded);
}
