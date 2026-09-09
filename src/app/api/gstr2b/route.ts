import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { reconcileITC, seedGSTR2BIfEmpty } from '@/lib/gstr2bEngine';

/**
 * GET  /api/gstr2b?period=2024-10  — Fetch GSTR-2B entries and run ITC reconciliation
 * POST /api/gstr2b                  — Upload raw GSTR-2B JSON (GSTN format) or clear period
 */

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    const { searchParams } = new URL(req.url);
    const period = searchParams.get('period') || '2024-10';

    // Seed mock data for demo if the period is empty
    await seedGSTR2BIfEmpty(auth.activeOrgId, period);

    const { rows, summary } = await reconcileITC(auth.activeOrgId, period);

    return NextResponse.json({ success: true, period, rows, summary });
  } catch (err: any) {
    console.error('[gstr2b/GET]', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    const body = await req.json();
    const { action, period, entries } = body;

    if (!period) {
      return NextResponse.json({ success: false, error: 'period is required (YYYY-MM)' }, { status: 400 });
    }

    const db = await getDb();

    if (action === 'clear') {
      await db.query(
        'DELETE FROM gstr2b_entries WHERE org_id = $1 AND period = $2;',
        [auth.activeOrgId, period]
      );
      return NextResponse.json({ success: true, message: `Cleared GSTR-2B entries for ${period}` });
    }

    if (action === 'upload' && Array.isArray(entries)) {
      let inserted = 0;
      for (const e of entries) {
        const id = `gstr2b-${auth.activeOrgId}-${period}-${e.invoice_number}-${e.supplier_gstin}`.replace(/[^a-zA-Z0-9\-]/g, '_').slice(0, 80);
        await db.query(
          `INSERT INTO gstr2b_entries
             (id, org_id, period, supplier_gstin, supplier_name, invoice_number,
              invoice_date, invoice_value, taxable_value, igst, cgst, sgst, itc_available, source)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'upload')
           ON CONFLICT (id) DO UPDATE SET
             invoice_value = EXCLUDED.invoice_value,
             taxable_value = EXCLUDED.taxable_value,
             igst = EXCLUDED.igst,
             cgst = EXCLUDED.cgst,
             sgst = EXCLUDED.sgst,
             itc_available = EXCLUDED.itc_available;`,
          [id, auth.activeOrgId, period,
           e.supplier_gstin, e.supplier_name, e.invoice_number,
           e.invoice_date, e.invoice_value || 0, e.taxable_value || 0,
           e.igst || 0, e.cgst || 0, e.sgst || 0, e.itc_available !== false]
        );
        inserted++;
      }
      return NextResponse.json({ success: true, inserted, message: `Uploaded ${inserted} GSTR-2B entries for ${period}` });
    }

    return NextResponse.json({ success: false, error: 'Invalid action. Use action=upload or action=clear' }, { status: 400 });
  } catch (err: any) {
    console.error('[gstr2b/POST]', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
