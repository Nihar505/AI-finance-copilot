import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getAuthContext } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    const orgId = auth.activeOrgId;
    const db = await getDb();

    const res = await db.query(
      `SELECT id, user_id, user_name, action, entity_type, entity_id, 
              before_state, after_state, explanation, timestamp
       FROM audit_logs
       WHERE org_id = $1
       ORDER BY timestamp DESC
       LIMIT 100;`,
      [orgId]
    );

    return NextResponse.json({
      success: true,
      orgId,
      logs: res.rows
    });
  } catch (error: any) {
    console.error('Audit Log API Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
