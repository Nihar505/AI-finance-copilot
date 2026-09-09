/**
 * Security and Input Validation Engine.
 * Provides defenses against XSS, injection, malformed JSON, and invalid tax identifiers.
 */

// Official Indian GSTIN format: 2 digit state code + 10 char PAN + 1 char entity + Z + 1 checksum
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

// Official Indian Permanent Account Number (PAN) format
export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;

// Standard ISO 8601 Date format YYYY-MM-DD
export const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validates whether a given string is a valid Indian GSTIN.
 */
export function isValidGstin(gstin: string | null | undefined): boolean {
  if (!gstin || typeof gstin !== 'string') return false;
  return GSTIN_REGEX.test(gstin.trim().toUpperCase());
}

/**
 * Validates whether a given string is a valid Indian PAN.
 */
export function isValidPan(pan: string | null | undefined): boolean {
  if (!pan || typeof pan !== 'string') return false;
  return PAN_REGEX.test(pan.trim().toUpperCase());
}

/**
 * Extracts a 10-digit PAN from a 15-digit GSTIN if valid, or returns null.
 */
export function extractPanFromGstin(gstin: string | null | undefined): string | null {
  if (!gstin || typeof gstin !== 'string') return null;
  const clean = gstin.trim().toUpperCase();
  if (clean.length >= 12) {
    const candidate = clean.substring(2, 12);
    if (PAN_REGEX.test(candidate)) return candidate;
  }
  return null;
}

/**
 * Validates a YYYY-MM-DD date string for actual calendar correctness (e.g. rejects 2024-02-31).
 */
export function isValidDate(dateStr: string | null | undefined): boolean {
  if (!dateStr || typeof dateStr !== 'string') return false;
  if (!DATE_REGEX.test(dateStr.trim())) return false;
  
  const [year, month, day] = dateStr.trim().split('-').map(Number);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;

  const dateObj = new Date(Date.UTC(year, month - 1, day));
  return (
    dateObj.getUTCFullYear() === year &&
    dateObj.getUTCMonth() === month - 1 &&
    dateObj.getUTCDate() === day
  );
}

/**
 * Sanitizes user-provided strings to prevent Stored or Reflected Cross-Site Scripting (XSS).
 * Replaces dangerous characters with HTML entities.
 */
export function sanitizeString(input: any): string {
  if (input === null || input === undefined) return '';
  const str = String(input);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Sanitizes an object recursively to ensure all string properties are XSS-safe.
 */
export function sanitizeObject<T extends Record<string, any>>(obj: T): T {
  if (!obj || typeof obj !== 'object') return obj;
  const sanitized: any = Array.isArray(obj) ? [] : {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitizeString(value);
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeObject(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized as T;
}

/**
 * Validates external webhook URLs to prevent Server-Side Request Forgery (SSRF).
 * Strictly requires HTTPS and blocks localhost, loopback, private RFC-1918 IPs, and cloud metadata services.
 */
export function isSafeExternalWebhookUrl(urlString: string | null | undefined): boolean {
  if (!urlString || typeof urlString !== 'string') return false;
  try {
    const parsed = new URL(urlString.trim());
    if (parsed.protocol !== 'https:') return false; // Enforce HTTPS

    const hostname = parsed.hostname.toLowerCase();
    // Block loopback and local hostnames
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '0.0.0.0') {
      return false;
    }
    // Block AWS / GCP / Azure metadata endpoint
    if (hostname === '169.254.169.254' || hostname.endsWith('.internal') || hostname.endsWith('.local')) {
      return false;
    }
    // Block RFC 1918 private IPv4 ranges: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
    if (/^10\./.test(hostname)) return false;
    if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)) return false;
    if (/^192\.168\./.test(hostname)) return false;

    return true;
  } catch {
    return false;
  }
}

/**
 * Safely parses JSON from incoming requests with size and malformed guards.
 */
export async function safeParseJson<T = any>(req: Request, maxBytes: number = 1_000_000): Promise<{ success: boolean; data?: T; error?: string }> {
  try {
    const text = await req.text();
    if (!text || text.trim() === '') {
      return { success: false, error: 'Request body is empty' };
    }
    if (text.length > maxBytes) {
      return { success: false, error: `Payload size (${text.length} bytes) exceeds maximum limit of ${maxBytes} bytes` };
    }
    const parsed = JSON.parse(text);
    return { success: true, data: parsed };
  } catch (err: any) {
    return { success: false, error: `Malformed JSON in request body: ${err.message}` };
  }
}
