/**
 * Statutory TDS Rules & Tax Period Engine
 *
 * Implements versioned statutory tax regimes:
 *  1. Income-tax Act, 1961 (for payments prior to 2026-04-01):
 *     - Section 194C: Contractors / sub-contracts
 *     - Section 194J(a): Fees for Technical Services (FTS), IT call centers
 *     - Section 194J(b): Fees for Professional Services / Royalty
 *     - Section 194I: Rent for Land, Building, or Furniture
 *     - Section 194H: Commission or Brokerage (5% pre-Oct 2024; 2% post-Oct 2024 per Finance Act 2024)
 *     - Section 194Q: Purchase of goods
 *  2. Income-tax Act, 2025 (for payments on or after 2026-04-01):
 *     - Section 393 framework with tabular payment provisions.
 *     - Drafted with primary citations; must be approved by CA before calculation/sign-off.
 *
 * Note: Statutory thresholds and review trails are dynamically maintained in the database.
 * No threshold values live in code or comments.
 *
 * Statutory Form Names are configuration-driven rather than hardcoded strings.
 */

import crypto from 'crypto';

export type LegalRegime = 'IT_ACT_1961' | 'IT_ACT_2025';

export interface StatutoryTdsRule {
  id: string;
  regime: LegalRegime;
  section?: string | null;           // E.g., '194C', '194J(a)', '194J(b)'
  paymentCode?: string | null;       // Form 26Q / 2025 Act payment code
  description: string;
  effectiveFrom: string;      // YYYY-MM-DD
  effectiveTo?: string | null;       // YYYY-MM-DD (undefined if currently in force)
  rate?: number | null;              // Percentage (e.g., 2.0 for 2%) — null if unverified
  thresholdSingle?: number | null;   // Single transaction threshold in INR (loaded from DB)
  thresholdAggregate?: number | null;// Annual aggregate threshold in INR (loaded from DB)
  thresholdNotApplicable?: boolean;  // Explicit flag if threshold is not applicable
  sourceCitation?: string | null;    // Primary statute/circular citation
  reviewedBy?: string | null;        // CA reviewer identity
  reviewedAt?: string | null;        // Timestamp of review
  status: 'draft' | 'approved' | 'SUPERSEDED' | 'NEEDS_CA_REVIEW' | 'ACTIVE';
  notes?: string | null;
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
 * Versioned Statutory TDS Rules Baseline Fallback
 * (Threshold values are stored strictly in the database table statutory_tds_rules)
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
    sourceCitation: 'Income-tax Act, 1961, Section 194C(5)',
    reviewedBy: null,
    reviewedAt: null,
    status: 'draft',
    notes: 'Standard 2% for corporate/firm contractors.',
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
    sourceCitation: 'Income-tax Act, 1961, Section 194J(1) first proviso as amended by Finance Act, 2020',
    reviewedBy: null,
    reviewedAt: null,
    status: 'draft',
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
    sourceCitation: 'Income-tax Act, 1961, Section 194J(1) first proviso',
    reviewedBy: null,
    reviewedAt: null,
    status: 'draft',
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
    sourceCitation: 'Income-tax Act, 1961, Section 194I first proviso',
    reviewedBy: null,
    reviewedAt: null,
    status: 'draft',
    notes: '10% on land/building/furniture rent.',
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
    sourceCitation: 'Income-tax Act, 1961, Section 194H first proviso prior to Finance (No. 2) Act, 2024',
    reviewedBy: null,
    reviewedAt: null,
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
    sourceCitation: 'Finance (No. 2) Act, 2024, Section 67 amending Section 194H rate to 2% w.e.f. 2024-10-01',
    reviewedBy: null,
    reviewedAt: null,
    status: 'draft',
    notes: 'Finance Act 2024 reduced rate to 2% w.e.f. October 1, 2024.',
  },
  {
    id: 'rule-1961-194q',
    regime: 'IT_ACT_1961',
    section: '194Q',
    paymentCode: '94Q',
    description: 'Payment on Purchase of Goods',
    effectiveFrom: '2021-07-01',
    effectiveTo: '2026-03-31',
    rate: 0.1,
    sourceCitation: 'Income-tax Act, 1961, Section 194Q(1) inserted by Finance Act, 2021',
    reviewedBy: null,
    reviewedAt: null,
    status: 'draft',
    notes: '0.1% TDS on purchase value exceeding statutory aggregate threshold in financial year.',
  },

  // ─── Income-tax Act, 2025 (Effective from 2026-04-01) ───────────────────────
  {
    id: 'rule-2025-sec393-framework',
    regime: 'IT_ACT_2025',
    section: undefined,
    paymentCode: undefined,
    description: 'Income-tax Act 2025 Section 393 Withholding Framework',
    effectiveFrom: '2026-04-01',
    effectiveTo: undefined,
    rate: undefined,
    sourceCitation: null,
    reviewedBy: null,
    reviewedAt: null,
    status: 'draft',
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
 * Normalizes section queries for fuzzy/historical lookup
 */
function normalizeSectionStr(sec: string): string {
  return sec.trim().toLowerCase().replace(/\s+/g, '');
}

/**
 * Looks up the applicable statutory TDS rule based on section and payment date.
 * If a database rulesList is provided, it prioritizes DB records.
 */
export function lookupStatutoryRule(
  section: string | undefined | null,
  paymentDate: string,
  rulesList?: StatutoryTdsRule[]
): StatutoryTdsRule | null {
  const regime = getLegalRegimeForDate(paymentDate);
  const candidateRules = rulesList || STATUTORY_TDS_RULES;

  if (regime === 'IT_ACT_2025') {
    if (!section) {
      return candidateRules.find((r) => r.regime === 'IT_ACT_2025') || null;
    }

    const normSec = normalizeSectionStr(section);

    // Check direct section match or mapped old section in notes/description
    const matched2025 = candidateRules.find((r) => {
      if (r.regime !== 'IT_ACT_2025') return false;
      if (r.section && normalizeSectionStr(r.section) === normSec) return true;
      if (r.notes && normalizeSectionStr(r.notes).includes(normSec)) return true;
      if (r.description && normalizeSectionStr(r.description).includes(normSec)) return true;
      return false;
    });

    if (matched2025) return matched2025;

    // Return the general 2025 framework draft rule as fallback
    return candidateRules.find((r) => r.regime === 'IT_ACT_2025') || null;
  }

  if (!section) return null;

  const normalizedSec = section.trim();

  // Match 1961 Act rule by section and date window
  const matches = candidateRules.filter(
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
      candidateRules.find(
        (r) => r.section === '194J(b)' && r.regime === 'IT_ACT_1961' && paymentDate >= r.effectiveFrom && (!r.effectiveTo || paymentDate <= r.effectiveTo)
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

/**
 * Computes a deterministic SHA-256 hash representing the substantive statutory content of a rule.
 * Canonicalizes numbers (e.g. 2 vs 2.0 -> "2.0000"), trims strings, and unifies nulls/undefined.
 */
export function computeRuleContentHash(rule: {
  regime?: string | null;
  legal_regime?: string | null;
  section?: string | null;
  sub_section?: string | null;
  paymentCode?: string | null;
  payment_code?: string | null;
  rate?: number | string | null;
  rate_percent?: number | string | null;
  thresholdSingle?: number | string | null;
  single_transaction_threshold?: number | string | null;
  thresholdAggregate?: number | string | null;
  aggregate_annual_threshold?: number | string | null;
  thresholdNotApplicable?: boolean | null;
  threshold_not_applicable?: boolean | null;
  effectiveFrom?: string | Date | null;
  effective_from?: string | Date | null;
  effectiveTo?: string | Date | null;
  effective_to?: string | Date | null;
}): string {
  const regime = (rule.regime || rule.legal_regime || '').trim().toUpperCase();
  const sec = (rule.section || '').trim().toUpperCase() || 'NULL';
  const subSec = (rule.sub_section || '').trim().toUpperCase() || 'NULL';
  const payCode = (rule.paymentCode || rule.payment_code || '').trim().toUpperCase() || 'NULL';

  const rawRate = rule.rate !== undefined ? rule.rate : rule.rate_percent;
  const canonicalRate = rawRate !== null && rawRate !== undefined && rawRate !== ''
    ? Number(rawRate).toFixed(4)
    : 'NULL';

  const rawSingle = rule.thresholdSingle !== undefined ? rule.thresholdSingle : rule.single_transaction_threshold;
  const canonicalSingle = rawSingle !== null && rawSingle !== undefined && rawSingle !== ''
    ? Number(rawSingle).toFixed(4)
    : 'NULL';

  const rawAgg = rule.thresholdAggregate !== undefined ? rule.thresholdAggregate : rule.aggregate_annual_threshold;
  const canonicalAgg = rawAgg !== null && rawAgg !== undefined && rawAgg !== ''
    ? Number(rawAgg).toFixed(4)
    : 'NULL';

  const rawThreshNA = rule.thresholdNotApplicable !== undefined ? rule.thresholdNotApplicable : rule.threshold_not_applicable;
  const canonicalThreshNA = Boolean(rawThreshNA).toString();

  const rawEff = rule.effectiveFrom || rule.effective_from;
  let canonicalEff = 'NULL';
  if (rawEff) {
    canonicalEff = (rawEff instanceof Date ? rawEff.toISOString() : String(rawEff)).slice(0, 10);
  }

  const rawEffTo = rule.effectiveTo || rule.effective_to;
  let canonicalEffTo = 'NULL';
  if (rawEffTo) {
    canonicalEffTo = (rawEffTo instanceof Date ? rawEffTo.toISOString() : String(rawEffTo)).slice(0, 10);
  }

  const canonicalString = `${regime}|${sec}|${subSec}|${payCode}|${canonicalRate}|${canonicalSingle}|${canonicalAgg}|${canonicalThreshNA}|${canonicalEff}|${canonicalEffTo}`;
  return crypto.createHash('sha256').update(canonicalString).digest('hex');
}


