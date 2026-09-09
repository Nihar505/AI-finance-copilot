/**
 * In-memory sliding-window rate limiter for sensitive API endpoints.
 * Protects against brute-force password guessing, DoS attacks, and LLM quota draining.
 */

interface RateLimitEntry {
  tokens: number;
  lastRefill: number;
}

const rateLimitStores = new Map<string, Map<string, RateLimitEntry>>();

export interface RateLimitOptions {
  limit: number;       // Maximum requests allowed in the time window
  windowSeconds: number; // Time window in seconds
}

/**
 * Checks and updates rate limit for a specific bucket and key (e.g. IP or user ID).
 * Returns { allowed: boolean, remaining: number, resetSeconds: number }
 */
export function checkRateLimit(
  bucketName: string,
  key: string,
  options: RateLimitOptions
): { allowed: boolean; remaining: number; resetSeconds: number } {
  const { limit, windowSeconds } = options;
  const now = Date.now();
  const windowMs = windowSeconds * 1000;

  if (!rateLimitStores.has(bucketName)) {
    rateLimitStores.set(bucketName, new Map<string, RateLimitEntry>());
  }

  const bucket = rateLimitStores.get(bucketName)!;
  let entry = bucket.get(key);

  if (!entry) {
    entry = { tokens: limit - 1, lastRefill: now };
    bucket.set(key, entry);
    return { allowed: true, remaining: limit - 1, resetSeconds: windowSeconds };
  }

  // Calculate elapsed time and replenish tokens proportionally
  const timeElapsed = now - entry.lastRefill;
  const tokensToAdd = (timeElapsed / windowMs) * limit;

  entry.tokens = Math.min(limit, entry.tokens + tokensToAdd);
  entry.lastRefill = now;

  if (entry.tokens >= 1) {
    entry.tokens -= 1;
    bucket.set(key, entry);
    return {
      allowed: true,
      remaining: Math.floor(entry.tokens),
      resetSeconds: Math.ceil(((limit - entry.tokens) / limit) * windowSeconds)
    };
  } else {
    bucket.set(key, entry);
    return {
      allowed: false,
      remaining: 0,
      resetSeconds: Math.ceil(((1 - entry.tokens) / limit) * windowSeconds)
    };
  }
}

/**
 * Utility to extract a reliable client identifier from NextRequest headers.
 */
export function getClientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return headers.get('x-real-ip') || '127.0.0.1';
}
