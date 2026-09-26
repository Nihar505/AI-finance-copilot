import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeNarrationForAi, wrapUntrustedNarration } from '../src/lib/security';
import { getAuthContext } from '../src/lib/auth';
import { checkRateLimit } from '../src/lib/rateLimiter';
import { NextRequest } from 'next/server';

describe('Phase 5 Security & Robustness Suite', () => {
  // ─── 1. Bank Narration Sanitization for LLMs ─────────────────────────────
  describe('Bank Narration Sanitization & Delimitation', () => {
    test('Strips control characters (null bytes, newlines, tabs, bells)', () => {
      const dirty = 'NEFT/1234\x00\x07\x1B/Salary\n\rPayment\tTo Consultant';
      const cleaned = sanitizeNarrationForAi(dirty);
      assert.ok(!cleaned.includes('\x00'), 'Must strip null bytes');
      assert.ok(!cleaned.includes('\x07'), 'Must strip bell char');
      assert.ok(!cleaned.includes('\x1B'), 'Must strip ESC char');
      assert.equal(cleaned, 'NEFT/1234 /Salary Payment To Consultant');
    });

    test('Caps length to specified limit', () => {
      const longText = 'A'.repeat(1000);
      const capped = sanitizeNarrationForAi(longText, 50);
      assert.equal(capped.length, 53); // 50 chars + '...'
      assert.ok(capped.endsWith('...'));
    });

    test('Wraps narration in untrusted XML boundary tag', () => {
      const narration = 'UPI/4028193810/Amazon Web Services';
      const wrapped = wrapUntrustedNarration(narration);
      assert.equal(wrapped, '<untrusted_bank_narration>UPI/4028193810/Amazon Web Services</untrusted_bank_narration>');
    });

    test('Handles null and undefined narrations safely', () => {
      assert.equal(sanitizeNarrationForAi(null), '');
      assert.equal(sanitizeNarrationForAi(undefined), '');
      assert.equal(wrapUntrustedNarration(null), '<untrusted_bank_narration></untrusted_bank_narration>');
    });
  });

  // ─── 2. Dev Auth Fallback Gating ──────────────────────────────────────────
  describe('Dev Auth Fallback: Default Deny without ALLOW_INSECURE_DEV_AUTH', () => {
    test('Rejects unauthenticated request when ALLOW_INSECURE_DEV_AUTH is unset/false', async () => {
      const originalEnv = process.env.ALLOW_INSECURE_DEV_AUTH;
      delete process.env.ALLOW_INSECURE_DEV_AUTH;

      const req = new NextRequest('http://localhost:3010/api/dashboard', {
        headers: {
          'x-user-role': 'CA',
          'x-org-id': 'org-apex-01'
        }
      });

      await assert.rejects(
        async () => {
          await getAuthContext(req);
        },
        /401 Unauthorized: Authentication required.*Insecure dev auth fallback is disabled/
      );

      if (originalEnv) {
        process.env.ALLOW_INSECURE_DEV_AUTH = originalEnv;
      }
    });

    test('Allows dev auth headers ONLY when ALLOW_INSECURE_DEV_AUTH=true in non-production', async () => {
      const originalEnv = process.env.ALLOW_INSECURE_DEV_AUTH;
      process.env.ALLOW_INSECURE_DEV_AUTH = 'true';

      const req = new NextRequest('http://localhost:3010/api/dashboard', {
        headers: {
          'x-user-role': 'CA',
          'x-org-id': 'org-apex-01'
        }
      });

      const auth = await getAuthContext(req);
      assert.equal(auth.role, 'CA');
      assert.equal(auth.activeOrgId, 'org-apex-01');

      if (originalEnv !== undefined) {
        process.env.ALLOW_INSECURE_DEV_AUTH = originalEnv;
      } else {
        delete process.env.ALLOW_INSECURE_DEV_AUTH;
      }
    });
  });

  // ─── 3. In-Memory Rate Limiter Behavior ──────────────────────────────────
  describe('Sliding-Window Token Bucket Rate Limiter', () => {
    test('Enforces rate limit on rapid successive attempts', () => {
      const bucket = `test_bucket_${Date.now()}`;
      const key = '192.168.1.100';
      const options = { limit: 3, windowSeconds: 10 };

      // Attempt 1 -> allowed (remaining: 2)
      const r1 = checkRateLimit(bucket, key, options);
      assert.equal(r1.allowed, true);

      // Attempt 2 -> allowed (remaining: 1)
      const r2 = checkRateLimit(bucket, key, options);
      assert.equal(r2.allowed, true);

      // Attempt 3 -> allowed (remaining: 0)
      const r3 = checkRateLimit(bucket, key, options);
      assert.equal(r3.allowed, true);

      // Attempt 4 -> blocked
      const r4 = checkRateLimit(bucket, key, options);
      assert.equal(r4.allowed, false);
      assert.equal(r4.remaining, 0);
      assert.ok(r4.resetSeconds > 0);
    });
  });
});
