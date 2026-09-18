import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, assertTenantAccess, checkRoleAccess } from '@/lib/auth';
import { runCategorizationBatch } from '@/lib/categorizationEngine';
import { runReconciliationBatch } from '@/lib/reconciliationEngine';
import { runExceptionDetection } from '@/lib/exceptionEngine';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    const orgId = auth.activeOrgId;

    await assertTenantAccess(auth, orgId);

    const roleCheck = checkRoleAccess(auth, ['ca', 'admin']);
    if (!roleCheck.allowed) {
      return NextResponse.json({ success: false, error: roleCheck.reason }, { status: 403 });
    }

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
    logger.error('Process API Error:', { route: '/api/transactions/process', err: String(error) });
    const status = error.message?.includes('403 Forbidden') ? 403 : error.message?.includes('401') ? 401 : 500;
    return NextResponse.json({ success: false, error: error.message }, { status });
  }
}
