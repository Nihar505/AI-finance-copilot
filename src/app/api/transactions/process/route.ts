import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth';
import { runCategorizationBatch } from '@/lib/categorizationEngine';
import { runReconciliationBatch } from '@/lib/reconciliationEngine';
import { runExceptionDetection } from '@/lib/exceptionEngine';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    const orgId = auth.activeOrgId;

    const categorized = await runCategorizationBatch(orgId);
    const reconciled = await runReconciliationBatch(orgId);
    const exceptions = await runExceptionDetection(orgId);

    return NextResponse.json({
      success: true,
      orgId,
      categorized,
      reconciled,
      exceptions
    });
  } catch (error: any) {
    console.error('Process API Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
