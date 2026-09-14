import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { createSessionToken, verifyPassword, SESSION_COOKIE_NAME, UserRole, normalizeRole } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
import { safeParseJson } from '@/lib/security';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  // 1. Rate Limiting: 10 attempts per minute per IP
  const clientIp = getClientIp(req.headers);
  const rateCheck = checkRateLimit('auth_login', clientIp, { limit: 10, windowSeconds: 60 });
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { success: false, error: `Too many login attempts. Please retry in ${rateCheck.resetSeconds} seconds.` },
      { status: 429, headers: { 'Retry-After': String(rateCheck.resetSeconds) } }
    );
  }

  // 2. Parse Request
  const bodyParsed = await safeParseJson<{ email?: string; password?: string; role?: string }>(req);
  if (!bodyParsed.success || !bodyParsed.data) {
    return NextResponse.json({ success: false, error: bodyParsed.error || 'Invalid request body' }, { status: 400 });
  }

  const { email, password, role } = bodyParsed.data;
  const db = await getDb();

  // Email & Password are required
  if (!email || !password) {
    return NextResponse.json({ success: false, error: 'Invalid email or password.' }, { status: 400 });
  }

  // 3. Database Lookup (Source of Truth)
  const userRes = await db.query(
    `SELECT u.id, u.org_id, u.name, u.email, u.role, u.password_hash, u.is_active, o.name as org_name
     FROM users u
     LEFT JOIN organizations o ON u.org_id = o.id
     WHERE LOWER(u.email) = LOWER($1);`,
    [email.trim()]
  );

  const user = userRes.rows[0];
  if (!user || !user.is_active) {
    return NextResponse.json({ success: false, error: 'Invalid email or password.' }, { status: 401 });
  }

  // Verify password hash
  const isPasswordValid = verifyPassword(password, user.password_hash);
  if (!isPasswordValid) {
    return NextResponse.json({ success: false, error: 'Invalid email or password.' }, { status: 401 });
  }

  // 4. Strict Role Verification: Backend is Authoritative
  const authoritativeUserRole = normalizeRole(user.role);
  if (role) {
    const requestedRole = normalizeRole(role);
    if (requestedRole !== authoritativeUserRole) {
      return NextResponse.json(
        { success: false, error: 'These credentials are not authorized for this access type.' },
        { status: 401 }
      );
    }
  }

  // 5. Create Cryptographically Signed HMAC-SHA256 Session
  const token = createSessionToken({
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    role: authoritativeUserRole,
    orgId: user.org_id
  });

  const response = NextResponse.json({
    success: true,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: authoritativeUserRole
    },
    activeOrgId: user.org_id
  });

  // 6. Set Secure HTTP-Only Cookie
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 24 * 60 * 60 // 24 hours
  });

  return response;
}
