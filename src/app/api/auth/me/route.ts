import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, getAccessibleOrganizations } from '@/lib/auth';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    const organizations = await getAccessibleOrganizations(auth.userId, auth.role);

    return NextResponse.json({
      success: true,
      user: {
        id: auth.userId,
        name: auth.userName,
        email: auth.userEmail,
        role: auth.role
      },
      activeOrganization: {
        id: auth.activeOrgId,
        name: auth.activeOrgName,
        materialityThreshold: auth.materialityThreshold,
        suggestOnlyMode: auth.suggestOnlyMode
      },
      organizations
    });
  } catch (error: any) {
    logger.error('Error fetching auth context:', { route: '/api/auth/me', err: String(error) });
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
