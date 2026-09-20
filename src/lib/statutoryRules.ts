/**
 * Statutory TDS Rules & Tax Period Engine
 *
 * Implements versioned statutory tax regimes:
 *  1. Income-tax Act, 1961 (for payments prior to 2026-04-01):
 *     - Section 194C: 2.0% (contracts / sub-contracts), threshold single ₹30,000, aggregate ₹1,00,000
 *     - Section 194J(a): 2.0% (Fees for Technical Services / FTS, IT call centers), threshold ₹30,000
 *     - Section 194J(b): 10.0% (Fees for Professional Services / Royalty), threshold ₹30,000
 *     - Section 194I: 10.0% (Rent for Land, Building, or Furniture), threshold ₹2,40,000
 *     - Section 194H: 5.0% prior to 2024-10-01; 2.0% on or after 2024-10-01 (Finance Act, 2024), threshold ₹15,000
 *     - Section 194Q: 0.1% (Purchase of goods exceeding ₹50 Lakhs), threshold ₹50,00,000
 *  2. Income-tax Act, 2025 (for payments on or after 2026-04-01):
 *     - Section 393 framework with updated statutory section references and payment codes.
 *     - Marked NEEDS_CA_REVIEW with empty section/code fields until verified by a Chartered Accountant.
 *     - UI surfaces "mapping pending" for post-2026-04-01 payments.
 *
 * Statutory Form Names are configuration-driven rather than hardcoded strings.
 */

export type LegalRegime = 'IT_ACT_1961' | 'IT_ACT_2025';

export interface StatutoryTdsRule {
  id: string;
  regime: LegalRegime;
  section?: string;           // E.g., '194C', '194J(a)', '194J(b)' — empty for 2025 Act until CA review
  paymentCode?: string;       // Form 26Q / 2025 Act payment code — empty for 2025 Act until CA review
  description: string;
  effectiveFrom: string;      // YYYY-MM-DD
  effectiveTo?: string;        // YYYY-MM-DD (undefined if currently in force)
  rate?: number;              // Percentage (e.g., 2.0 for 2%) — undefined if NEEDS_CA_REVIEW
  thresholdSingle?: number;   // Single transaction threshold in INR
  thresholdAggregate?: number;// Annual aggregate threshold in INR
  status: 'ACTIVE' | 'SUPERSEDED' | 'NEEDS_CA_REVIEW';
  notes?: string;
}

/**
 * Configuration-driven statutory form and worksheet labels
 */
export const STATUTORY_FORM_CONFIG = {
  tdsCertificateLabel: 'TDS Deduction Certificate',
  tracesCertificateLabel: 'TRACES Form 16A',
  quarterlyReturnLabel: 'Form 26Q Quarterly Return',
  preparationWorksheetTitle: 'TDS Deduction Register / 26Q Preparation Worksheet',
  challanFormLabel: 'Challan ITNS 281',
};

/**
 * Versioned Statutory TDS Rules Table
 */
export const STATUTORY_TDS_RULES: StatutoryTdsRule[] = [
  // ─── Income-tax Act, 1961 ────────────────────────────────────────────────
  {
    id: 'rule-1961-194c',
    regime: 'IT_ACT_1961',
    section: '194C',
    paymentCode: '94C',
    description: 'Payments to Contractors and Sub-contractors',
    effectiveFrom: '1961-04-01',
    effectiveTo: '2026-03-31',
    rate: 2.0,
    thresholdSingle: 30000,
    thresholdAggregate: 100000,
    status: 'ACTIVE',
    notes: 'Standard 2% for corporate/firm contractors (1% for individual/HUF).',
  },
  {
    id: 'rule-1961-194ja',
    regime: 'IT_ACT_1961',
    section: '194J(a)',
    paymentCode: '94J',
    description: 'Fees for Technical Services (FTS) and IT Call Centers',
    effectiveFrom: '2020-04-01',
    effectiveTo: '2026-03-31',
    rate: 2.0,
    thresholdSingle: 30000,
    thresholdAggregate: 30000,
    status: 'ACTIVE',
    notes: 'Finance Act 2020 reduced FTS rate to 2% regardless of deductee constitution.',
  },
  {
    id: 'rule-1961-194jb',
    regime: 'IT_ACT_1961',
    section: '194J(b)',
    paymentCode: '94J',
    description: 'Fees for Professional Services and Royalty',
    effectiveFrom: '1995-07-01',
    effectiveTo: '2026-03-31',
    rate: 10.0,
    thresholdSingle: 30000,
    thresholdAggregate: 30000,
    status: 'ACTIVE',
    notes: 'Standard 10% rate for legal, accounting, medical, engineering, and architectural services.',
  },
  {
    id: 'rule-1961-194i',
    regime: 'IT_ACT_1961',
    section: '194I',
    paymentCode: '94I',
    description: 'Rent for Land, Building, or Furniture',
    effectiveFrom: '1994-06-01',
    effectiveTo: '2026-03-31',
    rate: 10.0,
    thresholdSingle: 240000,
    thresholdAggregate: 240000,
    status: 'ACTIVE',
    notes: '10% on land/building/furniture rent (2% on plant & machinery).',
  },
  {
    id: 'rule-1961-194h-pre2024',
    regime: 'IT_ACT_1961',
    section: '194H',
    paymentCode: '94H',
    description: 'Commission or Brokerage (Pre-Finance Act 2024)',
    effectiveFrom: '2001-06-01',
    effectiveTo: '2024-09-30',
    rate: 5.0,
    thresholdSingle: 15000,
    thresholdAggregate: 15000,
    status: 'SUPERSEDED',
    notes: 'Historical 5% statutory rate in force until 2024-09-30.',
  },
  {
    id: 'rule-1961-194h-post2024',
    regime: 'IT_ACT_1961',
    section: '194H',
    paymentCode: '94H',
    description: 'Commission or Brokerage (Post-Finance Act 2024)',
    effectiveFrom: '2024-10-01',
    effectiveTo: '2026-03-31',
    rate: 2.0,
    thresholdSingle: 15000,
    thresholdAggregate: 15000,
    status: 'ACTIVE',
    notes: 'Finance Act 2024 reduced rate to 2% w.e.f. October 1, 2024.',
  },
  {
    id: 'rule-1961-194q',
    regime: 'IT_ACT_1961',
    section: '194Q',
    paymentCode: '94Q',
    description: 'Payment on Purchase of Goods (> ₹50L aggregate)',
    effectiveFrom: '2021-07-01',
    effectiveTo: '2026-03-31',
    rate: 0.1,
    thresholdSingle: 5000000,
    thresholdAggregate: 5000000,
    status: 'ACTIVE',
    notes: '0.1% TDS on purchase value exceeding ₹50 Lakhs in financial year.',
  },

  // ─── Income-tax Act, 2025 (Effective from 2026-04-01) ───────────────────────
  {
    id: 'rule-2025-sec393-framework',
    regime: 'IT_ACT_2025',
    section: undefined,      // Left empty as mandated; do NOT guess from memory
    paymentCode: undefined,  // Left empty as mandated
    description: 'Income-tax Act 2025 Section 393 Withholding Framework',
    effectiveFrom: '2026-04-01',
    effectiveTo: undefined,
    rate: undefined,         // Undefined until CA review
    status: 'NEEDS_CA_REVIEW',
    notes: 'New simplified withholding framework under Section 393 of the Income-tax Act 2025. Statutory mapping pending CA review.',
  },
];

/**
 * Determines whether a given payment date falls under the 1961 Act or 2025 Act.
 */
export function getLegalRegimeForDate(paymentDate: string): LegalRegime {
  if (paymentDate >= '2026-04-01') {
    return 'IT_ACT_2025';
  }
  return 'IT_ACT_1961';
}

/**
 * Looks up the applicable statutory TDS rule based on section and payment date.
 */
export function lookupStatutoryRule(
  section: string | undefined | null,
  paymentDate: string
): StatutoryTdsRule | null {
  const regime = getLegalRegimeForDate(paymentDate);

  if (regime === 'IT_ACT_2025') {
    // 2025 Act regime: return the pending CA review placeholder
    return STATUTORY_TDS_RULES.find((r) => r.regime === 'IT_ACT_2025') || null;
  }

  if (!section) return null;

  const normalizedSec = section.trim();

  // Match 1961 Act rule by section and date window
  const matches = STATUTORY_TDS_RULES.filter(
    (r) =>
      r.regime === 'IT_ACT_1961' &&
      r.section === normalizedSec &&
      paymentDate >= r.effectiveFrom &&
      (!r.effectiveTo || paymentDate <= r.effectiveTo)
  );

  if (matches.length > 0) {
    return matches[0];
  }

  // Fallback if section is generic '194J'
  if (normalizedSec === '194J') {
    return (
      STATUTORY_TDS_RULES.find(
        (r) => r.section === '194J(b)' && r.regime === 'IT_ACT_1961'
      ) || null
    );
  }

  return null;
}

export interface TaxPeriodInfo {
  quarter: 'Q1' | 'Q2' | 'Q3' | 'Q4';
  financialYear: string;   // E.g., '2024-25', '2026-27'
  legalRegime: LegalRegime;
  periodType: 'Tax Year' | 'Financial Year';
  periodLabel: string;     // E.g., 'Tax Year 2026-27 (Q2)' or 'Financial Year 2024-25 (Q3)'
  isNewRegime: boolean;
  startDate: string;       // YYYY-MM-DD
  endDate: string;         // YYYY-MM-DD
}

/**
 * Derives the current tax year/quarter from today's date (or provided date),
 * labeling periods "Tax Year" where the 2025 Act applies.
 */
export function getCurrentTaxPeriod(date: Date = new Date()): TaxPeriodInfo {
  const month = date.getUTCMonth() + 1; // 1-12
  const year = date.getUTCFullYear();

  let startYear: number;
  let quarter: 'Q1' | 'Q2' | 'Q3' | 'Q4';
  let startDate: string;
  let endDate: string;

  if (month >= 4) {
    startYear = year;
    if (month <= 6) {
      quarter = 'Q1';
      startDate = `${startYear}-04-01`;
      endDate = `${startYear}-06-30`;
    } else if (month <= 9) {
      quarter = 'Q2';
      startDate = `${startYear}-07-01`;
      endDate = `${startYear}-09-30`;
    } else {
      quarter = 'Q3';
      startDate = `${startYear}-10-01`;
      endDate = `${startYear}-12-31`;
    }
  } else {
    startYear = year - 1;
    quarter = 'Q4';
    startDate = `${startYear + 1}-01-01`;
    endDate = `${startYear + 1}-03-31`;
  }

  const endYearShort = String(startYear + 1).slice(-2);
  const financialYear = `${startYear}-${endYearShort}`;
  const isNewRegime = startYear >= 2026;
  const legalRegime: LegalRegime = isNewRegime ? 'IT_ACT_2025' : 'IT_ACT_1961';
  const periodType = isNewRegime ? 'Tax Year' : 'Financial Year';
  const periodLabel = `${periodType} ${financialYear} (${quarter})`;

  return {
    quarter,
    financialYear,
    legalRegime,
    periodType,
    periodLabel,
    isNewRegime,
    startDate,
    endDate,
  };
}

/**
 * Returns date bounds for any given financialYear and quarter
 */
export function getQuarterDateBounds(financialYear: string, quarter: 'Q1' | 'Q2' | 'Q3' | 'Q4') {
  const startYear = parseInt(financialYear.split('-')[0], 10);
  switch (quarter) {
    case 'Q1':
      return { start: `${startYear}-04-01`, end: `${startYear}-06-30` };
    case 'Q2':
      return { start: `${startYear}-07-01`, end: `${startYear}-09-30` };
    case 'Q3':
      return { start: `${startYear}-10-01`, end: `${startYear}-12-31` };
    case 'Q4':
      return { start: `${startYear + 1}-01-01`, end: `${startYear + 1}-03-31` };
  }
}
