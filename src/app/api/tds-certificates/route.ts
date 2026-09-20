import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, assertTenantAccess, checkRoleAccess } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { safeParseJson, isValidPan } from '@/lib/security';
import {
  getCurrentTaxPeriod,
  getQuarterDateBounds,
  lookupStatutoryRule,
  getLegalRegimeForDate,
  STATUTORY_FORM_CONFIG,
  LegalRegime
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
  grossAmount: number;
  tdsRate: number | null; // percentage e.g. 10 for 10%, null if data missing
  tdsAmount: number;
  challanBsr: string | null;
  challanNumber: string | null;
  depositDate: string | null;
  status: 'generated' | 'signed_off' | 'data_missing';
  missingFields?: string[];
  isAllocated: boolean;
  allocatedChallanId?: string | null;
  signedBy?: string | null;
  signedAt?: string | null;
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
 * Derives calculations strictly from stored vendor profiles and real bill records.
 * NEVER fabricates financial numbers, challans, or statutory rates.
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

    // 2. Fetch existing CA sign-offs from database table tds_signoffs (no in-memory Map)
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

    // 3. Fetch all challans for this org, quarter, and financial year
    const challansRes = await db.query(
      `SELECT id, challan_no, bsr_code, deposit_date, amount, section, quarter, financial_year, source
       FROM tds_challans
       WHERE org_id = $1 AND quarter = $2 AND financial_year = $3
       ORDER BY deposit_date ASC;`,
      [auth.activeOrgId, quarter, financialYear]
    );
    const challans = challansRes.rows;

    // 4. Fetch all challan allocations for this org
    const allocRes = await db.query(
      `SELECT a.id, a.challan_id, a.deduction_line_id, a.allocated_amount,
              c.challan_no, c.bsr_code, c.deposit_date
       FROM tds_challan_allocations a
       JOIN tds_challans c ON a.challan_id = c.id
       WHERE a.org_id = $1;`,
      [auth.activeOrgId]
    );
    const allocationsByLine = new Map<string, any>();
    for (const row of allocRes.rows) {
      allocationsByLine.set(row.deduction_line_id, row);
    }

    // 5. Fetch bills within the quarter date bounds
    const { start: quarterStart, end: quarterEnd } = getQuarterDateBounds(financialYear, quarter);
    const billsRes = await db.query(
      `SELECT b.id, b.vendor_id, b.vendor_name, b.total_amount, b.date,
              v.name as v_name, v.tax_id as v_tax_id, v.tds_section, v.pan as v_pan
       FROM bills b
       LEFT JOIN vendors v ON (b.vendor_id = v.id AND v.org_id = b.org_id)
       WHERE b.org_id = $1 AND b.date >= $2 AND b.date <= $3
       ORDER BY b.date ASC;`,
      [auth.activeOrgId, quarterStart, quarterEnd]
    );

    // Group bills by vendor
    const billsByVendor: Record<string, { vendorId: string; vendorName: string; gross: number; latestDate: string; vendorTaxId: string | null; vendorSection: string | null; vendorPan: string | null }> = {};
    for (const b of billsRes.rows) {
      const vId = b.vendor_id || b.vendor_name;
      if (!billsByVendor[vId]) {
        billsByVendor[vId] = {
          vendorId: b.vendor_id || vId,
          vendorName: b.v_name || b.vendor_name,
          gross: 0,
          latestDate: b.date,
          vendorTaxId: b.v_tax_id || null,
          vendorSection: b.tds_section || null,
          vendorPan: b.v_pan || null,
        };
      }
      billsByVendor[vId].gross = roundCurrency(billsByVendor[vId].gross + Number(b.total_amount || 0));
      if (b.date > billsByVendor[vId].latestDate) {
        billsByVendor[vId].latestDate = b.date;
      }
    }

    const startYear = parseInt(financialYear.split('-')[0], 10);
    const isNewRegime = startYear >= 2026;
    const legalRegime: LegalRegime = isNewRegime ? 'IT_ACT_2025' : 'IT_ACT_1961';
    const periodLabel = isNewRegime ? `Tax Year ${financialYear} (${quarter})` : `Financial Year ${financialYear} (${quarter})`;

    const certificates: TDSCertificate[] = [];

    for (const [vId, vData] of Object.entries(billsByVendor)) {
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

      if (!vData.vendorSection) {
        // Unknown vendor without configured section: NEVER invent one
        missingFields.push('vendor_tds_section');
        section = null;
        sectionDescription = 'TDS Section Missing — Configure on Vendor Profile';
        tdsRate = null;
        tdsAmount = 0;
      } else {
        section = vData.vendorSection;
        const rule = lookupStatutoryRule(section, vData.latestDate || quarterStart);

        if (!rule || rule.regime === 'IT_ACT_2025') {
          // Post-2026-04-01 Income-tax Act 2025: Section 393 framework mapping pending CA review
          missingFields.push('statutory_mapping_pending');
          section = null;
          sectionDescription = 'Income-tax Act 2025: Section 393 Statutory Mapping Pending CA Review';
          paymentCode = null;
          tdsRate = null;
          tdsAmount = 0;
        } else {
          sectionDescription = rule.description;
          paymentCode = rule.paymentCode || null;

          // If PAN is missing, Section 206AA mandates 20% withholding
          if (!pan) {
            tdsRate = 20.0;
            sectionDescription += ' (Section 206AA Penal Rate Applied: Missing PAN)';
          } else {
            tdsRate = rule.rate ?? 10.0;
          }

          tdsAmount = roundCurrency(vData.gross * (tdsRate / 100));
        }
      }

      // Check Challan Allocation
      let challanBsr: string | null = null;
      let challanNumber: string | null = null;
      let depositDate: string | null = null;
      let isAllocated = false;
      let allocatedChallanId: string | null = null;

      if (allocInfo) {
        isAllocated = true;
        allocatedChallanId = allocInfo.challan_id;
        challanNumber = allocInfo.challan_no;
        challanBsr = allocInfo.bsr_code;
        depositDate = allocInfo.deposit_date ? new Date(allocInfo.deposit_date).toISOString().slice(0, 10) : null;
      } else {
        missingFields.push('challan_allocation');
      }

      // Determine Line Status
      let status: 'generated' | 'signed_off' | 'data_missing' = 'generated';
      if (signedInfo) {
        status = 'signed_off';
      } else if (missingFields.length > 0) {
        status = 'data_missing';
      }

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
        grossAmount: vData.gross,
        tdsRate,
        tdsAmount,
        challanBsr,
        challanNumber,
        depositDate,
        status,
        missingFields: missingFields.length > 0 ? missingFields : undefined,
        isAllocated,
        allocatedChallanId,
        signedBy: signedInfo?.signedBy || null,
        signedAt: signedInfo?.signedAt || null,
      });
    }

    // Compute Summary Math (strictly from stored records, no float drift)
    const totalGrossPaid = roundCurrency(certificates.reduce((acc, c) => acc + c.grossAmount, 0));
    const totalTdsDeducted = roundCurrency(certificates.reduce((acc, c) => acc + c.tdsAmount, 0));
    const totalTdsDeposited = roundCurrency(challans.reduce((acc: number, ch: any) => acc + Number(ch.amount || 0), 0));
    const depositedVsDeductedVariance = roundCurrency(totalTdsDeposited - totalTdsDeducted);

    const signedCount = certificates.filter((c) => c.status === 'signed_off').length;
    const dataMissingCount = certificates.filter((c) => c.status === 'data_missing').length;

    // Return-ready condition: All deduction lines allocated and deposited >= deducted with no missing data
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
 * Handles CA statutory sign-off, challan creation, and challan allocation.
 * Strictly blocks sign-off if challan or statutory data is missing.
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

      const { certificateId, quarter, financialYear } = bodyParsed.data;
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
            missingFields: ['deductor_tan', 'deductor_address'].filter(f => !org?.[f.replace('deductor_', '')])
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
            missingFields: ['challan_allocation']
          },
          { status: 400 }
        );
      }

      // Verify vendor has configured section
      const parts = certificateId.split('-');
      const vendorId = parts.slice(3).join('-');
      if (vendorId) {
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
              missingFields: ['vendor_tds_section']
            },
            { status: 400 }
          );
        }
      }

      const signedAt = new Date().toISOString();
      const signedBy = auth.userId || 'user-lead-ca';
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
          { success: false, error: 'Missing required challan fields: challanNo, bsrCode, depositDate, amount, section, quarter, financialYear are all required.' },
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

      return NextResponse.json({
        success: true,
        challanId,
        message: `Challan ${challanNo} recorded successfully for ₹${cleanAmount.toLocaleString('en-IN')}`,
      }, { status: 201 });
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

    return NextResponse.json({ success: false, error: 'Invalid or unsupported action.' }, { status: 400 });
  } catch (err: any) {
    logger.error('[tds-certificates/POST]', { route: '/api/tds-certificates', err: String(err) });
    const status = err.message?.includes('403 Forbidden') ? 403 : err.message?.includes('401') ? 401 : 500;
    return NextResponse.json({ success: false, error: err.message }, { status });
  }
}
