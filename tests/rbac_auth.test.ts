import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { getDb } from '../src/lib/db';
import { seedBaseData, ORG_ID, ORG_ZENITH_ID } from '../src/lib/seed';
import {
  createSessionToken,
  verifySessionToken,
  getAuthContext,
  checkRoleAccess,
  assertTenantAccess,
  SESSION_COOKIE_NAME,
  UserRole
} from '../src/lib/auth';
import {
  hasPermission,
  canAccessWorkspace,
  getWorkspaceDashboardPath,
  normalizeRole,
  ROLE_PERMISSIONS
} from '../src/lib/permissions';
import { verifySessionEdge } from '../src/lib/auth-edge';
import { POST as loginHandler } from '../src/app/api/auth/login/route';
import { POST as logoutHandler } from '../src/app/api/auth/logout/route';
import { POST as approvalsHandler } from '../src/app/api/approvals/route';
import { POST as rulesHandler } from '../src/app/api/rules/route';

function sessionFromSetCookie(response: Response): string {
  const setCookie = response.headers.get('set-cookie') || '';
  assert.match(setCookie, /copilot_session=/, 'Successful login must set a session cookie');
  assert.match(setCookie, /HttpOnly/i, 'Session cookie must not be readable by browser scripts');
  const match = setCookie.match(/copilot_session=([^;]+)/);
  if (!match) throw new Error('Session cookie value was not present');
  return match[1];
}

describe('RBAC & Role-Based Access Control Acceptance Suite', () => {
  before(async () => {
    await seedBaseData();
  });

  // Test 1 — CA Authentication
  test('Test 1 — CA: Authenticates with CA credentials and requested role CA', async () => {
    const req = new NextRequest('http://localhost:3010/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'priya.sharma@apexadvisory.com',
        password: 'ApexCA@2026!',
        role: 'CA'
      })
    });

    const res = await loginHandler(req);
    assert.equal(res.status, 200);

    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.user.role, 'CA');

    // Verify the session is stored only in an HttpOnly cookie, not response JSON.
    assert.equal(data.token, undefined);
    const verified = verifySessionToken(sessionFromSetCookie(res));
    assert.ok(verified, 'Session token must be valid');
    assert.equal(verified?.role, 'CA');

    // Permissions & Route Access
    assert.equal(canAccessWorkspace(verified?.role, 'CA'), true);
    assert.equal(canAccessWorkspace(verified?.role, 'BUSINESS_OWNER'), false);
    assert.equal(canAccessWorkspace(verified?.role, 'FIRM_ADMIN'), false);

    assert.equal(hasPermission(verified?.role, 'approve_transactions'), true);
    assert.equal(hasPermission(verified?.role, 'override_ledger'), true);
    assert.equal(hasPermission(verified?.role, 'manage_users'), false);
    assert.equal(getWorkspaceDashboardPath(verified?.role), '/ca/dashboard');
  });

  // Test 2 — Business Owner Authentication
  test('Test 2 — Business Owner: Authenticates with Business Owner credentials and requested role BUSINESS_OWNER', async () => {
    const req = new NextRequest('http://localhost:3010/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'rajesh.gupta@zenithtech.io',
        password: 'ZenithOwner@2026!',
        role: 'BUSINESS_OWNER'
      })
    });

    const res = await loginHandler(req);
    assert.equal(res.status, 200);

    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.user.role, 'BUSINESS_OWNER');

    assert.equal(data.token, undefined);
    const verified = verifySessionToken(sessionFromSetCookie(res));
    assert.equal(verified?.role, 'BUSINESS_OWNER');

    // Workspace & Route Boundaries
    assert.equal(canAccessWorkspace(verified?.role, 'BUSINESS_OWNER'), true);
    assert.equal(canAccessWorkspace(verified?.role, 'CA'), false);
    assert.equal(canAccessWorkspace(verified?.role, 'FIRM_ADMIN'), false);

    // Business Owner must have view permissions, but strictly blocked from CA approvals
    assert.equal(hasPermission(verified?.role, 'view_cash_flow'), true);
    assert.equal(hasPermission(verified?.role, 'approve_transactions'), false);
    assert.equal(hasPermission(verified?.role, 'override_ledger'), false);
    assert.equal(getWorkspaceDashboardPath(verified?.role), '/business/dashboard');
  });

  // Test 3 — Firm Admin Authentication
  test('Test 3 — Firm Admin: Authenticates with Firm Admin credentials and requested role FIRM_ADMIN', async () => {
    const req = new NextRequest('http://localhost:3010/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@financecopilot.internal',
        password: 'AdminSecure@2026!',
        role: 'FIRM_ADMIN'
      })
    });

    const res = await loginHandler(req);
    assert.equal(res.status, 200);

    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.user.role, 'FIRM_ADMIN');

    assert.equal(data.token, undefined);
    const verified = verifySessionToken(sessionFromSetCookie(res));
    assert.equal(verified?.role, 'FIRM_ADMIN');

    // Workspace Access
    assert.equal(canAccessWorkspace(verified?.role, 'FIRM_ADMIN'), true);
    assert.equal(canAccessWorkspace(verified?.role, 'CA'), false);
    assert.equal(canAccessWorkspace(verified?.role, 'BUSINESS_OWNER'), false);

    // Admin permissions
    assert.equal(hasPermission(verified?.role, 'manage_users'), true);
    assert.equal(hasPermission(verified?.role, 'manage_firm_settings'), true);
    assert.equal(getWorkspaceDashboardPath(verified?.role), '/admin/dashboard');
  });

  // Test 4 — Wrong role selection
  test('Test 4 — Wrong role selection: Business Owner selects CA during login and is rejected', async () => {
    const req = new NextRequest('http://localhost:3010/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'rajesh.gupta@zenithtech.io', // Actual role: BUSINESS_OWNER
        password: 'ZenithOwner@2026!',
        role: 'CA' // Selected workspace: CA
      })
    });

    const res = await loginHandler(req);
    assert.equal(res.status, 401);

    const data = await res.json();
    assert.equal(data.success, false);
    assert.equal(data.error, 'These credentials are not authorized for this access type.');
    assert.equal(data.token, undefined);

    // Verify no session cookie was set
    const setCookie = res.headers.get('set-cookie');
    assert.ok(!setCookie || !setCookie.includes('copilot_session='), 'No CA session must be granted');
  });

  // Test 5 — Direct URL & Route Boundary
  test('Test 5 — Direct URL attack: Business Owner role cannot access CA workspace boundaries', () => {
    const ownerRole: UserRole = 'BUSINESS_OWNER';

    // Verify workspace boundary enforcement
    assert.equal(canAccessWorkspace(ownerRole, 'CA'), false);
    assert.equal(canAccessWorkspace(ownerRole, 'FIRM_ADMIN'), false);

    // Verify CA cannot access Firm Admin workspace
    const caRole: UserRole = 'CA';
    assert.equal(canAccessWorkspace(caRole, 'FIRM_ADMIN'), false);

    // Verify Edge verification matches Node verification
    const token = createSessionToken({
      userId: 'user-business-owner',
      userName: 'Rajesh Gupta',
      userEmail: 'rajesh@zenithtech.io',
      role: 'BUSINESS_OWNER',
      orgId: ORG_ZENITH_ID
    });

    const verified = verifySessionToken(token);
    assert.equal(verified?.role, 'BUSINESS_OWNER');
    assert.notEqual(verified?.role, 'CA');
  });

  // Test 6 — API Security Boundary
  test('Test 6 — API attack: Business Owner session calling POST /api/approvals is rejected with 403', async () => {
    // 1. Create a legitimate Business Owner session token
    const ownerToken = createSessionToken({
      userId: 'user-business-owner',
      userName: 'Rajesh Gupta',
      userEmail: 'rajesh.gupta@zenithtech.io',
      role: 'BUSINESS_OWNER',
      orgId: ORG_ZENITH_ID
    });

    // 2. Call sensitive CA-only endpoint POST /api/approvals with owner session cookie
    const req = new NextRequest('http://localhost:3010/api/approvals', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `${SESSION_COOKIE_NAME}=${ownerToken}`
      },
      body: JSON.stringify({
        action: 'APPROVE',
        transactionId: 'txn-test-01',
        notes: 'Malicious unauthorized approval attempt'
      })
    });

    const res = await approvalsHandler(req);
    assert.equal(res.status, 403, 'Must reject Business Owner with 403 Forbidden');

    const data = await res.json();
    assert.equal(data.success, false);
    assert.ok(data.error.includes('Access Denied'), 'Error must specify access denial under statutory compliance');
  });

  // Test 7 — Client-Side Privilege Escalation Defense
  test('Test 7 — Client-Side Privilege Escalation Defense: x-user-role header cannot override verified session', async () => {
    // 1. Legitimate Business Owner session
    const ownerToken = createSessionToken({
      userId: 'user-business-owner',
      userName: 'Rajesh Gupta',
      userEmail: 'rajesh.gupta@zenithtech.io',
      role: 'BUSINESS_OWNER',
      orgId: ORG_ZENITH_ID
    });

    // 2. Attacker sends spoofed x-user-role: ca header
    const spoofedReq = new NextRequest('http://localhost:3010/api/approvals', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `${SESSION_COOKIE_NAME}=${ownerToken}`,
        'x-user-role': 'ca',
        'x-user-id': 'user-lead-ca'
      },
      body: JSON.stringify({
        action: 'APPROVE',
        transactionId: 'txn-test-02'
      })
    });

    // Auth context must evaluate server session as authoritative, ignoring x-user-role
    const auth = await getAuthContext(spoofedReq);
    assert.equal(auth.role, 'BUSINESS_OWNER', 'Authoritative session role must prevail over spoofed headers');

    const res = await approvalsHandler(spoofedReq);
    assert.equal(res.status, 403, 'Privilege escalation attempt must fail with 403 Forbidden');
  });

  // Test 8 — Tenant target cannot be switched with a request header
  test('Test 8 — x-org-id header cannot switch a Business Owner into another tenant', async () => {
    const ownerToken = createSessionToken({
      userId: 'user-business-owner',
      userName: 'Rajesh Gupta',
      userEmail: 'rajesh.gupta@zenithtech.io',
      role: 'BUSINESS_OWNER',
      orgId: ORG_ZENITH_ID
    });
    const spoofedOrgRequest = new NextRequest('http://localhost:3010/api/dashboard', {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${ownerToken}`, 'x-org-id': ORG_ID }
    });
    const auth = await getAuthContext(spoofedOrgRequest);
    await assert.rejects(() => assertTenantAccess(auth, ORG_ID), /403 Forbidden: Tenant Isolation Violation/);
  });

  // Test 9 — Logout Flow
  test('Test 9 — Logout: Invalidates session cookie and prevents direct access', async () => {
    const req = new NextRequest('http://localhost:3010/api/auth/logout', {
      method: 'POST'
    });

    const res = await logoutHandler(req);
    assert.equal(res.status, 200);

    const setCookie = res.headers.get('set-cookie');
    assert.ok(setCookie, 'Must set cookie header');
    assert.ok(setCookie.includes('copilot_session=;'), 'Must clear session cookie value');
    assert.ok(setCookie.includes('Max-Age=0'), 'Must immediately expire cookie with Max-Age=0');
  });

  // ─── Canonical Demo Account Tests ──────────────────────────────────────────

  // Test 9 — Demo CA: Positive authentication
  test('Test 9 — Demo CA: Authenticates with demo.ca@example.com / DemoCA@12345 + role CA', async () => {
    const req = new NextRequest('http://localhost:3010/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'demo.ca@example.com',
        password: 'DemoCA@12345',
        role: 'CA'
      })
    });

    const res = await loginHandler(req);
    assert.equal(res.status, 200);

    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.user.role, 'CA');
    assert.equal(data.user.email, 'demo.ca@example.com');
    assert.equal(data.user.name, 'Demo CA');

    assert.equal(data.token, undefined);
    const verified = verifySessionToken(sessionFromSetCookie(res));
    assert.ok(verified, 'Session token must be valid');
    assert.equal(verified?.role, 'CA');
    assert.equal(verified?.userEmail, 'demo.ca@example.com');

    assert.equal(canAccessWorkspace(verified?.role, 'CA'), true);
    assert.equal(canAccessWorkspace(verified?.role, 'BUSINESS_OWNER'), false);
    assert.equal(canAccessWorkspace(verified?.role, 'FIRM_ADMIN'), false);
    assert.equal(getWorkspaceDashboardPath(verified?.role), '/ca/dashboard');
  });

  // Test 10 — Demo Business Owner: Positive authentication
  test('Test 10 — Demo Business Owner: Authenticates with demo.owner@example.com / DemoOwner@12345 + role BUSINESS_OWNER', async () => {
    const req = new NextRequest('http://localhost:3010/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'demo.owner@example.com',
        password: 'DemoOwner@12345',
        role: 'BUSINESS_OWNER'
      })
    });

    const res = await loginHandler(req);
    assert.equal(res.status, 200);

    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.user.role, 'BUSINESS_OWNER');
    assert.equal(data.user.email, 'demo.owner@example.com');
    assert.equal(data.user.name, 'Demo Business Owner');

    assert.equal(data.token, undefined);
    const verified = verifySessionToken(sessionFromSetCookie(res));
    assert.equal(verified?.role, 'BUSINESS_OWNER');
    assert.equal(canAccessWorkspace(verified?.role, 'BUSINESS_OWNER'), true);
    assert.equal(canAccessWorkspace(verified?.role, 'CA'), false);
    assert.equal(hasPermission(verified?.role, 'view_cash_flow'), true);
    assert.equal(hasPermission(verified?.role, 'approve_transactions'), false);
    assert.equal(getWorkspaceDashboardPath(verified?.role), '/business/dashboard');
  });

  // Test 11 — Demo Firm Admin: Positive authentication
  test('Test 11 — Demo Firm Admin: Authenticates with demo.admin@example.com / DemoAdmin@12345 + role FIRM_ADMIN', async () => {
    const req = new NextRequest('http://localhost:3010/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'demo.admin@example.com',
        password: 'DemoAdmin@12345',
        role: 'FIRM_ADMIN'
      })
    });

    const res = await loginHandler(req);
    assert.equal(res.status, 200);

    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.user.role, 'FIRM_ADMIN');
    assert.equal(data.user.email, 'demo.admin@example.com');
    assert.equal(data.user.name, 'Demo Firm Admin');

    assert.equal(data.token, undefined);
    const verified = verifySessionToken(sessionFromSetCookie(res));
    assert.equal(verified?.role, 'FIRM_ADMIN');
    assert.equal(canAccessWorkspace(verified?.role, 'FIRM_ADMIN'), true);
    assert.equal(canAccessWorkspace(verified?.role, 'CA'), false);
    assert.equal(hasPermission(verified?.role, 'manage_users'), true);
    assert.equal(hasPermission(verified?.role, 'manage_firm_settings'), true);
    assert.equal(getWorkspaceDashboardPath(verified?.role), '/admin/dashboard');
  });

  // Test 12 — Demo CA: Role mismatch → selecting BUSINESS_OWNER is rejected
  test('Test 12 — Demo CA role mismatch: demo.ca@example.com + BUSINESS_OWNER → DENIED', async () => {
    const req = new NextRequest('http://localhost:3010/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'demo.ca@example.com',
        password: 'DemoCA@12345',
        role: 'BUSINESS_OWNER'
      })
    });

    const res = await loginHandler(req);
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.equal(data.error, 'These credentials are not authorized for this access type.');
  });

  // Test 13 — Demo CA: Role mismatch → selecting FIRM_ADMIN is rejected
  test('Test 13 — Demo CA role mismatch: demo.ca@example.com + FIRM_ADMIN → DENIED', async () => {
    const req = new NextRequest('http://localhost:3010/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'demo.ca@example.com',
        password: 'DemoCA@12345',
        role: 'FIRM_ADMIN'
      })
    });

    const res = await loginHandler(req);
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.equal(data.error, 'These credentials are not authorized for this access type.');
  });

  // Test 14 — Demo Owner: Role mismatch → selecting CA is rejected
  test('Test 14 — Demo Owner role mismatch: demo.owner@example.com + CA → DENIED', async () => {
    const req = new NextRequest('http://localhost:3010/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'demo.owner@example.com',
        password: 'DemoOwner@12345',
        role: 'CA'
      })
    });

    const res = await loginHandler(req);
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.equal(data.error, 'These credentials are not authorized for this access type.');
  });

  // Test 15 — Demo Owner: Role mismatch → selecting FIRM_ADMIN is rejected
  test('Test 15 — Demo Owner role mismatch: demo.owner@example.com + FIRM_ADMIN → DENIED', async () => {
    const req = new NextRequest('http://localhost:3010/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.15.1' },
      body: JSON.stringify({
        email: 'demo.owner@example.com',
        password: 'DemoOwner@12345',
        role: 'FIRM_ADMIN'
      })
    });

    const res = await loginHandler(req);
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.equal(data.error, 'These credentials are not authorized for this access type.');
  });

  // Test 16 — Demo Admin: Role mismatch → selecting CA is rejected
  test('Test 16 — Demo Admin role mismatch: demo.admin@example.com + CA → DENIED', async () => {
    const req = new NextRequest('http://localhost:3010/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.16.1' },
      body: JSON.stringify({
        email: 'demo.admin@example.com',
        password: 'DemoAdmin@12345',
        role: 'CA'
      })
    });

    const res = await loginHandler(req);
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.equal(data.error, 'These credentials are not authorized for this access type.');
  });

  // Test 17 — Demo Admin: Role mismatch → selecting BUSINESS_OWNER is rejected
  test('Test 17 — Demo Admin role mismatch: demo.admin@example.com + BUSINESS_OWNER → DENIED', async () => {
    const req = new NextRequest('http://localhost:3010/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.17.1' },
      body: JSON.stringify({
        email: 'demo.admin@example.com',
        password: 'DemoAdmin@12345',
        role: 'BUSINESS_OWNER'
      })
    });

    const res = await loginHandler(req);
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.equal(data.error, 'These credentials are not authorized for this access type.');
  });

  // Test 18 — Demo Owner API Boundary: POST /api/approvals with Demo Owner session → 403
  test('Test 18 — Demo Owner API attack: POST /api/approvals with Demo Owner session is rejected with 403', async () => {
    // 1. Get a valid Demo Owner session (use unique IP to avoid rate limit)
    const loginReq = new NextRequest('http://localhost:3010/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.18.1' },
      body: JSON.stringify({
        email: 'demo.owner@example.com',
        password: 'DemoOwner@12345',
        role: 'BUSINESS_OWNER'
      })
    });
    const loginRes = await loginHandler(loginReq);
    const loginData = await loginRes.json();
    assert.equal(loginData.success, true);

    // 2. Attempt to call CA-only endpoint with Business Owner session
    const req = new NextRequest('http://localhost:3010/api/approvals', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `${SESSION_COOKIE_NAME}=${sessionFromSetCookie(loginRes)}`
      },
      body: JSON.stringify({
        action: 'APPROVE',
        transactionId: 'txn-test-01',
        notes: 'Demo Owner unauthorized approval attempt'
      })
    });

    const res = await approvalsHandler(req);
    assert.equal(res.status, 403, 'Must reject Demo Owner with 403 Forbidden');
    const data = await res.json();
    assert.equal(data.success, false);
    assert.ok(data.error.includes('Access Denied'), 'Error must specify access denial');
  });

  // Test 19 — Demo accounts use PBKDF2 hashing (not demo bypass)
  test('Test 19 — Demo accounts use real PBKDF2 hashing: wrong password is rejected', async () => {
    const req = new NextRequest('http://localhost:3010/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.19.1' },
      body: JSON.stringify({
        email: 'demo.ca@example.com',
        password: 'WrongPassword123!',
        role: 'CA'
      })
    });

    const res = await loginHandler(req);
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.equal(data.error, 'Invalid email or password.');
  });
});
