import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getAuthContext } from '@/lib/auth';

/**
 * Milestone 12: Compliance Calendar API
 * GET  /api/compliance      — List compliance filings for active org (sorted by due_date)
 * POST /api/compliance      — Upsert / update a compliance filing status or ack number
 */

type FilingStatus = 'upcoming' | 'pending_review' | 'approved' | 'filed' | 'overdue';

interface ComplianceFiling {
  id: string;
  org_id: string;
  filing_type: string;
  period: string;
  due_date: string;
  assigned_ca?: string;
  status: FilingStatus;
  reference_ack_number?: string;
  notes?: string;
  days_until_due?: number;
  is_overdue: boolean;
}

function computeFilingStatus(dueDate: string, currentStatus: string, filed: boolean): FilingStatus {
  if (filed || currentStatus === 'filed') return 'filed';
  const due = new Date(dueDate).getTime();
  const now = Date.now();
  const daysUntilDue = Math.round((due - now) / (1000 * 60 * 60 * 24));
  if (daysUntilDue < 0) return 'overdue';
  if (currentStatus === 'approved') return 'approved';
  if (daysUntilDue <= 7) return 'pending_review';
  return 'upcoming';
}

/**
 * Seed a default compliance calendar for the FY if none exists.
 * Generates standard Indian statutory filing schedule.
 */
async function seedComplianceCalendarIfEmpty(orgId: string): Promise<void> {
  const db = await getDb();

  // Ensure table exists
  await db.query(`
    CREATE TABLE IF NOT EXISTS compliance_filings (
      id VARCHAR(50) PRIMARY KEY,
      org_id VARCHAR(50),
      filing_type VARCHAR(50) NOT NULL,
      period VARCHAR(20) NOT NULL,
      due_date DATE NOT NULL,
      assigned_ca VARCHAR(50),
      status VARCHAR(30) NOT NULL DEFAULT 'upcoming',
      reference_ack_number VARCHAR(100),
      notes TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const existing = await db.query(
    'SELECT COUNT(*) as cnt FROM compliance_filings WHERE org_id = $1;',
    [orgId]
  );
  if (Number(existing.rows[0]?.cnt) > 0) return;

  // Generate FY 2024-25 compliance schedule (Apr 2024 – Mar 2025)
  const filings: Array<{ id: string; filing_type: string; period: string; due_date: string; notes: string }> = [];

  const months = [
    { year: 2024, month: 4 }, { year: 2024, month: 5 }, { year: 2024, month: 6 },
    { year: 2024, month: 7 }, { year: 2024, month: 8 }, { year: 2024, month: 9 },
    { year: 2024, month: 10 }, { year: 2024, month: 11 }, { year: 2024, month: 12 },
    { year: 2025, month: 1 }, { year: 2025, month: 2 }, { year: 2025, month: 3 },
  ];

  for (const { year, month } of months) {
    const periodLabel = `${year}-${String(month).padStart(2, '0')}`;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const nextMonthStr = String(nextMonth).padStart(2, '0');

    // GSTR-1 (11th of following month)
    filings.push({
      id: `comp-gstr1-${orgId}-${periodLabel}`,
      filing_type: 'GSTR1',
      period: periodLabel,
      due_date: `${nextYear}-${nextMonthStr}-11`,
      notes: `GSTR-1 outward supplies for ${periodLabel}. Report all B2B invoices, B2C summary, credit notes, and HSN-wise summary.`,
    });

    // GSTR-3B (20th of following month)
    filings.push({
      id: `comp-gstr3b-${orgId}-${periodLabel}`,
      filing_type: 'GSTR3B',
      period: periodLabel,
      due_date: `${nextYear}-${nextMonthStr}-20`,
      notes: `GSTR-3B summary return for ${periodLabel}. Declare net tax liability after ITC. GST payment due before filing.`,
    });

    // TDS Deposit (7th of following month)
    filings.push({
      id: `comp-tds-deposit-${orgId}-${periodLabel}`,
      filing_type: 'TDS_DEPOSIT',
      period: periodLabel,
      due_date: `${nextYear}-${nextMonthStr}-07`,
      notes: `TDS Deposit for ${periodLabel}. Deposit TDS deducted under Sections 194C, 194J, 194I, 192, 194Q.`,
    });
  }

  // Advance Tax installments (FY 2024-25)
  filings.push(
    { id: `comp-advtax-q1-${orgId}-2024`, filing_type: 'ADVANCE_TAX_Q1', period: '2024-Q1', due_date: '2024-06-15', notes: 'Advance Tax Q1 FY2024-25: Pay 15% of estimated annual tax liability. Companies must pay advance tax if annual liability > ₹10,000.' },
    { id: `comp-advtax-q2-${orgId}-2024`, filing_type: 'ADVANCE_TAX_Q2', period: '2024-Q2', due_date: '2024-09-15', notes: 'Advance Tax Q2 FY2024-25: Cumulative 45% of estimated annual tax liability.' },
    { id: `comp-advtax-q3-${orgId}-2024`, filing_type: 'ADVANCE_TAX_Q3', period: '2024-Q3', due_date: '2024-12-15', notes: 'Advance Tax Q3 FY2024-25: Cumulative 75% of estimated annual tax liability.' },
    { id: `comp-advtax-q4-${orgId}-2024`, filing_type: 'ADVANCE_TAX_Q4', period: '2024-Q4', due_date: '2025-03-15', notes: 'Advance Tax Q4 FY2024-25: 100% of annual tax liability. Balance advance tax payment.' },
  );

  // TDS Quarterly Returns (26Q)
  filings.push(
    { id: `comp-tds-26q-q1-${orgId}-2024`, filing_type: 'TDS_RETURN_26Q', period: '2024-Q1', due_date: '2024-07-31', notes: 'TDS Return 26Q (Q1 Apr-Jun 2024): File quarterly TDS return for non-salary payments.' },
    { id: `comp-tds-26q-q2-${orgId}-2024`, filing_type: 'TDS_RETURN_26Q', period: '2024-Q2', due_date: '2024-10-31', notes: 'TDS Return 26Q (Q2 Jul-Sep 2024): File quarterly TDS return for non-salary payments.' },
    { id: `comp-tds-26q-q3-${orgId}-2024`, filing_type: 'TDS_RETURN_26Q', period: '2024-Q3', due_date: '2025-01-31', notes: 'TDS Return 26Q (Q3 Oct-Dec 2024): File quarterly TDS return for non-salary payments.' },
    { id: `comp-tds-26q-q4-${orgId}-2024`, filing_type: 'TDS_RETURN_26Q', period: '2024-Q4', due_date: '2025-05-31', notes: 'TDS Return 26Q (Q4 Jan-Mar 2025): File quarterly TDS return for non-salary payments.' },
  );

  // ROC Filings
  filings.push(
    { id: `comp-roc-aoc4-${orgId}-2024`, filing_type: 'ROC_AOC4', period: '2024-25', due_date: '2024-10-29', notes: 'ROC AOC-4: Annual financial statements filing with Registrar of Companies (within 30 days of AGM or Oct 29, whichever is earlier).' },
    { id: `comp-roc-mgt7-${orgId}-2024`, filing_type: 'ROC_MGT7', period: '2024-25', due_date: '2024-11-28', notes: 'ROC MGT-7: Annual return filing with Registrar of Companies (within 60 days of AGM or Nov 28, whichever is earlier).' },
  );

  // Bulk insert with computed status
  for (const filing of filings) {
    const computedStatus = computeFilingStatus(filing.due_date, 'upcoming', false);
    await db.query(
      `INSERT INTO compliance_filings (id, org_id, filing_type, period, due_date, status, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING;`,
      [filing.id, orgId, filing.filing_type, filing.period, filing.due_date, computedStatus, filing.notes]
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    await seedComplianceCalendarIfEmpty(auth.activeOrgId);

    const db = await getDb();

    // Re-compute live status for all filings based on current date
    const rows = await db.query(
      `SELECT id, org_id, filing_type, period, due_date, assigned_ca, status, reference_ack_number, notes
       FROM compliance_filings
       WHERE org_id = $1
       ORDER BY due_date ASC;`,
      [auth.activeOrgId]
    );

    const now = Date.now();
    const filings: ComplianceFiling[] = rows.rows.map((r: any) => {
      const dueTs = new Date(r.due_date).getTime();
      const daysUntilDue = Math.round((dueTs - now) / (1000 * 60 * 60 * 24));
      const liveStatus = computeFilingStatus(r.due_date, r.status, r.status === 'filed');

      return {
        id: r.id,
        org_id: r.org_id,
        filing_type: r.filing_type,
        period: r.period,
        due_date: r.due_date,
        assigned_ca: r.assigned_ca,
        status: liveStatus,
        reference_ack_number: r.reference_ack_number || null,
        notes: r.notes || null,
        days_until_due: daysUntilDue,
        is_overdue: liveStatus === 'overdue',
      };
    });

    // Summary stats
    const summary = {
      total: filings.length,
      overdue: filings.filter(f => f.status === 'overdue').length,
      pending_review: filings.filter(f => f.status === 'pending_review').length,
      upcoming: filings.filter(f => f.status === 'upcoming').length,
      filed: filings.filter(f => f.status === 'filed').length,
      approved: filings.filter(f => f.status === 'approved').length,
      critical_within_7_days: filings.filter(f => !f.is_overdue && f.days_until_due !== undefined && f.days_until_due >= 0 && f.days_until_due <= 7).length,
    };

    return NextResponse.json({ success: true, filings, summary });
  } catch (err: any) {
    console.error('[compliance/GET]', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    const body = await req.json();
    const { id, status, reference_ack_number, notes, assigned_ca } = body;

    if (!id) {
      return NextResponse.json({ success: false, error: 'Missing filing id' }, { status: 400 });
    }

    const db = await getDb();

    // Verify filing belongs to this org (tenant isolation)
    const existing = await db.query(
      'SELECT id, org_id, status FROM compliance_filings WHERE id = $1 AND org_id = $2;',
      [id, auth.activeOrgId]
    );

    if (existing.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Filing not found or access denied' }, { status: 404 });
    }

    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (status) {
      updates.push(`status = $${paramIndex++}`);
      values.push(status);
    }
    if (reference_ack_number !== undefined) {
      updates.push(`reference_ack_number = $${paramIndex++}`);
      values.push(reference_ack_number);
    }
    if (notes !== undefined) {
      updates.push(`notes = $${paramIndex++}`);
      values.push(notes);
    }
    if (assigned_ca !== undefined) {
      updates.push(`assigned_ca = $${paramIndex++}`);
      values.push(assigned_ca);
    }

    if (updates.length === 0) {
      return NextResponse.json({ success: false, error: 'No fields to update' }, { status: 400 });
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id, auth.activeOrgId);

    await db.query(
      `UPDATE compliance_filings SET ${updates.join(', ')} WHERE id = $${paramIndex++} AND org_id = $${paramIndex++};`,
      values
    );

    return NextResponse.json({ success: true, message: `Filing ${id} updated successfully` });
  } catch (err: any) {
    console.error('[compliance/POST]', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
