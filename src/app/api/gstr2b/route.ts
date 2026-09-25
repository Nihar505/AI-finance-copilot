import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, assertTenantAccess } from '@/lib/auth';
import { getDb } from '@/lib/db';
import {
  reconcileITC,
  parseGSTR2BJson,
  parseGSTR2BExcel,
  commitGSTR2BImport,
  ParsedGSTR2BEntry,
} from '@/lib/gstr2bEngine';
import { safeParseJson } from '@/lib/security';
import logger from '@/lib/logger';

/**
 * GET  /api/gstr2b?period=2024-10  — Fetch GSTR-2B entries and run ITC reconciliation
 *                                     Supports taxTolerance and valueTolerance query params (in rupees or paise)
 *                                     NO auto-seeding: empty period = empty entries.
 *
 * POST /api/gstr2b                 — Actions:
 *                                     - 'preview_import' : Validate raw JSON or Excel without writing to DB.
 *                                     - 'commit_import'  : Re-validate server-side and import into DB transactionally.
 *                                     - 'clear'          : Delete entries for org + period.
 *                                     - 'upload'         : Direct upload of parsed entries (idempotent).
 */

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    await assertTenantAccess(auth, auth.activeOrgId);
    const { searchParams } = new URL(req.url);
    const period = searchParams.get('period') || '2024-10';

    // Parse configurable tolerances if provided
    let taxTolerancePaise: number | undefined = undefined;
    let valueTolerancePaise: number | undefined = undefined;

    const rawTaxTol = searchParams.get('taxTolerance');
    if (rawTaxTol) {
      const num = parseFloat(rawTaxTol);
      if (!isNaN(num)) {
        // If ≤ 2, treat as Rupees (e.g. 1.0 -> 100 paise), else treat as paise
        taxTolerancePaise = num <= 2.0 ? Math.round(num * 100) : Math.round(num);
      }
    }

    const rawValTol = searchParams.get('valueTolerance');
    if (rawValTol) {
      const num = parseFloat(rawValTol);
      if (!isNaN(num)) {
        valueTolerancePaise = num <= 2.0 ? Math.round(num * 100) : Math.round(num);
      }
    }

    // Deterministic ITC reconciliation — no auto-seeding
    const { rows, summary } = await reconcileITC(auth.activeOrgId, period, {
      taxTolerancePaise,
      valueTolerancePaise,
    });

    return NextResponse.json({ success: true, period, rows, summary });
  } catch (err: any) {
    logger.error('[gstr2b/GET]', { route: '/api/gstr2b', err: String(err) });
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    await assertTenantAccess(auth, auth.activeOrgId);

    const bodyParsed = await safeParseJson<any>(req);
    if (!bodyParsed.success || !bodyParsed.data) {
      return NextResponse.json({ success: false, error: bodyParsed.error || 'Invalid request body' }, { status: 400 });
    }
    const {
      action,
      period,
      fileType,
      fileBase64,
      fileContent,
      jsonContent,
      entries,
    } = bodyParsed.data;

    if (!period) {
      return NextResponse.json({ success: false, error: 'period is required (YYYY-MM)' }, { status: 400 });
    }

    const db = await getDb();

    // ─── ACTION: CLEAR ────────────────────────────────────────────────────────
    if (action === 'clear') {
      const res = await db.query(
        'DELETE FROM gstr2b_entries WHERE org_id = $1 AND period = $2;',
        [auth.activeOrgId, period]
      );
      return NextResponse.json({
        success: true,
        message: `Cleared GSTR-2B entries for ${period}`,
        deletedCount: res.rowCount,
      });
    }

    // Helper: Parse payload based on fileType / raw content
    const parsePayload = async () => {
      if (fileType === 'excel' || fileType === 'xlsx') {
        if (!fileBase64) {
          throw new Error('Missing fileBase64 for Excel upload');
        }
        const buffer = Buffer.from(fileBase64, 'base64');
        return await parseGSTR2BExcel(buffer);
      } else {
        // Default to JSON
        const raw = jsonContent || fileContent;
        if (!raw) {
          if (fileBase64) {
            const decoded = Buffer.from(fileBase64, 'base64').toString('utf8');
            return parseGSTR2BJson(decoded);
          }
          throw new Error('Missing jsonContent or fileBase64 for JSON upload');
        }
        return parseGSTR2BJson(raw);
      }
    };

    // ─── ACTION: PREVIEW IMPORT (Validate, No DB Writes) ───────────────────────
    if (action === 'preview_import') {
      const parseResult = await parsePayload();
      return NextResponse.json({
        success: parseResult.success,
        preview: parseResult,
        message: parseResult.success
          ? `Parsed ${parseResult.entries.length} entries for preview`
          : 'GSTR-2B preview validation failed',
      }, { status: parseResult.success ? 200 : 400 });
    }

    // ─── ACTION: COMMIT IMPORT (Server-Side Re-Validation & Transactional Write) ──
    if (action === 'commit_import') {
      let entriesToCommit: ParsedGSTR2BEntry[] = [];

      if (fileBase64 || jsonContent || fileContent) {
        // Re-validate server side
        const parseResult = await parsePayload();
        if (!parseResult.success) {
          return NextResponse.json({
            success: false,
            error: 'Server-side validation failed',
            details: parseResult.errors,
          }, { status: 400 });
        }
        entriesToCommit = parseResult.entries;
      } else if (Array.isArray(entries)) {
        // Defensive validation of entries passed directly
        for (const e of entries) {
          if (!e.supplier_gstin || !e.invoice_number) {
            return NextResponse.json({
              success: false,
              error: 'Each entry must contain supplier_gstin and invoice_number',
            }, { status: 400 });
          }
          entriesToCommit.push({
            supplier_gstin: String(e.supplier_gstin).trim().toUpperCase(),
            supplier_name: String(e.supplier_name || e.supplier_gstin).trim(),
            invoice_number: String(e.invoice_number).trim(),
            invoice_date: String(e.invoice_date || ''),
            invoice_value: Number(e.invoice_value) || 0,
            taxable_value: Number(e.taxable_value) || 0,
            igst: Number(e.igst) || 0,
            cgst: Number(e.cgst) || 0,
            sgst: Number(e.sgst) || 0,
            total_tax: Math.round(((Number(e.igst) || 0) + (Number(e.cgst) || 0) + (Number(e.sgst) || 0)) * 100) / 100,
            itc_available: e.itc_available !== false,
            itc_ineligible_reason: e.itc_ineligible_reason || null,
          });
        }
      } else {
        return NextResponse.json({
          success: false,
          error: 'No import data provided (expected fileBase64, jsonContent, or entries)',
        }, { status: 400 });
      }

      const commitRes = await commitGSTR2BImport(auth.activeOrgId, period, entriesToCommit, 'upload');

      return NextResponse.json({
        success: true,
        period,
        inserted: commitRes.inserted,
        updated: commitRes.updated,
        total: commitRes.total,
        message: `Imported ${commitRes.total} GSTR-2B entries (${commitRes.inserted} new, ${commitRes.updated} updated) for ${period}`,
      });
    }

    // ─── ACTION: UPLOAD (Direct entries fallback) ──────────────────────────────
    if (action === 'upload' && Array.isArray(entries)) {
      const sanitizedEntries: ParsedGSTR2BEntry[] = entries.map((e: any) => ({
        supplier_gstin: String(e.supplier_gstin).trim().toUpperCase(),
        supplier_name: String(e.supplier_name || e.supplier_gstin).trim(),
        invoice_number: String(e.invoice_number).trim(),
        invoice_date: String(e.invoice_date || ''),
        invoice_value: Number(e.invoice_value) || 0,
        taxable_value: Number(e.taxable_value) || 0,
        igst: Number(e.igst) || 0,
        cgst: Number(e.cgst) || 0,
        sgst: Number(e.sgst) || 0,
        total_tax: Math.round(((Number(e.igst) || 0) + (Number(e.cgst) || 0) + (Number(e.sgst) || 0)) * 100) / 100,
        itc_available: e.itc_available !== false,
        itc_ineligible_reason: e.itc_ineligible_reason || null,
      }));

      const commitRes = await commitGSTR2BImport(auth.activeOrgId, period, sanitizedEntries, 'upload');

      return NextResponse.json({
        success: true,
        period,
        inserted: commitRes.inserted,
        updated: commitRes.updated,
        total: commitRes.total,
        message: `Uploaded ${commitRes.total} GSTR-2B entries for ${period}`,
      });
    }

    return NextResponse.json({
      success: false,
      error: 'Invalid action. Supported actions: preview_import, commit_import, clear, upload',
    }, { status: 400 });
  } catch (err: any) {
    logger.error('[gstr2b/POST]', { route: '/api/gstr2b', err: String(err) });
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
