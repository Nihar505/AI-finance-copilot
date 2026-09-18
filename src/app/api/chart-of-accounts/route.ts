import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getAuthContext, assertTenantAccess } from '@/lib/auth';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    const orgId = auth.activeOrgId;
    await assertTenantAccess(auth, orgId);
    const db = await getDb();

    const res = await db.query(
      `SELECT id, code, name, type, sub_type, description, is_active
       FROM chart_of_accounts
       WHERE org_id = $1
       ORDER BY code ASC;`,
      [orgId]
    );

    return NextResponse.json({ success: true, orgId, accounts: res.rows });
  } catch (error: any) {
    logger.error('Chart of Accounts API Error:', { route: '/api/chart-of-accounts', err: String(error) });
    const status = error.message?.includes('403 Forbidden') ? 403 : error.message?.includes('401') ? 401 : 500;
    return NextResponse.json({ success: false, error: error.message }, { status });
  }
}
