import { NextRequest, NextResponse } from 'next/server';
import { verifySessionEdge, SESSION_COOKIE_NAME } from './lib/auth-edge';
import { normalizeRole, getWorkspaceDashboardPath } from './lib/permissions';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Ignore static assets and internal Next.js files.
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/static') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySessionEdge(token) : null;
  const userRole = session ? normalizeRole(session.role) : null;

  // API routes are protected at the edge as well as in their route handlers.
  // Login and the design-partner application are intentionally public; every
  // financial, admin, and seed endpoint requires a valid signed session.
  if (pathname.startsWith('/api')) {
    const publicApiPaths = new Set(['/api/auth/login', '/api/auth/logout', '/api/pilot-request']);
    if (publicApiPaths.has(pathname)) return NextResponse.next();
    if (!session || !userRole) {
      return NextResponse.json(
        { success: false, error: 'Authentication required.' },
        { status: 401 }
      );
    }
    return NextResponse.next();
  }

  // Public / Non-Guarded Pages
  if (pathname === '/unauthorized') {
    return NextResponse.next();
  }

  // Login page handling: if already authenticated with valid session, redirect to role workspace
  if (pathname === '/login') {
    if (userRole) {
      const dest = getWorkspaceDashboardPath(userRole);
      return NextResponse.redirect(new URL(dest, req.url));
    }
    return NextResponse.next();
  }

  // The root path is the public acquisition page. Authenticated users can open
  // their workspace from its primary CTA.
  if (pathname === '/') {
    return NextResponse.next();
  }

  // CA Workspace Routes
  if (pathname.startsWith('/ca')) {
    if (!session || !userRole) {
      const loginUrl = new URL('/login', req.url);
      loginUrl.searchParams.set('redirect', pathname);
      loginUrl.searchParams.set('role', 'CA');
      return NextResponse.redirect(loginUrl);
    }
    if (userRole !== 'CA') {
      const unauthUrl = new URL('/unauthorized', req.url);
      unauthUrl.searchParams.set('role', userRole);
      unauthUrl.searchParams.set('required', 'CA');
      return NextResponse.redirect(unauthUrl);
    }
    return NextResponse.next();
  }

  // Business Owner Workspace Routes
  if (pathname.startsWith('/business')) {
    if (!session || !userRole) {
      const loginUrl = new URL('/login', req.url);
      loginUrl.searchParams.set('redirect', pathname);
      loginUrl.searchParams.set('role', 'BUSINESS_OWNER');
      return NextResponse.redirect(loginUrl);
    }
    if (userRole !== 'BUSINESS_OWNER') {
      const unauthUrl = new URL('/unauthorized', req.url);
      unauthUrl.searchParams.set('role', userRole);
      unauthUrl.searchParams.set('required', 'BUSINESS_OWNER');
      return NextResponse.redirect(unauthUrl);
    }
    return NextResponse.next();
  }

  // Firm Admin Workspace Routes
  if (pathname.startsWith('/admin')) {
    if (!session || !userRole) {
      const loginUrl = new URL('/login', req.url);
      loginUrl.searchParams.set('redirect', pathname);
      loginUrl.searchParams.set('role', 'FIRM_ADMIN');
      return NextResponse.redirect(loginUrl);
    }
    if (userRole !== 'FIRM_ADMIN') {
      const unauthUrl = new URL('/unauthorized', req.url);
      unauthUrl.searchParams.set('role', userRole);
      unauthUrl.searchParams.set('required', 'FIRM_ADMIN');
      return NextResponse.redirect(unauthUrl);
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
};
