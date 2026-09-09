import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getAuthContext, checkRoleAccess, getAccessibleOrganizations } from '@/lib/auth';
import { logAuditEvent } from '@/lib/auditLogger';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    const orgs = await getAccessibleOrganizations(auth.userId);
    return NextResponse.json({ success: true, organizations: orgs });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    // Only CA or Admin can create new client organizations
    const access = checkRoleAccess(auth, ['ca', 'admin']);
    if (!access.allowed) {
      return NextResponse.json({ success: false, error: access.reason }, { status: 403 });
    }

    const body = await req.json();
    const {
      name,
      legalName,
      taxId,
      currency = 'INR',
      fiscalYearStart = '04-01',
      materialityThreshold = 50000.00,
      suggestOnlyMode = true
    } = body;

    if (!name) {
      return NextResponse.json({ success: false, error: 'Organization name is required' }, { status: 400 });
    }

    const db = await getDb();
    const newId = `org-${name.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 20)}-${Date.now().toString().slice(-4)}`;

    await db.query(
      `INSERT INTO organizations (id, name, legal_name, tax_id, currency, fiscal_year_start, materiality_threshold, suggest_only_mode)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8);`,
      [newId, name, legalName || name, taxId || null, currency, fiscalYearStart, materialityThreshold, suggestOnlyMode]
    );

    // Associate current user with the new organization
    await db.query(
      `INSERT INTO user_organizations (user_id, org_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, org_id) DO NOTHING;`,
      [auth.userId, newId, auth.role]
    );

    await logAuditEvent({
      orgId: newId,
      userId: auth.userId,
      userName: auth.userName,
      action: 'CREATE_ORGANIZATION',
      entityType: 'organization',
      entityId: newId,
      explanation: `Onboarded new client organization "${name}" (GSTIN: ${taxId || 'N/A'}) with materiality threshold ₹${Number(materialityThreshold).toLocaleString()} and suggest-only mode: ${suggestOnlyMode}.`
    });

    return NextResponse.json({
      success: true,
      organization: {
        id: newId,
        name,
        legal_name: legalName || name,
        tax_id: taxId,
        currency,
        materiality_threshold: materialityThreshold,
        suggest_only_mode: suggestOnlyMode
      }
    });
  } catch (error: any) {
    logger.error('Error creating organization:', { route: '/api/organizations', err: String(error) });
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
