import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, assertTenantAccess } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { isSafeExternalWebhookUrl, safeParseJson } from '@/lib/security';
import logger from '@/lib/logger';

/**
 * Compliance Alerts API
 * Dispatches structured webhook alerts (e.g. Slack / Teams / custom webhook)
 * for overdue and critical compliance deadlines.
 */

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    await assertTenantAccess(auth, auth.activeOrgId);
    const db = await getDb();

    // Check how many filings are overdue or due in 48 hours
    const filingsRes = await db.query(
      `SELECT id, filing_type, due_date, status, assigned_ca,
              CURRENT_DATE as today,
              (due_date - CURRENT_DATE) as days_left
       FROM compliance_filings
       WHERE org_id = $1 AND status != 'filed'
       ORDER BY due_date ASC;`,
      [auth.activeOrgId]
    );

    const overdueFilings = filingsRes.rows.filter(
      (f) => f.status === 'overdue' || Number(f.days_left) < 0
    );
    const dueSoonFilings = filingsRes.rows.filter(
      (f) => Number(f.days_left) >= 0 && Number(f.days_left) <= 2
    );

    const envWebhookConfigured = Boolean(process.env.SLACK_WEBHOOK_URL);

    return NextResponse.json({
      success: true,
      envWebhookConfigured,
      overdueCount: overdueFilings.length,
      dueSoonCount: dueSoonFilings.length,
      totalPending: filingsRes.rows.length,
    });
  } catch (err: any) {
    logger.error('[alerts/GET]', { route: '/api/alerts', err: String(err) });
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    await assertTenantAccess(auth, auth.activeOrgId);

    const bodyParsed = await safeParseJson<any>(req);
    if (!bodyParsed.success || !bodyParsed.data) {
      return NextResponse.json({ success: false, error: bodyParsed.error || 'Invalid request body' }, { status: 400 });
    }
    const { action, webhookUrl } = bodyParsed.data;

    const targetUrl = (webhookUrl || process.env.SLACK_WEBHOOK_URL || '').trim();

    if (targetUrl && !isSafeExternalWebhookUrl(targetUrl)) {
      return NextResponse.json(
        { success: false, error: 'Disallowed webhook URL. Only public HTTPS endpoints are permitted to prevent SSRF vulnerabilities.' },
        { status: 400 }
      );
    }

    if (action === 'test') {
      const testPayload = {
        text: '🔔 *AI Finance & Compliance Copilot* — Test Alert connection successful!',
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: '🔔 Test Notification: AI Finance Copilot',
              emoji: true,
            },
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Status:* Active & Connected\n*Tenant:* ${auth.activeOrgId}\n*Sender:* ${auth.userName || 'Lead CA'}\n*Timestamp:* ${new Date().toISOString()}`,
            },
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: 'Statutory compliance alerts will be dispatched to this channel when deadlines are overdue or critical.',
              },
            ],
          },
        ],
      };

      let delivered = false;
      let errorMsg = null;

      if (targetUrl.startsWith('http://') || targetUrl.startsWith('https://')) {
        try {
          const res = await fetch(targetUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(testPayload),
          });
          delivered = res.ok;
          if (!res.ok) {
            errorMsg = `Webhook endpoint returned HTTP ${res.status}`;
          }
        } catch (fetchErr: any) {
          errorMsg = fetchErr.message;
        }
      } else {
        // Mock success when no live webhook is configured for seamless testing
        delivered = true;
      }

      return NextResponse.json({
        success: true,
        delivered,
        error: errorMsg,
        message: delivered
          ? (targetUrl ? '✓ Test alert delivered to webhook!' : '✓ Simulated alert test succeeded (configure live webhook for external dispatch)')
          : `Failed to deliver: ${errorMsg}`,
        payload: testPayload,
      });
    }

    if (action === 'send_compliance_alert') {
      const db = await getDb();

      // Fetch org details
      const orgRes = await db.query(
        'SELECT name, legal_name FROM organizations WHERE id = $1;',
        [auth.activeOrgId]
      );
      const orgName = orgRes.rows[0]?.name || 'Apex Global Advisory';

      // Fetch active overdue & critical filings
      const filingsRes = await db.query(
        `SELECT id, filing_type, due_date, status, assigned_ca, notes,
                (due_date - CURRENT_DATE) as days_left
         FROM compliance_filings
         WHERE org_id = $1 AND status != 'filed'
         ORDER BY due_date ASC;`,
        [auth.activeOrgId]
      );

      const overdue = filingsRes.rows.filter(
        (f) => f.status === 'overdue' || Number(f.days_left) < 0
      );
      const dueSoon = filingsRes.rows.filter(
        (f) => Number(f.days_left) >= 0 && Number(f.days_left) <= 3
      );

      const itemsToAlert = [...overdue, ...dueSoon];

      if (itemsToAlert.length === 0) {
        return NextResponse.json({
          success: true,
          message: 'No overdue or urgent filings to report. All compliance items are on schedule!',
          alertCount: 0,
        });
      }

      // Build Slack Block Kit Message
      const blocks: any[] = [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `⚠️ Statutory Compliance Alert — ${orgName}`,
            emoji: true,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Attention:* There are *${overdue.length} overdue* and *${dueSoon.length} urgent* statutory filings requiring Chartered Accountant intervention.`,
          },
        },
        { type: 'divider' },
      ];

      for (const item of itemsToAlert.slice(0, 5)) {
        const isOverdue = item.status === 'overdue' || Number(item.days_left) < 0;
        const statusBadge = isOverdue
          ? `🔴 *OVERDUE* (${Math.abs(Number(item.days_left))} days ago)`
          : `🟡 *DUE SOON* (in ${item.days_left} days)`;

        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${item.filing_type}*\n• Status: ${statusBadge}\n• Due Date: \`${item.due_date}\`\n• Assigned CA: ${item.assigned_ca || 'Unassigned'}\n• Note: _${item.notes || 'Pending statutory return upload'}_`,
          },
        });
      }

      blocks.push(
        { type: 'divider' },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `Dispatched by AI Finance Copilot • Statutory penalties accrue under Sec 47 (GST) & Sec 201 (TDS).`,
            },
          ],
        }
      );

      const payload = {
        text: `⚠️ [${orgName}] Compliance Alert: ${overdue.length} overdue, ${dueSoon.length} due soon.`,
        blocks,
      };

      let delivered = false;
      let errorMsg = null;

      if (targetUrl.startsWith('http://') || targetUrl.startsWith('https://')) {
        try {
          const res = await fetch(targetUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          delivered = res.ok;
          if (!res.ok) errorMsg = `HTTP ${res.status}`;
        } catch (fErr: any) {
          errorMsg = fErr.message;
        }
      } else {
        delivered = true; // Simulated delivery for local dev
      }

      // Record in audit log
      const logId = `log-alert-${Date.now()}`;
      try {
        await db.query(
          `INSERT INTO audit_logs (id, org_id, user_id, user_name, action, entity_type, entity_id, before_state, after_state, explanation)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);`,
          [
            logId,
            auth.activeOrgId,
            auth.userId || 'user-lead-ca',
            auth.userName || 'Priya Sharma, FCA',
            'DISPATCH_COMPLIANCE_ALERT',
            'compliance_calendar',
            `alert-${Date.now()}`,
            null,
            JSON.stringify({
              itemsAlerted: itemsToAlert.length,
              overdueCount: overdue.length,
              delivered,
              channel: targetUrl ? 'webhook' : 'simulated',
            }),
            `Dispatched statutory compliance alert for ${itemsToAlert.length} filings (${overdue.length} overdue)`,
          ]
        );
      } catch (logErr) {
        console.warn('Audit log write error:', logErr);
      }

      return NextResponse.json({
        success: true,
        delivered,
        alertCount: itemsToAlert.length,
        overdueCount: overdue.length,
        dueSoonCount: dueSoon.length,
        message: delivered
          ? `Dispatched compliance alert for ${itemsToAlert.length} statutory filings!`
          : `Failed to dispatch alert: ${errorMsg}`,
      });
    }

    return NextResponse.json({ success: false, error: 'Invalid action. Use action=test or action=send_compliance_alert' }, { status: 400 });
  } catch (err: any) {
    logger.error('[alerts/POST]', { route: '/api/alerts', err: String(err) });
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
