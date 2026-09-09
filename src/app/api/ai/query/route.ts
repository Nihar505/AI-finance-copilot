import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth';
import { askFinancialCopilot } from '@/lib/geminiCopilot';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    const orgId = auth.activeOrgId;
    const body = await req.json();
    const { question } = body;

    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      return NextResponse.json({ success: false, error: 'Question is required' }, { status: 400 });
    }

    const response = await askFinancialCopilot(orgId, question.trim());

    return NextResponse.json({
      success: true,
      orgId,
      data: response
    });
  } catch (error: any) {
    console.error('AI Copilot Query API Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
