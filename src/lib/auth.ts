import { NextRequest, NextResponse } from 'next/server';
import { getDb } from './db';

export type UserRole = 'business_owner' | 'ca' | 'admin';

export interface AuthContext {
  userId: string;
  userName: string;
  userEmail: string;
  role: UserRole;
  activeOrgId: string;
  activeOrgName?: string;
  materialityThreshold?: number;
  suggestOnlyMode?: boolean;
}

export interface OrganizationInfo {
  id: string;
  name: string;
  legal_name: string;
  tax_id: string;
  currency: string;
  materiality_threshold: number;
  suggest_only_mode: boolean;
  role: UserRole;
}

export const DEFAULT_ORG_ID = 'org-apex-01';

/**
 * Resolves the authenticated user and their active organization context.
 * Evaluates headers (x-org-id, x-user-role, x-user-id), cookies, or query parameters.
 */
export async function getAuthContext(req?: NextRequest): Promise<AuthContext> {
  const db = await getDb();

  // 1. Determine active organization
  let orgId = req?.headers.get('x-org-id') || req?.nextUrl?.searchParams?.get('orgId') || DEFAULT_ORG_ID;
  
  // 2. Determine requested user / role override
  let requestedRole = req?.headers.get('x-user-role') as UserRole | null;
  let requestedUserId = req?.headers.get('x-user-id');

  // Verify org exists in database, fallback to first available if requested doesn't exist
  const orgRes = await db.query(
    `SELECT id, name, legal_name, tax_id, materiality_threshold, suggest_only_mode 
     FROM organizations WHERE id = $1;`,
    [orgId]
  );

  let org = orgRes.rows[0];
  if (!org) {
    const fallbackOrgRes = await db.query(
      `SELECT id, name, legal_name, tax_id, materiality_threshold, suggest_only_mode 
       FROM organizations ORDER BY created_at ASC LIMIT 1;`
    );
    if (fallbackOrgRes.rows.length > 0) {
      org = fallbackOrgRes.rows[0];
      orgId = org.id;
    } else {
      // Seed fallback default
      org = {
        id: DEFAULT_ORG_ID,
        name: 'Apex Global Advisory & Co.',
        materiality_threshold: 50000.00,
        suggest_only_mode: true
      };
      orgId = DEFAULT_ORG_ID;
    }
  }

  // 3. Resolve user details
  const effectiveRole: UserRole = requestedRole === 'business_owner' || requestedRole === 'admin' || requestedRole === 'ca'
    ? requestedRole
    : 'ca';

  const userMap: Record<UserRole, { id: string; name: string; email: string }> = {
    ca: {
      id: requestedUserId || 'user-lead-ca',
      name: 'Priya Sharma, FCA',
      email: 'priya.sharma@apexadvisory.com'
    },
    business_owner: {
      id: requestedUserId || 'user-business-owner',
      name: 'Rajesh Gupta (MD & Founder)',
      email: 'rajesh.gupta@zenithtech.io'
    },
    admin: {
      id: requestedUserId || 'user-admin',
      name: 'Vikram Seth (System Admin)',
      email: 'admin@financecopilot.internal'
    }
  };

  const user = userMap[effectiveRole];

  return {
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    role: effectiveRole,
    activeOrgId: orgId,
    activeOrgName: org.name,
    materialityThreshold: Number(org.materiality_threshold || 50000.00),
    suggestOnlyMode: org.suggest_only_mode !== false
  };
}

/**
 * Role-Based Access Control (RBAC) assertion guard.
 * Strictly prevents non-authorized roles from performing consequential actions.
 */
export function checkRoleAccess(auth: AuthContext, allowedRoles: UserRole[]): { allowed: boolean; reason?: string } {
  if (!allowedRoles.includes(auth.role)) {
    return {
      allowed: false,
      reason: `Access Denied: Action requires role [${allowedRoles.join(' or ')}]. Current role is [${auth.role}]. Under statutory compliance guidelines, business owners cannot unilaterally approve or post ledger adjustments without CA review.`
    };
  }
  return { allowed: true };
}

/**
 * Retrieves all accessible organizations for the active user (CA portfolio switcher).
 */
export async function getAccessibleOrganizations(userId?: string): Promise<OrganizationInfo[]> {
  const db = await getDb();
  const res = await db.query(
    `SELECT id, name, legal_name, tax_id, currency, 
            COALESCE(materiality_threshold, 50000.00) as materiality_threshold,
            COALESCE(suggest_only_mode, TRUE) as suggest_only_mode
     FROM organizations 
     ORDER BY name ASC;`
  );

  return res.rows.map(r => ({
    id: r.id,
    name: r.name,
    legal_name: r.legal_name || r.name,
    tax_id: r.tax_id || '',
    currency: r.currency || 'INR',
    materiality_threshold: Number(r.materiality_threshold),
    suggest_only_mode: Boolean(r.suggest_only_mode),
    role: 'ca' as UserRole
  }));
}
