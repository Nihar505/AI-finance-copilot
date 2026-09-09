import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { createSessionToken, verifyPassword, SESSION_COOKIE_NAME, UserRole } from '@/lib/auth';
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
  const bodyParsed = await safeParseJson<{ email?: string; password?: string; persona?: UserRole }>(req);
  if (!bodyParsed.success || !bodyParsed.data) {
    return NextResponse.json({ success: false, error: bodyParsed.error || 'Invalid request body' }, { status: 400 });
  }

  const { email, password, persona } = bodyParsed.data;
  const db = await getDb();

  // Persona quick-switch (for interactive prototyping & demo)
  if (persona) {
    const validPersonas: Record<UserRole, { id: string; name: string; email: string; orgId: string }> = {
      ca: {
        id: 'user-lead-ca',
        name: 'Priya Sharma, FCA',
        email: 'priya.sharma@apexadvisory.com',
        orgId: 'org-apex-01'
      },
      business_owner: {
        id: 'user-business-owner',
        name: 'Rajesh Gupta (MD & Founder)',
        email: 'rajesh.gupta@zenithtech.io',
        orgId: 'org-zenith-02'
      },
      admin: {
        id: 'user-admin',
        name: 'Vikram Seth (System Admin)',
        email: 'admin@financecopilot.internal',
        orgId: 'org-apex-01'
      }
    };

    const target = validPersonas[persona];
    if (!target) {
      return NextResponse.json({ success: false, error: `Invalid persona: ${persona}` }, { status: 400 });
    }

    const token = createSessionToken({
      userId: target.id,
      userName: target.name,
      userEmail: target.email,
      role: persona,
      orgId: target.orgId
    });

    const response = NextResponse.json({
      success: true,
      user: { id: target.id, name: target.name, email: target.email, role: persona },
      activeOrgId: target.orgId,
      token
    });

    // Set secure HTTP-only cookie
    response.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 24 * 60 * 60 // 24 hours
    });

    return response;
  }

  // Email / Password Login
  if (!email || !password) {
    return NextResponse.json({ success: false, error: 'Email and password are required' }, { status: 400 });
  }

  const userRes = await db.query(
    `SELECT u.id, u.org_id, u.name, u.email, u.role, u.password_hash, u.is_active, o.name as org_name
     FROM users u
     LEFT JOIN organizations o ON u.org_id = o.id
     WHERE LOWER(u.email) = LOWER($1);`,
    [email.trim()]
  );

  const user = userRes.rows[0];
  if (!user || !user.is_active) {
    return NextResponse.json({ success: false, error: 'Invalid email or password' }, { status: 401 });
  }

  const isPasswordValid = verifyPassword(password, user.password_hash);
  if (!isPasswordValid) {
    return NextResponse.json({ success: false, error: 'Invalid email or password' }, { status: 401 });
  }

  const token = createSessionToken({
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    role: user.role as UserRole,
    orgId: user.org_id
  });

  const response = NextResponse.json({
    success: true,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
    },
    activeOrgId: user.org_id,
    token
  });

  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 24 * 60 * 60
  });

  return response;
}
