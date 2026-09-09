import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSessionToken,
  verifySessionToken,
  hashPassword,
  verifyPassword,
  assertTenantAccess,
  checkRoleAccess,
  getAccessibleOrganizations,
  AuthContext
} from '../src/lib/auth';
import {
  isValidGstin,
  isValidPan,
  extractPanFromGstin,
  isValidDate,
  sanitizeString,
  isSafeExternalWebhookUrl
} from '../src/lib/security';
import {
  roundCurrency,
  toPaisa,
  fromPaisa,
  validateFinancialAmount,
  calculateGst,
  calculateTds
} from '../src/lib/currency';
import { checkRateLimit } from '../src/lib/rateLimiter';
import { ORG_ID, ORG_ZENITH_ID } from '../src/lib/seed';

describe('Stage 2: Security Hardening & Cryptographic Session Tests', () => {
  test('Auth: Cryptographically signs and validates HMAC-SHA256 session token', () => {
    const payload = {
      userId: 'user-test-ca',
      userName: 'Priya Sharma, FCA',
      userEmail: 'priya@apexadvisory.com',
      role: 'ca' as const,
      orgId: ORG_ID
    };

    const token = createSessionToken(payload, 2); // 2 hours
    assert.ok(typeof token === 'string' && token.includes('.'), 'Token must be formatted with body.signature');

    const verified = verifySessionToken(token);
    assert.ok(verified, 'Verified session should not be null');
    assert.equal(verified?.userId, payload.userId);
    assert.equal(verified?.role, 'ca');
    assert.equal(verified?.orgId, ORG_ID);
  });

  test('Auth: Rejects tampered token signature', () => {
    const token = createSessionToken({
      userId: 'user-test-ca',
      userName: 'Priya Sharma',
      userEmail: 'priya@apex.com',
      role: 'ca',
      orgId: ORG_ID
    });

    const [body, sig] = token.split('.');
    // Tamper with payload by changing base64 character
    const tamperedToken = `${body.slice(0, -2)}AA.${sig}`;
    const result = verifySessionToken(tamperedToken);
    assert.equal(result, null, 'Tampered token must fail signature verification');
  });

  test('Auth: Rejects expired session tokens', () => {
    // Create token with negative TTL (already expired)
    const expiredToken = createSessionToken(
      {
        userId: 'user-expired',
        userName: 'Expired User',
        userEmail: 'expired@test.com',
        role: 'business_owner',
        orgId: ORG_ID
      },
      -1 // expired 1 hour ago
    );

    const result = verifySessionToken(expiredToken);
    assert.equal(result, null, 'Expired session token must be rejected');
  });

  test('Auth: PBKDF2 Password hashing and deterministic verification', () => {
    const rawPass = 'ApexStrongPass@2026';
    const hash = hashPassword(rawPass);
    assert.ok(hash.length >= 64, 'Hash must be at least 64 hex characters');

    assert.equal(verifyPassword(rawPass, hash), true, 'Correct password must verify');
    assert.equal(verifyPassword('WrongPassword123', hash), false, 'Wrong password must be rejected');
  });

  test('Tenancy: assertTenantAccess prevents cross-tenant access for business owners', async () => {
    const businessOwnerAuth: AuthContext = {
      userId: 'user-business-owner',
      userName: 'Rajesh Gupta',
      userEmail: 'rajesh@zenith.io',
      role: 'business_owner',
      activeOrgId: ORG_ZENITH_ID
    };

    // Accessing own org should succeed
    await assertTenantAccess(businessOwnerAuth, ORG_ZENITH_ID);

    // Accessing Apex org should throw 403 Forbidden
    await assert.rejects(
      async () => {
        await assertTenantAccess(businessOwnerAuth, ORG_ID);
      },
      /403 Forbidden: Tenant Isolation Violation/
    );
  });

  test('Tenancy: getAccessibleOrganizations filters strictly for business owner', async () => {
    const accessibleOrgs = await getAccessibleOrganizations('user-business-owner', 'business_owner');
    assert.ok(accessibleOrgs.length >= 1);
    for (const org of accessibleOrgs) {
      assert.equal(org.id, ORG_ZENITH_ID, 'Business owner must only see Zenith organization');
    }
  });

  test('Rate Limiter: Blocks requests after exceeding token threshold', () => {
    const bucket = 'test_bucket_' + Date.now();
    const key = 'test_ip_127.0.0.1';
    const opts = { limit: 3, windowSeconds: 60 };

    assert.equal(checkRateLimit(bucket, key, opts).allowed, true);
    assert.equal(checkRateLimit(bucket, key, opts).allowed, true);
    assert.equal(checkRateLimit(bucket, key, opts).allowed, true);

    const fourth = checkRateLimit(bucket, key, opts);
    assert.equal(fourth.allowed, false, 'Fourth request must be rate limited');
    assert.equal(fourth.remaining, 0);
  });
});

describe('Stage 2: Input Security & SSRF Defense Tests', () => {
  test('Security: Indian GSTIN format validator', () => {
    assert.equal(isValidGstin('27AAACA9876Q1ZA'), true);
    assert.equal(isValidGstin('29AABCT1234K1Z0'), true);
    assert.equal(isValidGstin('INVALID_GSTIN_123'), false);
    assert.equal(isValidGstin(''), false);
    assert.equal(isValidGstin(null), false);
  });

  test('Security: Indian PAN format validator & GSTIN extraction', () => {
    assert.equal(isValidPan('AAACA9876Q'), true);
    assert.equal(isValidPan('AABCT1234K'), true);
    assert.equal(isValidPan('INVALID123'), false);

    assert.equal(extractPanFromGstin('27AAACA9876Q1ZA'), 'AAACA9876Q');
    assert.equal(extractPanFromGstin('INVALID'), null);
  });

  test('Security: Calendar date validation rejects impossible dates', () => {
    assert.equal(isValidDate('2024-03-31'), true);
    assert.equal(isValidDate('2024-02-29'), true); // 2024 is leap year
    assert.equal(isValidDate('2023-02-29'), false); // 2023 is not leap year
    assert.equal(isValidDate('2024-04-31'), false); // April has only 30 days
    assert.equal(isValidDate('invalid-date'), false);
  });

  test('Security: XSS sanitization neutralizes malicious HTML/script payloads', () => {
    const dirty = '<script>alert("XSS")</script><img src="x" onerror="stealCookies()">';
    const clean = sanitizeString(dirty);
    assert.equal(clean.includes('<script>'), false);
    assert.equal(clean.includes('alert(&quot;XSS&quot;)'), true);
    assert.equal(clean.includes('&lt;img'), true);
  });

  test('Security: SSRF webhook validator blocks loopback, private IPs, and cloud metadata', () => {
    // Valid external HTTPS webhooks
    assert.equal(isSafeExternalWebhookUrl('https://hooks.slack.com/services/T00/B00/XXXX'), true);
    assert.equal(isSafeExternalWebhookUrl('https://discord.com/api/webhooks/123/abc'), true);

    // SSRF vectors to block
    assert.equal(isSafeExternalWebhookUrl('http://localhost:3010/admin'), false);
    assert.equal(isSafeExternalWebhookUrl('http://127.0.0.1:8080'), false);
    assert.equal(isSafeExternalWebhookUrl('http://169.254.169.254/latest/meta-data/'), false); // AWS/GCP metadata
    assert.equal(isSafeExternalWebhookUrl('http://10.0.0.5/api'), false); // RFC 1918
    assert.equal(isSafeExternalWebhookUrl('http://192.168.1.1/router'), false); // RFC 1918
    assert.equal(isSafeExternalWebhookUrl('http://hooks.slack.com/plain-http'), false); // No HTTP
  });
});

describe('Stage 2: Deterministic Financial Correctness Tests', () => {
  test('Currency: Eliminates IEEE 754 floating point arithmetic drift', () => {
    const floatSum = 0.1 + 0.2; // 0.30000000000000004
    assert.equal(roundCurrency(floatSum), 0.3);
    assert.equal(toPaisa(1250.45), 125045);
    assert.equal(fromPaisa(125045), 1250.45);
  });

  test('Currency: Amount validation rejects negative values and overflows', () => {
    assert.equal(validateFinancialAmount(-500).valid, false);
    assert.equal(validateFinancialAmount('abc').valid, false);
    assert.equal(validateFinancialAmount(2_000_000_000).valid, false); // Exceeds ₹100 Cr
    assert.equal(validateFinancialAmount(45000.50).valid, true);
    assert.equal(validateFinancialAmount(45000.50).amount, 45000.50);
  });

  test('GST: Intrastate splits into exact equal CGST and SGST with 2-decimal precision', () => {
    const result = calculateGst(10000.00, 18, false);
    assert.equal(result.taxableValue, 10000.00);
    assert.equal(result.cgst, 900.00);
    assert.equal(result.sgst, 900.00);
    assert.equal(result.igst, 0.00);
    assert.equal(result.totalTax, 1800.00);
    assert.equal(result.totalAmount, 11800.00);
  });

  test('GST: Interstate assigns entire tax liability to IGST', () => {
    const result = calculateGst(25000.00, 18, true);
    assert.equal(result.cgst, 0.00);
    assert.equal(result.sgst, 0.00);
    assert.equal(result.igst, 4500.00);
    assert.equal(result.totalTax, 4500.00);
    assert.equal(result.totalAmount, 29500.00);
  });

  test('GST: Fractional amounts round correctly without penny loss', () => {
    // ₹99.99 @ 18% GST -> 17.9982 -> rounds to 18.00 (CGST 9.00, SGST 9.00)
    const result = calculateGst(99.99, 18, false);
    assert.equal(result.cgst, 9.00);
    assert.equal(result.sgst, 9.00);
    assert.equal(result.totalTax, 18.00);
    assert.equal(result.totalAmount, 117.99);
  });

  test('TDS: Standard statutory rate for Rent (Section 194I) is 10%', () => {
    const tds = calculateTds(115000.00, '194I', true);
    assert.equal(tds.applicableRate, 10);
    assert.equal(tds.tdsAmount, 11500.00);
    assert.equal(tds.netPayable, 103500.00);
    assert.equal(tds.isPenalRateApplied, false);
  });

  test('TDS: Section 206AA mandatory 20% penal withholding applies when PAN is missing', () => {
    // Rent under 194I with missing PAN must jump from 10% to 20%
    const tds = calculateTds(115000.00, '194I', false);
    assert.equal(tds.applicableRate, 20);
    assert.equal(tds.tdsAmount, 23000.00);
    assert.equal(tds.netPayable, 92000.00);
    assert.equal(tds.isPenalRateApplied, true);
    assert.match(tds.reasoning, /Section 206AA Penal Withholding/);
  });
});
