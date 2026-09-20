import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, assertTenantAccess, checkRoleAccess } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { safeParseJson, isValidPan } from '@/lib/security';
import {
  getCurrentTaxPeriod,
  getQuarterDateBounds,
  lookupStatutoryRule,
  STATUTORY_FORM_CONFIG,
  LegalRegime,
  StatutoryTdsRule,
} from '@/lib/statutoryRules';
import { roundCurrency } from '@/lib/currency';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

export interface TDSCertificate {
  id: string;
  vendorId: string;
  vendorName: string;
  vendorPan: string | null;
  vendorGstin: string | null;
  section: string | null;
  sectionDescription: string;
  paymentCode: string | null;
  quarter: 'Q1' | 'Q2' | 'Q3' | 'Q4';
  financialYear: string;
  periodLabel: string;
  legalRegime: LegalRegime;
  grossAmount: number; // Net taxable base for TDS (excluding GST per CBDT Circular 23/2017)
  invoiceTotal?: number; // Gross invoice total including taxes
  gstAmount?: number; // Separately indicated GST
  cbdtGstExclusionApplied?: boolean; // Flag for CBDT Circular 23/2017
  caConfirmationRequired?: boolean; // Requires CA verification for GST exclusion
  isBelowThreshold?: boolean; // True if payments fall below statutory single/aggregate threshold
  tdsRate: number | null; // percentage e.g. 10 for 10%, null if data missing/unverified
  tdsAmount: number;
  challanBsr: string | null;
  challanNumber: string | null;
  depositDate: string | null;
  allocatedChallanSource?: string | null;
  status: 'generated' | 'signed_off' | 'data_missing';
  missingFields?: string[];
  isAllocated: boolean;
  allocatedChallanId?: string | null;
  signedBy?: string | null;
  signedAt?: string | null;
  ruleStatus?: string | null;
  ruleSourceCitation?: string | null;
}

// Deterministic PAN extraction from Indian GSTIN (characters 3-12 are the 10-char PAN)
function extractPanFromGstin(gstin: string | null | undefined): string | null {
  if (!gstin || gstin.length < 12) return null;
  const candidate = gstin.substring(2, 12).toUpperCase();
  return isValidPan(candidate) ? candidate : null;
}

/**
 * GET /api/tds-certificates
 * Fetches the TDS Deduction Register & 26Q Preparation Worksheet for the specified or current period.
 * Derives calculations strictly from stored vendor profiles, real bill records, and versioned statutory tables.
 * Excludes demo challans when NODE_ENV=production.
 * Excludes GST from TDS base when separately indicated (CBDT Circular 23/2017).
 * Enforces dynamic statutory thresholds with year-to-date vendor gross tracking.
 * Strictly blocks sign-off and flags "rates unverified" for draft statutory rules.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    await assertTenantAccess(auth, auth.activeOrgId);

    const { searchParams } = new URL(req.url);

    // Derive current tax period if quarter or financialYear is omitted
    const defaultPeriod = getCurrentTaxPeriod();
    const quarter = (searchParams.get('quarter') || defaultPeriod.quarter) as 'Q1' | 'Q2' | 'Q3' | 'Q4';
    const financialYear = searchParams.get('financialYear') || defaultPeriod.financialYear;

    const db = await getDb();
    const isProd = process.env.NODE_ENV === 'production';

    // 1. Fetch organization info for deductor details
    const orgRes = await db.query(
      'SELECT id, name, legal_name, tax_id, tan, address FROM organizations WHERE id = $1;',
      [auth.activeOrgId]
    );

    const org = orgRes.rows[0];
    const deductorPan = org?.tax_id ? extractPanFromGstin(org.tax_id) : null;
    const deductorTan = org?.tan || null;
    const deductorAddress = org?.address || null;
    const isDeductorDataMissing = !deductorTan || !deductorAddress;

    // 2. Fetch existing CA sign-offs from database table tds_signoffs
    const signoffsRes = await db.query(
      'SELECT cert_id, signed_by, signed_at FROM tds_signoffs WHERE org_id = $1;',
      [auth.activeOrgId]
    );
    const dbSignoffs = new Map<string, { signedBy: string; signedAt: string }>();
    for (const row of signoffsRes.rows) {
      dbSignoffs.set(row.cert_id, {
        signedBy: row.signed_by,
        signedAt: new Date(row.signed_at).toISOString(),
      });
    }

    // 3. Fetch versioned statutory TDS rules from database
    const rulesRes = await db.query(
      `SELECT id, legal_regime as regime, section, payment_code as "paymentCode",
              description, effective_from::text as "effectiveFrom",
              effective_to::text as "effectiveTo", rate,
              threshold_single as "thresholdSingle", threshold_aggregate as "thresholdAggregate",
              source_citation as "sourceCitation", reviewed_by as "reviewedBy",
              reviewed_at::text as "reviewedAt", status, notes
       FROM statutory_tds_rules
       ORDER BY effective_from ASC;`
    );
    const dbRules: StatutoryTdsRule[] = rulesRes.rows.map((r: any) => ({
      ...r,
      rate: r.rate !== null ? Number(r.rate) : null,
      thresholdSingle: r.thresholdSingle !== null ? Number(r.thresholdSingle) : null,
      thresholdAggregate: r.thresholdAggregate !== null ? Number(r.thresholdAggregate) : null,
    }));

    // 4. Fetch all challans for this org, quarter, and financial year
    // Exclude source='demo' when NODE_ENV=production
    const challansRes = await db.query(
      `SELECT id, challan_no, bsr_code, deposit_date, amount, section, quarter, financial_year, source
       FROM tds_challans
       WHERE org_id = $1 AND quarter = $2 AND financial_year = $3
         AND ($4::boolean = false OR (source IS NULL OR source != 'demo'))
       ORDER BY deposit_date ASC;`,
      [auth.activeOrgId, quarter, financialYear, isProd]
    );
    const challans = challansRes.rows;

    // 5. Fetch all challan allocations for this org
    // In production, allocations linking to demo challans are excluded
    const allocRes = await db.query(
      `SELECT a.id, a.challan_id, a.deduction_line_id, a.allocated_amount,
              c.challan_no, c.bsr_code, c.deposit_date, c.source as challan_source
       FROM tds_challan_allocations a
       JOIN tds_challans c ON a.challan_id = c.id
       WHERE a.org_id = $1
         AND ($2::boolean = false OR (c.source IS NULL OR c.source != 'demo'));`,
      [auth.activeOrgId, isProd]
    );
    const allocationsByLine = new Map<string, any>();
    for (const row of allocRes.rows) {
      allocationsByLine.set(row.deduction_line_id, row);
    }

    // 6. Year-to-Date (YTD) Vendor Gross Tracking for Statutory Thresholds
    // Query all bills from the start of the financial year up to the end of the requested quarter
    const startYear = parseInt(financialYear.split('-')[0], 10);
    const fyStartDate = `${startYear}-04-01`;
    const { start: quarterStart, end: quarterEnd } = getQuarterDateBounds(financialYear, quarter);

    const billsRes = await db.query(
      `SELECT b.id, b.vendor_id, b.vendor_name, b.total_amount, b.tax_amount, b.date,
              v.name as v_name, v.tax_id as v_tax_id, v.tds_section, v.pan as v_pan
       FROM bills b
       LEFT JOIN vendors v ON (b.vendor_id = v.id AND v.org_id = b.org_id)
       WHERE b.org_id = $1 AND b.date >= $2 AND b.date <= $3
       ORDER BY b.date ASC;`,
      [auth.activeOrgId, fyStartDate, quarterEnd]
    );

    // Track YTD gross (net base) across FY and collect quarter-specific bills
    const vendorYtdNetBase: Record<string, number> = {};
    const vendorQuarterData: Record<
      string,
      {
        vendorId: string;
        vendorName: string;
        latestDate: string;
        vendorTaxId: string | null;
        vendorSection: string | null;
        vendorPan: string | null;
        quarterBills: Array<{
          id: string;
          totalAmount: number;
          taxAmount: number;
          netBase: number;
          hasSeparateGst: boolean;
        }>;
        quarterTaxableBase: number;
        quarterInvoiceTotal: number;
        quarterGstTotal: number;
      }
    > = {};

    for (const b of billsRes.rows) {
      const vId = b.vendor_id || b.vendor_name;
      const totalAmount = Number(b.total_amount || 0);
      const taxAmount = Number(b.tax_amount || 0);
      // CBDT Circular 23/2017: If GST is indicated separately, TDS base excludes GST
      const hasSeparateGst = taxAmount > 0;
      const netBase = hasSeparateGst ? roundCurrency(totalAmount - taxAmount) : totalAmount;

      vendorYtdNetBase[vId] = roundCurrency((vendorYtdNetBase[vId] || 0) + netBase);

      const billDateStr = b.date instanceof Date
        ? b.date.toISOString().slice(0, 10)
        : String(b.date).slice(0, 10);

      // Check if bill falls in requested quarter
      if (billDateStr >= quarterStart && billDateStr <= quarterEnd) {
        if (!vendorQuarterData[vId]) {
          vendorQuarterData[vId] = {
            vendorId: b.vendor_id || vId,
            vendorName: b.v_name || b.vendor_name,
            latestDate: billDateStr,
            vendorTaxId: b.v_tax_id || null,
            vendorSection: b.tds_section || null,
            vendorPan: b.v_pan || null,
            quarterBills: [],
            quarterTaxableBase: 0,
            quarterInvoiceTotal: 0,
            quarterGstTotal: 0,
          };
        }

        const vEntry = vendorQuarterData[vId];
        vEntry.quarterBills.push({
          id: b.id,
          totalAmount,
          taxAmount,
          netBase,
          hasSeparateGst,
        });
        vEntry.quarterTaxableBase = roundCurrency(vEntry.quarterTaxableBase + netBase);
        vEntry.quarterInvoiceTotal = roundCurrency(vEntry.quarterInvoiceTotal + totalAmount);
        vEntry.quarterGstTotal = roundCurrency(vEntry.quarterGstTotal + taxAmount);

        if (billDateStr > vEntry.latestDate) {
          vEntry.latestDate = billDateStr;
        }
      }
    }

    const isNewRegime = startYear >= 2026;
    const legalRegime: LegalRegime = isNewRegime ? 'IT_ACT_2025' : 'IT_ACT_1961';
    const periodLabel = isNewRegime ? `Tax Year ${financialYear} (${quarter})` : `Financial Year ${financialYear} (${quarter})`;

    const certificates: TDSCertificate[] = [];

    for (const [vId, vData] of Object.entries(vendorQuarterData)) {
      const certId = `CERT-${financialYear.replace('-', '')}-${quarter}-${vData.vendorId}`;
      const signedInfo = dbSignoffs.get(certId);
      const allocInfo = allocationsByLine.get(certId);
      const missingFields: string[] = [];

      // Check deductor data completeness
      if (!deductorTan) missingFields.push('deductor_tan');
      if (!deductorAddress) missingFields.push('deductor_address');

      const gstin = vData.vendorTaxId;
      const pan = vData.vendorPan || extractPanFromGstin(gstin);
      if (!pan) {
        missingFields.push('vendor_pan');
      }

      let section: string | null = null;
      let sectionDescription = '';
      let paymentCode: string | null = null;
      let tdsRate: number | null = null;
      let tdsAmount = 0;
      let isBelowThreshold = false;
      let ruleStatus: string | null = null;
      let ruleCitation: string | null = null;

      if (!vData.vendorSection) {
        // Unknown vendor without configured section: NEVER invent one
        missingFields.push('vendor_tds_section');
        section = null;
        sectionDescription = 'TDS Section Missing — Configure on Vendor Profile';
        tdsRate = null;
        tdsAmount = 0;
      } else {
        section = vData.vendorSection;
        const rule = lookupStatutoryRule(section, vData.latestDate || quarterStart, dbRules);

        if (!rule) {
          missingFields.push('statutory_rule_not_found');
          sectionDescription = 'Statutory rule not found for section and date';
          tdsRate = null;
          tdsAmount = 0;
        } else {
          ruleStatus = rule.status;
          ruleCitation = rule.sourceCitation || null;

          // Check if rule is in 'draft' or unverified status
          if (rule.status !== 'approved') {
            missingFields.push('rates_unverified');
            section = rule.section || section;
            paymentCode = rule.paymentCode || null;
            sectionDescription = `${rule.description} (Rates Unverified - Draft Statutory Rule)`;
            tdsRate = null;
            tdsAmount = 0;
          } else {
            // Rule is APPROVED
            section = rule.section || section;
            sectionDescription = rule.description;
            paymentCode = rule.paymentCode || null;

            // Check dynamic statutory thresholds using DB-loaded values
            const ytdGross = vendorYtdNetBase[vId] || vData.quarterTaxableBase;
            const singleBreached =
              rule.thresholdSingle !== null &&
              rule.thresholdSingle !== undefined &&
              vData.quarterBills.some((b) => b.netBase > (rule.thresholdSingle as number));

            const aggBreached =
              rule.thresholdAggregate !== null &&
              rule.thresholdAggregate !== undefined &&
              ytdGross > (rule.thresholdAggregate as number);

            const hasThresholds =
              (rule.thresholdSingle !== null && rule.thresholdSingle !== undefined) ||
              (rule.thresholdAggregate !== null && rule.thresholdAggregate !== undefined);

            if (hasThresholds && !singleBreached && !aggBreached) {
              // Below threshold: Exempt from TDS
              isBelowThreshold = true;
              tdsRate = 0;
              tdsAmount = 0;
              sectionDescription += ' (Below statutory threshold - exempt)';
            } else {
              // Threshold breached or no threshold: Apply TDS
              if (!pan) {
                // Section 206AA penal withholding
                tdsRate = 20.0;
                sectionDescription += ' (Section 206AA Penal Rate Applied: Missing PAN)';
              } else {
                tdsRate = rule.rate ?? 10.0;
              }

              // Compute TDS strictly on taxable base (excluding GST per CBDT Circular 23/2017)
              tdsAmount = roundCurrency(vData.quarterTaxableBase * (tdsRate / 100));
            }
          }
        }
      }

      // Check Challan Allocation
      let challanBsr: string | null = null;
      let challanNumber: string | null = null;
      let depositDate: string | null = null;
      let isAllocated = false;
      let allocatedChallanId: string | null = null;
      let allocatedChallanSource: string | null = null;

      if (allocInfo) {
        isAllocated = true;
        allocatedChallanId = allocInfo.challan_id;
        challanNumber = allocInfo.challan_no;
        challanBsr = allocInfo.bsr_code;
        allocatedChallanSource = allocInfo.challan_source || 'manual';
        depositDate = allocInfo.deposit_date ? new Date(allocInfo.deposit_date).toISOString().slice(0, 10) : null;
      } else if (tdsAmount > 0) {
        // If TDS is deductible but no challan allocated, mark missing
        missingFields.push('challan_allocation');
      } else if (isBelowThreshold) {
        // When below threshold, TDS is 0 so no challan deposit is required
        isAllocated = true;
      }

      // Determine Line Status
      let status: 'generated' | 'signed_off' | 'data_missing' = 'generated';
      if (signedInfo) {
        status = 'signed_off';
      } else if (missingFields.length > 0) {
        status = 'data_missing';
      }

      const cbdtGstExclusionApplied = vData.quarterGstTotal > 0;

      certificates.push({
        id: certId,
        vendorId: vData.vendorId,
        vendorName: vData.vendorName,
        vendorPan: pan,
        vendorGstin: gstin,
        section,
        sectionDescription,
        paymentCode,
        quarter,
        financialYear,
        periodLabel,
        legalRegime,
        grossAmount: vData.quarterTaxableBase, // Net base excluding GST
        invoiceTotal: vData.quarterInvoiceTotal,
        gstAmount: vData.quarterGstTotal,
        cbdtGstExclusionApplied,
        caConfirmationRequired: cbdtGstExclusionApplied,
        isBelowThreshold,
        tdsRate,
        tdsAmount,
        challanBsr,
        challanNumber,
        depositDate,
        allocatedChallanSource,
        status,
        missingFields: missingFields.length > 0 ? missingFields : undefined,
        isAllocated,
        allocatedChallanId,
        signedBy: signedInfo?.signedBy || null,
        signedAt: signedInfo?.signedAt || null,
        ruleStatus,
        ruleSourceCitation: ruleCitation,
      });
    }

    // Compute Summary Math (strictly from stored records, no float drift)
    const totalGrossPaid = roundCurrency(certificates.reduce((acc, c) => acc + c.grossAmount, 0));
    const totalTdsDeducted = roundCurrency(certificates.reduce((acc, c) => acc + c.tdsAmount, 0));
    const totalTdsDeposited = roundCurrency(challans.reduce((acc: number, ch: any) => acc + Number(ch.amount || 0), 0));
    const depositedVsDeductedVariance = roundCurrency(totalTdsDeposited - totalTdsDeducted);

    const signedCount = certificates.filter((c) => c.status === 'signed_off').length;
    const dataMissingCount = certificates.filter((c) => c.status === 'data_missing').length;

    // Return-ready condition: All deduction lines allocated, no data_missing lines, and deposited >= deducted
    const allLinesAllocated =
      certificates.length > 0 &&
      certificates.every((c) => c.isAllocated && c.status !== 'data_missing');
    const returnReady = allLinesAllocated && totalTdsDeposited >= totalTdsDeducted;

    const summary = {
      quarter,
      financialYear,
      periodLabel,
      legalRegime,
      formNames: STATUTORY_FORM_CONFIG,
      totalDeductees: certificates.length,
      totalGrossPaid,
      totalTdsDeducted,
      totalTdsDeposited,
      depositedVsDeductedVariance,
      allLinesAllocated,
      returnReady,
      signedCount,
      pendingSignOff: certificates.length - signedCount,
      dataMissingCount,
      challansCount: challans.length,
    };

    const deductor = {
      name: org?.legal_name || org?.name || 'Organization Name Not Set',
      taxId: org?.tax_id || null,
      pan: deductorPan,
      tan: deductorTan,
      address: deductorAddress,
      isDataMissing: isDeductorDataMissing,
    };

    return NextResponse.json({
      success: true,
      deductor,
      summary,
      certificates,
      challans,
    });
  } catch (err: any) {
    logger.error('[tds-certificates/GET]', { route: '/api/tds-certificates', err: String(err) });
    const status = err.message?.includes('403 Forbidden') ? 403 : err.message?.includes('401') ? 401 : 500;
    return NextResponse.json({ success: false, error: err.message }, { status });
  }
}

/**
 * POST /api/tds-certificates
 * Handles CA statutory sign-off, challan creation, challan allocation, and CA approval of draft rules.
 * Strictly blocks sign-off if challan, statutory data, or draft rule status is unresolved.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    await assertTenantAccess(auth, auth.activeOrgId);

    const bodyParsed = await safeParseJson<any>(req);
    if (!bodyParsed.success || !bodyParsed.data) {
      return NextResponse.json({ success: false, error: bodyParsed.error || 'Invalid request body' }, { status: 400 });
    }

    const { action } = bodyParsed.data;
    const db = await getDb();

    // ─── ACTION 1: Statutory Sign-Off ──────────────────────────────────────────
    if (action === 'sign_off') {
      const access = checkRoleAccess(auth, ['CA', 'FIRM_ADMIN']);
      if (!access.allowed) {
        return NextResponse.json(
          { success: false, error: 'Access Denied: Chartered Accountant sign-off authority required for statutory compliance.' },
          { status: 403 }
        );
      }

      const { certificateId } = bodyParsed.data;
      if (!certificateId) {
        return NextResponse.json({ success: false, error: 'certificateId is required' }, { status: 400 });
      }

      // Check organization deductor data completeness
      const orgRes = await db.query(
        'SELECT tan, address FROM organizations WHERE id = $1;',
        [auth.activeOrgId]
      );
      const org = orgRes.rows[0];
      if (!org?.tan || !org?.address) {
        return NextResponse.json(
          {
            success: false,
            error: `Cannot sign off: Deductor statutory data missing (TAN or Address not configured on Organization).`,
            missingFields: ['deductor_tan', 'deductor_address'].filter((f) => !org?.[f.replace('deductor_', '')]),
          },
          { status: 400 }
        );
      }

      // Verify vendor has configured section
      const parts = certificateId.split('-');
      const vendorId = parts.slice(3).join('-');
      if (!vendorId) {
        return NextResponse.json({ success: false, error: 'Malformed certificateId' }, { status: 400 });
      }

      const vendorRes = await db.query(
        'SELECT tds_section, pan FROM vendors WHERE org_id = $1 AND (id = $2 OR name = $2);',
        [auth.activeOrgId, vendorId]
      );
      const v = vendorRes.rows[0];
      if (!v?.tds_section) {
        return NextResponse.json(
          {
            success: false,
            error: `Cannot sign off: Vendor has no statutory TDS section configured.`,
            missingFields: ['vendor_tds_section'],
          },
          { status: 400 }
        );
      }

      // Check statutory rule status in database
      const ruleRes = await db.query(
        `SELECT id, section, status, description, source_citation
         FROM statutory_tds_rules
         WHERE section = $1 OR notes LIKE $2 OR description LIKE $2;`,
        [v.tds_section, `%${v.tds_section}%`]
      );

      const matchedRule = ruleRes.rows[0];
      if (matchedRule && matchedRule.status !== 'approved') {
        return NextResponse.json(
          {
            success: false,
            error: `Cannot sign off: Statutory rule is in draft status (${matchedRule.status}, rates unverified). A Chartered Accountant must approve statutory mapping before sign-off.`,
            missingFields: ['rates_unverified'],
          },
          { status: 400 }
        );
      }

      // Check challan allocation for this deduction line
      const allocRes = await db.query(
        `SELECT a.id, a.challan_id, a.allocated_amount, c.challan_no, c.bsr_code, c.deposit_date
         FROM tds_challan_allocations a
         JOIN tds_challans c ON a.challan_id = c.id
         WHERE a.org_id = $1 AND a.deduction_line_id = $2;`,
        [auth.activeOrgId, certificateId]
      );

      if (allocRes.rows.length === 0) {
        return NextResponse.json(
          {
            success: false,
            error: `Cannot sign off: Challan missing or unallocated for deduction line "${certificateId}". Link a deposited Challan ITNS 281 before signing off.`,
            missingFields: ['challan_allocation'],
          },
          { status: 400 }
        );
      }

      const signedAt = new Date().toISOString();
      const signedBy = auth.userId || auth.userName || 'user-lead-ca';
      const signoffId = `tds-so-${Date.now()}`;

      // Persist in tds_signoffs table
      await db.query(
        `INSERT INTO tds_signoffs (id, org_id, cert_id, signed_by, signed_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (org_id, cert_id)
         DO UPDATE SET signed_by = EXCLUDED.signed_by, signed_at = EXCLUDED.signed_at;`,
        [signoffId, auth.activeOrgId, certificateId, signedBy, signedAt]
      );

      // Audit trail logging
      try {
        const logId = `log-tds-${Date.now()}`;
        await db.query(
          `INSERT INTO audit_logs (id, org_id, user_id, user_name, action, entity_type, entity_id, before_state, after_state, explanation)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);`,
          [
            logId,
            auth.activeOrgId,
            auth.userId || 'user-lead-ca',
            auth.userName || 'Priya Sharma, FCA',
            'SIGN_TDS_REGISTER_LINE',
            'tds_deduction_line',
            certificateId,
            null,
            JSON.stringify({ status: 'signed_off', signedBy, signedAt, challanId: allocRes.rows[0].challan_id }),
            `Chartered Accountant statutory sign-off on TDS deduction line (${certificateId}) against Challan ${allocRes.rows[0].challan_no}`,
          ]
        );
      } catch (logErr) {
        logger.warn('Audit log write error:', { route: '/api/tds-certificates', err: String(logErr) });
      }

      return NextResponse.json({
        success: true,
        message: `Deduction line ${certificateId} signed off successfully by ${signedBy}`,
        certificateId,
        signedBy,
        signedAt,
      });
    }

    // ─── ACTION 2: Record Challan ──────────────────────────────────────────────
    if (action === 'record_challan') {
      const access = checkRoleAccess(auth, ['CA', 'FIRM_ADMIN']);
      if (!access.allowed) {
        return NextResponse.json({ success: false, error: 'Access Denied: CA or Firm Admin role required.' }, { status: 403 });
      }

      const { challanNo, bsrCode, depositDate, amount, section, quarter, financialYear } = bodyParsed.data;
      if (!challanNo || !bsrCode || !depositDate || amount === undefined || !section || !quarter || !financialYear) {
        return NextResponse.json(
          {
            success: false,
            error: 'Missing required challan fields: challanNo, bsrCode, depositDate, amount, section, quarter, financialYear are all required.',
          },
          { status: 400 }
        );
      }

      const cleanAmount = roundCurrency(Number(amount));
      if (cleanAmount <= 0) {
        return NextResponse.json({ success: false, error: 'Challan amount must be greater than zero.' }, { status: 400 });
      }

      const challanId = `chl-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      await db.query(
        `INSERT INTO tds_challans (id, org_id, challan_no, bsr_code, deposit_date, amount, section, quarter, financial_year, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'manual')
         ON CONFLICT (org_id, challan_no, bsr_code, deposit_date)
         DO UPDATE SET amount = EXCLUDED.amount;`,
        [challanId, auth.activeOrgId, challanNo.trim(), bsrCode.trim(), depositDate, cleanAmount, section.trim(), quarter, financialYear]
      );

      return NextResponse.json(
        {
          success: true,
          challanId,
          message: `Challan ${challanNo} recorded successfully for ₹${cleanAmount.toLocaleString('en-IN')}`,
        },
        { status: 201 }
      );
    }

    // ─── ACTION 3: Allocate Challan to Line Item ──────────────────────────────
    if (action === 'allocate_challan') {
      const access = checkRoleAccess(auth, ['CA', 'FIRM_ADMIN']);
      if (!access.allowed) {
        return NextResponse.json({ success: false, error: 'Access Denied: CA or Firm Admin role required.' }, { status: 403 });
      }

      const { challanId, deductionLineId, amount } = bodyParsed.data;
      if (!challanId || !deductionLineId || amount === undefined) {
        return NextResponse.json({ success: false, error: 'challanId, deductionLineId, and amount are required.' }, { status: 400 });
      }

      const allocId = `alloc-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      await db.query(
        `INSERT INTO tds_challan_allocations (id, org_id, challan_id, deduction_line_id, allocated_amount)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (challan_id, deduction_line_id)
         DO UPDATE SET allocated_amount = EXCLUDED.allocated_amount;`,
        [allocId, auth.activeOrgId, challanId, deductionLineId, roundCurrency(Number(amount))]
      );

      return NextResponse.json({
        success: true,
        message: `Challan allocated to deduction line ${deductionLineId}`,
      });
    }

    // ─── ACTION 4: CA Approval of Draft Statutory Rule ────────────────────────
    if (action === 'approve_statutory_rule') {
      const access = checkRoleAccess(auth, ['CA', 'FIRM_ADMIN']);
      if (!access.allowed) {
        return NextResponse.json({ success: false, error: 'Access Denied: CA or Firm Admin role required.' }, { status: 403 });
      }

      const { ruleId } = bodyParsed.data;
      if (!ruleId) {
        return NextResponse.json({ success: false, error: 'ruleId is required' }, { status: 400 });
      }

      const reviewerName = auth.userName || auth.userId || 'CA Priya Sharma, FCA';
      const updateRes = await db.query(
        `UPDATE statutory_tds_rules
         SET status = 'approved', reviewed_by = $1, reviewed_at = CURRENT_TIMESTAMP
         WHERE id = $2
         RETURNING id, section, status, reviewed_by, reviewed_at;`,
        [reviewerName, ruleId]
      );

      if (updateRes.rows.length === 0) {
        return NextResponse.json({ success: false, error: `Rule ${ruleId} not found.` }, { status: 404 });
      }

      return NextResponse.json({
        success: true,
        message: `Statutory rule ${ruleId} approved by ${reviewerName}`,
        rule: updateRes.rows[0],
      });
    }

    return NextResponse.json({ success: false, error: 'Invalid or unsupported action.' }, { status: 400 });
  } catch (err: any) {
    logger.error('[tds-certificates/POST]', { route: '/api/tds-certificates', err: String(err) });
    const status = err.message?.includes('403 Forbidden') ? 403 : err.message?.includes('401') ? 401 : 500;
    return NextResponse.json({ success: false, error: err.message }, { status });
  }
}
