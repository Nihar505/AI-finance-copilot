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
 * Hashes a password using PBKDF2 with SHA-512 and a random cryptographic salt.
 * Returns standard format: pbkdf2$<iterations>$<saltHex>$<derivedKeyHex>
 * For legacy deterministic compatibility (when salt is passed), uses supplied salt.
 */
export function hashPassword(password: string, salt?: string, iterations = 100000): string {
  if (salt) {
    return crypto.pbkdf2Sync(password, salt, 10000, 32, 'sha512').toString('hex');
  }
  const randomSalt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.pbkdf2Sync(password, randomSalt, iterations, 32, 'sha512').toString('hex');
  return `pbkdf2$${iterations}$${randomSalt}$${derivedKey}`;
}

/**
 * Strictly verifies a password against its stored cryptographic hash using timing-safe comparison.
 * Zero backdoors or demo string bypasses.
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  if (!password || !storedHash) return false;

  try {
    if (storedHash.startsWith('pbkdf2$')) {
      const parts = storedHash.split('$');
      if (parts.length !== 4) return false;
      const iterations = parseInt(parts[1], 10);
      const salt = parts[2];
      const expectedKey = parts[3];
      if (isNaN(iterations) || !salt || !expectedKey) return false;

      const derivedKey = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha512').toString('hex');
      const a = Buffer.from(derivedKey, 'hex');
      const b = Buffer.from(expectedKey, 'hex');
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    }

    // Legacy fixed-salt PBKDF2 verification (for existing test suites / pre-seeded hashes)
    const computed = hashPassword(password, 'salt_copilot_2026');
    const a = Buffer.from(computed, 'hex');
    const b = Buffer.from(storedHash, 'hex');
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Resolves the authenticated user and active organization context.
 * Evaluates:
 * 1. Cryptographic session cookie ('copilot_session') or Authorization Bearer header.
 * 2. Enforces strict tenant boundary validation on any requested orgId.
 * 3. Never falls back to arbitrary organizations in production.
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

  // In production, unauthenticated requests are strictly prohibited
  if (process.env.NODE_ENV === 'production' && !verifiedSession) {
    throw new Error('401 Unauthorized: Authentication required.');
  }

  // 2. Resolve Role, User and Requested Org
  let effectiveRole: UserRole;
  let effectiveUserId: string;
  let effectiveUserName: string;
  let effectiveUserEmail: string;
  let requestedOrgId: string | null = null;

  if (verifiedSession) {
    effectiveRole = normalizeRole(verifiedSession.role);
    effectiveUserId = verifiedSession.userId;
    effectiveUserName = verifiedSession.userName;
    effectiveUserEmail = verifiedSession.userEmail;
    // Business owners are strictly locked to their own tenant; ignore any spoofed header or query params.
    if (effectiveRole === 'BUSINESS_OWNER') {
      requestedOrgId = verifiedSession.orgId;
    } else {
      requestedOrgId = req?.headers.get('x-org-id') || req?.nextUrl?.searchParams?.get('orgId') || verifiedSession.orgId;
    }
  } else {
    // Development / test runner fallback
    const rawRole = req?.headers.get('x-user-role');
    effectiveRole = rawRole ? normalizeRole(rawRole) : 'CA';
    effectiveUserId = req?.headers.get('x-user-id') || 'user-lead-ca';
    effectiveUserName = '';
    effectiveUserEmail = '';
    requestedOrgId = req?.headers.get('x-org-id') || req?.nextUrl?.searchParams?.get('orgId') || DEFAULT_ORG_ID;
  }

  const targetOrgId = requestedOrgId || DEFAULT_ORG_ID;

  // 3. Verify User Membership in Requested Organization (if authenticated)
  if (effectiveRole !== 'FIRM_ADMIN' && effectiveUserId) {
    const memRes = await db.query(
      `SELECT 1 FROM user_organizations WHERE user_id = $1 AND org_id = $2;`,
      [effectiveUserId, targetOrgId]
    );
    if (memRes.rows.length === 0) {
      throw new Error(`403 Forbidden: Tenant Isolation Violation. User [${effectiveUserId}] is not authorized to access organization [${targetOrgId}].`);
    }
  }

  // 4. Verify organization exists in database
  const orgRes = await db.query(
    `SELECT id, name, legal_name, tax_id, materiality_threshold, suggest_only_mode 
     FROM organizations WHERE id = $1;`,
    [targetOrgId]
  );

  const org = orgRes.rows[0];
  if (!org) {
    throw new Error(`404 Not Found: Organization [${targetOrgId}] does not exist.`);
  }

  // 5. Populate profile data if empty
  if (!effectiveUserName && effectiveUserId) {
    const userRes = await db.query(
      `SELECT name, email, role FROM users WHERE id = $1;`,
      [effectiveUserId]
    );
    if (userRes.rows.length > 0) {
      effectiveUserName = userRes.rows[0].name;
      effectiveUserEmail = userRes.rows[0].email;
    } else {
      effectiveUserName = 'Authorized User';
      effectiveUserEmail = `${effectiveUserId}@financecopilot.internal`;
    }
  }

  return {
    userId: effectiveUserId || 'user-lead-ca',
    userName: effectiveUserName,
    userEmail: effectiveUserEmail,
    role: effectiveRole,
    activeOrgId: targetOrgId,
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
