import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getAuthContext, checkRoleAccess, assertTenantAccess } from '@/lib/auth';
import { logAuditEvent } from '@/lib/auditLogger';
import { safeParseJson } from '@/lib/security';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    const orgId = auth.activeOrgId;
    await assertTenantAccess(auth, orgId);

    const db = await getDb();
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status') || 'all';

    let sql = `
      SELECT id, entity_type, entity_id, exception_type, severity, explanation, status, 
             resolved_by, resolved_at, resolution_notes, created_at
      FROM exceptions
      WHERE org_id = $1
    `;
    const params: any[] = [orgId];

    if (status === 'open') {
      sql += ` AND status = 'open'`;
    } else if (status === 'resolved') {
      sql += ` AND status != 'open'`;
    }

    sql += ` ORDER BY 
      CASE severity 
        WHEN 'critical' THEN 1 
        WHEN 'high' THEN 2 
        WHEN 'medium' THEN 3 
        ELSE 4 
      END ASC, created_at DESC;`;

    const res = await db.query(sql, params);
    return NextResponse.json({ success: true, orgId, exceptions: res.rows });
  } catch (error: any) {
    logger.error('Exceptions GET error', { route: '/api/exceptions', err: String(error) });
    const status = error.message?.includes('403 Forbidden') ? 403 : 500;
    return NextResponse.json({ success: false, error: error.message }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    const orgId = auth.activeOrgId;
    await assertTenantAccess(auth, orgId);

    // RBAC: Only CA or Admin can resolve or dismiss risk exceptions
    const access = checkRoleAccess(auth, ['ca', 'admin']);
    if (!access.allowed) {
      return NextResponse.json({ success: false, error: access.reason }, { status: 403 });
    }

    const bodyParsed = await safeParseJson<any>(req);
    if (!bodyParsed.success || !bodyParsed.data) {
      return NextResponse.json({ success: false, error: bodyParsed.error || 'Invalid JSON body' }, { status: 400 });
    }

    const { exceptionId, decision, notes = '' } = bodyParsed.data;

    if (!exceptionId || !decision) {
      return NextResponse.json({ success: false, error: 'exceptionId and decision required' }, { status: 400 });
    }

    const db = await getDb();

    const excRes = await db.query(`SELECT * FROM exceptions WHERE id = $1 AND org_id = $2;`, [exceptionId, orgId]);
    if (excRes.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Exception not found' }, { status: 404 });
    }

    const exc = excRes.rows[0];
    const newStatus = decision === 'dismiss' ? 'dismissed' : 'resolved';

    await db.query(
      `UPDATE exceptions 
       SET status = $1, resolved_by = $2, resolved_at = CURRENT_TIMESTAMP, resolution_notes = $3
       WHERE id = $4 AND org_id = $5;`,
      [newStatus, auth.userId, notes, exceptionId, orgId]
    );

    await logAuditEvent({
      orgId,
      userId: auth.userId,
      userName: auth.userName,
      action: 'RESOLVE_EXCEPTION',
      entityType: 'exception',
      entityId: exceptionId,
      beforeState: { status: exc.status, severity: exc.severity, type: exc.exception_type },
      afterState: { status: newStatus, notes },
      explanation: `Reviewer ${decision === 'dismiss' ? 'dismissed' : 'resolved'} exception #${exceptionId} (${exc.exception_type}): ${notes || 'Action confirmed'}`
    });

    return NextResponse.json({ success: true, message: `Exception marked as ${newStatus}` });
  } catch (error: any) {
    logger.error('Resolve Exception API Error:', { route: '/api/exceptions', err: String(error) });
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
