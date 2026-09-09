import { NextResponse } from 'next/server';
import { seedRealisticSandboxData, ORG_ID } from '@/lib/seed';
import { runCategorizationBatch } from '@/lib/categorizationEngine';
import { runReconciliationBatch } from '@/lib/reconciliationEngine';
import { runExceptionDetection } from '@/lib/exceptionEngine';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function POST() {
  // Block seed endpoint in production — this would wipe and re-seed ALL data
  if (process.env.NODE_ENV === 'production') {
    logger.warn('Seed endpoint blocked in production', { route: '/api/seed' });
    return NextResponse.json(
      { success: false, error: 'Seed endpoint is disabled in production.' },
      { status: 403 }
    );
  }

  try {
    await seedRealisticSandboxData();
    const categorized = await runCategorizationBatch(ORG_ID);
    const matched = await runReconciliationBatch(ORG_ID);
    const exceptions = await runExceptionDetection(ORG_ID);

    logger.info('Sandbox data seeded', { route: '/api/seed', categorized, matched, exceptions });
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
    logger.error('Seed API error', { route: '/api/seed', err: String(error) });
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

