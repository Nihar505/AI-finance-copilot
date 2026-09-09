import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, getAccessibleOrganizations } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    const organizations = await getAccessibleOrganizations(auth.userId);

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
    console.error('Error fetching auth context:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
