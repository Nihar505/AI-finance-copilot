import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
import { safeParseJson, sanitizeString } from '@/lib/security';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanText(value: unknown, maxLength: number): string {
  return sanitizeString(String(value || '').trim()).slice(0, maxLength);
}

/**
 * Stores a consented request to become a design partner. It does not create a
 * user account or accept financial data; onboarding remains an assisted flow.
 */
export async function POST(req: NextRequest) {
  const rate = checkRateLimit('pilot_request', getClientIp(req.headers), {
    limit: 5,
    windowSeconds: 60 * 60
  });

  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, error: 'Too many requests. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(rate.resetSeconds) } }
    );
  }

  const parsed = await safeParseJson<{
    name?: string;
    email?: string;
    organizationName?: string;
    customerProfile?: string;
    clientVolume?: string;
    message?: string;
    consent?: boolean;
  }>(req, 10_000);

  if (!parsed.success || !parsed.data) {
    return NextResponse.json({ success: false, error: 'Please submit a valid application.' }, { status: 400 });
  }

  const name = cleanText(parsed.data.name, 120);
  const email = String(parsed.data.email || '').trim().toLowerCase();
  const organizationName = cleanText(parsed.data.organizationName, 255);
  const customerProfile = cleanText(parsed.data.customerProfile, 60);
  const clientVolume = cleanText(parsed.data.clientVolume, 60);
  const message = cleanText(parsed.data.message, 1_500);

  if (!name || !EMAIL_PATTERN.test(email) || !organizationName || !customerProfile || !clientVolume) {
    return NextResponse.json(
      { success: false, error: 'Name, work email, organization, and operating profile are required.' },
      { status: 400 }
    );
  }

  if (parsed.data.consent !== true) {
    return NextResponse.json(
      { success: false, error: 'Please confirm that we may contact you about the pilot.' },
      { status: 400 }
    );
  }

  try {
    const db = await getDb();
    const id = `pilot-${crypto.randomUUID()}`;

    await db.query(
      `INSERT INTO pilot_requests (
         id, name, email, organization_name, customer_profile, client_volume, message
       ) VALUES ($1, $2, $3, $4, $5, $6, $7);`,
      [id, name, email, organizationName, customerProfile, clientVolume, message || null]
    );

    return NextResponse.json(
      { success: true, message: 'Application received. We will follow up with the pilot brief.' },
      { status: 201 }
    );
  } catch (error) {
    logger.error('Pilot request submission failed', { route: '/api/pilot-request', err: String(error) });
    return NextResponse.json(
      { success: false, error: 'We could not save your application. Please try again shortly.' },
      { status: 500 }
    );
  }
}
