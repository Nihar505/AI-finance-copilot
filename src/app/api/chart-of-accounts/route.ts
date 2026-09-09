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
      `SELECT id, code, name, type, sub_type, description, is_active
       FROM chart_of_accounts
       WHERE org_id = $1
       ORDER BY code ASC;`,
      [orgId]
    );

    return NextResponse.json({ success: true, orgId, accounts: res.rows });
  } catch (error: any) {
    console.error('Chart of Accounts API Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
