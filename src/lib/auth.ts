import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDb } from './db';
import { normalizeRole } from './permissions';

export type UserRole = 'CA' | 'BUSINESS_OWNER' | 'FIRM_ADMIN';
export type LegacyRole = 'ca' | 'business_owner' | 'admin';
export type AnyRole = UserRole | LegacyRole;

export { normalizeRole } from './permissions';

export interface AuthContext {
  userId: string;
  userName: string;
  userEmail: string;
  role: UserRole | LegacyRole;
  activeOrgId: string;
  activeOrgName?: string;
  materialityThreshold?: number;
  suggestOnlyMode?: boolean;
  isAuthenticated?: boolean;
}

export interface OrganizationInfo {
  id: string;
  name: string;
  legal_name: string;
  tax_id: string;
  currency: string;
  materiality_threshold: number;
  suggest_only_mode: boolean;
  role: UserRole | string;
}

export interface SessionPayload {
  userId: string;
  userName: string;
  userEmail: string;
  role: UserRole | string;
  orgId: string;
  exp: number; // Unix epoch ms
}

export const DEFAULT_ORG_ID = 'org-apex-01';

// Validate SESSION_SECRET in production.
// Using a hardcoded fallback in production means all sessions share a public key — a critical security risk.
// We allow the build phase (e.g. Next.js collect page data) to succeed without runtime secrets.
const isBuildPhase =
  process.env.NEXT_PHASE === 'phase-production-build' ||
  process.env.npm_lifecycle_event === 'build';

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET && !isBuildPhase) {
  throw new Error(
    'FATAL: SESSION_SECRET environment variable must be set in production.\n' +
    'Generate a secure value with: openssl rand -hex 32\n' +
    'Then add SESSION_SECRET=<value> to your .env.local or hosting environment.'
  );
}

function getSessionSecret(): string {
  if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET && !isBuildPhase) {
    throw new Error('FATAL: SESSION_SECRET environment variable must be set in production.');
  }
  return process.env.SESSION_SECRET || 'ai-finance-copilot-dev-secret-hmac-key-2026';
}

export const SESSION_COOKIE_NAME = 'copilot_session';

/**
 * Creates a cryptographically signed HMAC-SHA256 session token.
 * Valid for 24 hours by default.
 */
export function createSessionToken(payload: Omit<SessionPayload, 'exp'>, ttlHours = 24): string {
  const fullPayload: SessionPayload = {
    ...payload,
    exp: Date.now() + ttlHours * 60 * 60 * 1000
  };
  const body = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', getSessionSecret())
    .update(body)
    .digest('base64url');
  return `${body}.${signature}`;
}

/**
 * Verifies the signature and expiration of an HMAC-SHA256 session token.
 */
export function verifySessionToken(token: string | null | undefined): SessionPayload | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [body, signature] = parts;
  const expectedSignature = crypto
    .createHmac('sha256', getSessionSecret())
    .update(body)
    .digest('base64url');

  // Constant-time comparison to prevent timing attacks
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSignature);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const payload: SessionPayload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (Date.now() > payload.exp) {
      return null; // Expired session
    }
    return payload;
  } catch {
    return null;
  }
}

/**
 * Deterministic password hashing using PBKDF2 with SHA-512.
 */
export function hashPassword(password: string, salt = 'salt_copilot_2026'): string {
  return crypto.pbkdf2Sync(password, salt, 10000, 32, 'sha512').toString('hex');
}

/**
 * Verifies a password against known hashes or PBKDF2 hashes.
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  // Support demo seeded hashes
  if (storedHash.startsWith('$2a$10$demoHashedPassword')) {
    if (storedHash.includes('SeniorCA') && (password === 'ApexCA@2026!' || password === 'password123')) return true;
    if (storedHash.includes('Owner') && (password === 'ZenithOwner@2026!' || password === 'password123')) return true;
    if (storedHash.includes('Admin') && (password === 'AdminSecure@2026!' || password === 'password123')) return true;
    // Also allow easy dev password
    if (password === 'password123') return true;
  }
  const computed = hashPassword(password);
  return computed === storedHash;
}

/**
 * Resolves the authenticated user and active organization context.
 * Evaluates:
 * 1. Cryptographic session cookie ('copilot_session') or Authorization Bearer header.
 * 2. If unauthenticated in development/testing, falls back gracefully to headers or defaults,
 *    while still enforcing strict tenant boundaries.
 * 
 * SECURITY: If verifiedSession exists, effectiveRole is AUTHORITATIVE from the session.
 * Headers like x-user-role are completely ignored when a session is active.
 */
export async function getAuthContext(req?: NextRequest): Promise<AuthContext> {
  const db = await getDb();

  // 1. Check for cryptographic session token
  let token: string | undefined;
  if (req) {
    const cookieVal = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (cookieVal) {
      token = cookieVal;
    } else {
      const authHeader = req.headers.get('authorization');
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7).trim();
      }
    }
  }

  const verifiedSession = token ? verifySessionToken(token) : null;

  // 2. Resolve Active Organization ID
  let orgId = req?.headers.get('x-org-id') || req?.nextUrl?.searchParams?.get('orgId');
  if (!orgId) {
    orgId = verifiedSession ? verifiedSession.orgId : DEFAULT_ORG_ID;
  }

  // 3. Resolve Role and User
  let effectiveRole: UserRole;
  let effectiveUserId: string;
  let effectiveUserName: string;
  let effectiveUserEmail: string;

  if (verifiedSession) {
    // SESSION IS SOURCE OF TRUTH: Never allow client headers to override verified session
    effectiveRole = normalizeRole(verifiedSession.role);
    effectiveUserId = verifiedSession.userId;
    effectiveUserName = verifiedSession.userName;
    effectiveUserEmail = verifiedSession.userEmail;
  } else {
    // Fallback for unauthenticated dev/test requests
    const rawRole = req?.headers.get('x-user-role');
    effectiveRole = rawRole ? normalizeRole(rawRole) : 'CA';
    effectiveUserId = req?.headers.get('x-user-id') || 'user-lead-ca';
    effectiveUserName = '';
    effectiveUserEmail = '';
  }

  // 4. Verify organization exists
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
      org = {
        id: DEFAULT_ORG_ID,
        name: 'Apex Global Advisory & Co.',
        materiality_threshold: 50000.00,
        suggest_only_mode: true
      };
      orgId = DEFAULT_ORG_ID;
    }
  }

  // 5. Populate default profile names if not coming from session
  if (!effectiveUserName) {
    const userMap: Record<UserRole, { id: string; name: string; email: string }> = {
      CA: {
        id: effectiveUserId || 'user-lead-ca',
        name: 'Priya Sharma, FCA',
        email: 'priya.sharma@apexadvisory.com'
      },
      BUSINESS_OWNER: {
        id: effectiveUserId || 'user-business-owner',
        name: 'Rajesh Gupta (MD & Founder)',
        email: 'rajesh.gupta@zenithtech.io'
      },
      FIRM_ADMIN: {
        id: effectiveUserId || 'user-admin',
        name: 'Vikram Seth (System Admin)',
        email: 'admin@financecopilot.internal'
      }
    };
    const mapped = userMap[effectiveRole];
    effectiveUserId = mapped.id;
    effectiveUserName = mapped.name;
    effectiveUserEmail = mapped.email;
  }

  return {
    userId: effectiveUserId || 'user-lead-ca',
    userName: effectiveUserName,
    userEmail: effectiveUserEmail,
    role: effectiveRole,
    activeOrgId: orgId || DEFAULT_ORG_ID,
    activeOrgName: org.name,
    materialityThreshold: Number(org.materiality_threshold || 50000.00),
    suggestOnlyMode: org.suggest_only_mode !== false,
    isAuthenticated: verifiedSession !== null
  };
}

/**
 * Strict Multi-Tenant Authorization Guard.
 * Asserts that the authenticated user possesses legitimate access to targetOrgId.
 * Business owners can strictly only access their own organization.
 */
export async function assertTenantAccess(auth: AuthContext, targetOrgId: string): Promise<void> {
  // In production every data access must originate from a verified session.  The
  // development/test fallback in getAuthContext exists solely for local fixtures.
  if (process.env.NODE_ENV === 'production' && !auth.isAuthenticated) {
    throw new Error('401 Unauthorized: Authentication required.');
  }

  const normRole = normalizeRole(auth.role);
  if (normRole === 'FIRM_ADMIN') return; // Admins have global maintenance rights

  const db = await getDb();
  // Never trust auth.activeOrgId here: it can be selected through a request
  // header for an authorized CA client switch.  Membership is the authority.
  const membership = await db.query(
    `SELECT 1 FROM user_organizations WHERE user_id = $1 AND org_id = $2;`,
    [auth.userId, targetOrgId]
  );

  if (membership.rows.length === 0) {
    throw new Error(`403 Forbidden: Tenant Isolation Violation. User [${auth.userId}] is not authorized to access organization [${targetOrgId}].`);
  }
}

/**
 * Role-Based Access Control (RBAC) assertion guard.
 * Strictly prevents non-authorized roles from performing consequential actions.
 */
export function checkRoleAccess(auth: AuthContext, allowedRoles: (UserRole | string)[]): { allowed: boolean; reason?: string } {
  const normUserRole = normalizeRole(auth.role);
  const normAllowedRoles = allowedRoles.map(r => normalizeRole(r));

  if (!normAllowedRoles.includes(normUserRole)) {
    return {
      allowed: false,
      reason: `Access Denied: Action requires role [${allowedRoles.join(' or ')}]. Current role is [${auth.role}]. Under statutory compliance guidelines, business owners cannot unilaterally approve or post ledger adjustments without CA review.`
    };
  }
  return { allowed: true };
}

/**
 * Retrieves all accessible organizations for the active user.
 * CAs/Admins can see their full client portfolio; Business Owners are strictly limited to their own org.
 */
export async function getAccessibleOrganizations(userId?: string, userRole?: UserRole | string): Promise<OrganizationInfo[]> {
  const db = await getDb();
  const normRole = userRole ? normalizeRole(userRole) : undefined;
  
  // A CA can work across a portfolio, but only across organizations explicitly
  // assigned to that user. Firm admins retain their separate global maintenance
  // role below.
  if (userId && normRole !== 'FIRM_ADMIN') {
    const res = await db.query(
      `SELECT o.id, o.name, o.legal_name, o.tax_id, o.currency, 
              COALESCE(o.materiality_threshold, 50000.00) as materiality_threshold,
              COALESCE(o.suggest_only_mode, TRUE) as suggest_only_mode
       FROM organizations o
       JOIN user_organizations uo ON uo.org_id = o.id
       WHERE uo.user_id = $1
       ORDER BY o.name ASC;`,
      [userId]
    );
    return res.rows.map(r => ({
      id: r.id,
      name: r.name,
      legal_name: r.legal_name || r.name,
      tax_id: r.tax_id || '',
      currency: r.currency || 'INR',
      materiality_threshold: Number(r.materiality_threshold),
      suggest_only_mode: Boolean(r.suggest_only_mode),
      role: (normRole || 'CA') as UserRole
    }));
  }

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
    role: (normRole || 'CA') as UserRole
  }));
}
