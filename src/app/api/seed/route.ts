import { NextResponse } from 'next/server';
import { seedRealisticSandboxData, ORG_ID } from '@/lib/seed';
import { runCategorizationBatch } from '@/lib/categorizationEngine';
import { runReconciliationBatch } from '@/lib/reconciliationEngine';
import { runExceptionDetection } from '@/lib/exceptionEngine';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    await seedRealisticSandboxData();
    const categorized = await runCategorizationBatch(ORG_ID);
    const matched = await runReconciliationBatch(ORG_ID);
    const exceptions = await runExceptionDetection(ORG_ID);

    return NextResponse.json({
      success: true,
      message: 'Realistic 1-month sandbox dataset loaded and processed successfully!',
      stats: {
        categorized,
        matched,
        exceptions
      }
    });
  } catch (error: any) {
    console.error('Seed API Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
