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
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));
    const offset = (page - 1) * limit;

    const countRes = await db.query(
      `SELECT COUNT(*) as total FROM audit_logs WHERE org_id = $1;`,
      [orgId]
    );
    const totalCount = Number(countRes.rows[0]?.total || 0);

    const res = await db.query(
      `SELECT id, user_id, user_name, action, entity_type, entity_id, 
              before_state, after_state, explanation, timestamp
       FROM audit_logs
       WHERE org_id = $1
       ORDER BY timestamp DESC
       LIMIT $2 OFFSET $3;`,
      [orgId, limit, offset]
    );

    return NextResponse.json({
      success: true,
      orgId,
      totalCount,
      page,
      limit,
      logs: res.rows
    });
  } catch (error: any) {
    logger.error('Audit Log API Error:', { route: '/api/audit-log', err: String(error) });
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
