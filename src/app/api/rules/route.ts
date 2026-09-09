import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getAuthContext, checkRoleAccess } from '@/lib/auth';
import { logAuditEvent } from '@/lib/auditLogger';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    const orgId = auth.activeOrgId;
    const db = await getDb();

    const res = await db.query(
      `SELECT r.id, r.name, r.pattern, r.match_field, r.category_id, r.confidence, r.priority, r.is_active,
              c.name as category_name, c.code as category_code
       FROM categorization_rules r
       JOIN chart_of_accounts c ON r.category_id = c.id
       WHERE r.org_id = $1
       ORDER BY r.priority ASC, r.name ASC;`,
      [orgId]
    );

    return NextResponse.json({ success: true, orgId, rules: res.rows });
  } catch (error: any) {
    console.error('Rules API Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    // RBAC: Only CA or Admin can define accounting rules
    const access = checkRoleAccess(auth, ['ca', 'admin']);
    if (!access.allowed) {
      return NextResponse.json({ success: false, error: access.reason }, { status: 403 });
    }

    const orgId = auth.activeOrgId;
    const db = await getDb();
    const body = await req.json();
    const { name, pattern, match_field = 'description', category_id, confidence = 100 } = body;

    if (!name || !pattern || !category_id) {
      return NextResponse.json({ success: false, error: 'Name, pattern, and category_id are required' }, { status: 400 });
    }

    const id = `rule-${Date.now()}`;
    await db.query(
      `INSERT INTO categorization_rules (id, org_id, name, pattern, match_field, category_id, confidence, priority, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 1, TRUE);`,
      [id, orgId, name, pattern, match_field, category_id, confidence]
    );

    await logAuditEvent({
      orgId,
      userId: auth.userId,
      userName: auth.userName,
      action: 'APPROVE_CATEGORIZATION',
      entityType: 'rule',
      entityId: id,
      explanation: `Created new categorization rule "${name}" matching [${pattern}].`
    });

    return NextResponse.json({ success: true, id, message: 'Rule created successfully' });
  } catch (error: any) {
    console.error('Create Rule Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
