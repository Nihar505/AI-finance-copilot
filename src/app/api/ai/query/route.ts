import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, assertTenantAccess } from '@/lib/auth';
import { askFinancialCopilot } from '@/lib/geminiCopilot';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
import { safeParseJson, sanitizeString } from '@/lib/security';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    const orgId = auth.activeOrgId;

    // 1. Rate Limiting: 30 queries per minute per user/IP
    const clientKey = `${auth.userId}_${getClientIp(req.headers)}`;
    const rateCheck = checkRateLimit('ai_copilot', clientKey, { limit: 30, windowSeconds: 60 });
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { success: false, error: `Rate limit exceeded. Please wait ${rateCheck.resetSeconds}s before submitting more AI queries.` },
        { status: 429, headers: { 'Retry-After': String(rateCheck.resetSeconds) } }
      );
    }

    // 2. Safe Body Parsing
    const bodyParsed = await safeParseJson<{ question?: string; targetOrgId?: string }>(req, 50_000);
    if (!bodyParsed.success || !bodyParsed.data) {
      return NextResponse.json({ success: false, error: bodyParsed.error || 'Invalid request body' }, { status: 400 });
    }

    const { question, targetOrgId } = bodyParsed.data;
    const effectiveOrgId = targetOrgId || orgId;

    // 3. Multi-Tenant Authorization Guard
    await assertTenantAccess(auth, effectiveOrgId);

    // 4. Input Validation & Prompt Size Guard
    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      return NextResponse.json({ success: false, error: 'Question is required' }, { status: 400 });
    }

    if (question.length > 1500) {
      return NextResponse.json(
        { success: false, error: 'Question exceeds maximum allowed limit of 1,500 characters' },
        { status: 400 }
      );
    }

    const sanitizedQuestion = sanitizeString(question.trim());
    const response = await askFinancialCopilot(effectiveOrgId, sanitizedQuestion);

    return NextResponse.json({
      success: true,
      orgId: effectiveOrgId,
      data: response
    });
  } catch (error: any) {
    logger.error('AI Copilot Query API Error:', { route: '/api/ai/query', err: String(error) });
    const status = error.message?.includes('403 Forbidden') ? 403 : 500;
    return NextResponse.json({ success: false, error: error.message }, { status });
  }
}
