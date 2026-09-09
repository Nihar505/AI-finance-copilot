/**
 * Structured application logger for AI Finance Copilot.
 *
 * Emits JSON lines in production (suitable for log aggregators like Datadog,
 * Cloud Logging, Loki) and human-readable output in development.
 *
 * SECURITY RULES — never log:
 *   - Passwords or password hashes
 *   - Session tokens or API keys
 *   - Full transaction payloads (log IDs + amounts only)
 *   - PII beyond what's needed for tracing (use user IDs, not names)
 */

const IS_PROD = process.env.NODE_ENV === 'production';
const IS_TEST = process.env.NODE_ENV === 'test';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  route?: string;
  method?: string;
  orgId?: string;
  userId?: string;
  durationMs?: number;
  statusCode?: number;
  entityId?: string;
  entityType?: string;
  err?: string;
  [key: string]: unknown;
}

function emit(level: LogLevel, msg: string, ctx: LogContext = {}): void {
  // Suppress all output during tests to keep test output clean
  if (IS_TEST) return;

  const entry = {
    level,
    ts: new Date().toISOString(),
    msg,
    ...ctx,
  };

  if (IS_PROD) {
    // Structured JSON line — consumed by log aggregators
    process.stdout.write(JSON.stringify(entry) + '\n');
  } else {
    // Human-readable for local dev
    const prefix = `[${entry.ts}] ${level.toUpperCase().padEnd(5)}`;
    const ctxStr = Object.keys(ctx).length > 0
      ? ' ' + Object.entries(ctx)
          .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
          .join(' ')
      : '';
    const out = `${prefix} ${msg}${ctxStr}`;

    if (level === 'error') {
      process.stderr.write(out + '\n');
    } else {
      process.stdout.write(out + '\n');
    }
  }
}

const logger = {
  debug: (msg: string, ctx?: LogContext) => emit('debug', msg, ctx),
  info:  (msg: string, ctx?: LogContext) => emit('info',  msg, ctx),
  warn:  (msg: string, ctx?: LogContext) => emit('warn',  msg, ctx),
  error: (msg: string, ctx?: LogContext) => emit('error', msg, ctx),

  /**
   * Log a completed API request with method, route, status, and duration.
   * Call this at the end of every route handler.
   */
  request: (method: string, route: string, statusCode: number, durationMs: number, ctx?: LogContext) => {
    emit(statusCode >= 500 ? 'error' : 'info', 'API request', {
      method,
      route,
      statusCode,
      durationMs,
      ...ctx,
    });
  },

  /**
   * Log an AI model call with timing and outcome.
   * Never log the prompt content — log only metadata.
   */
  aiCall: (model: string, durationMs: number, success: boolean, ctx?: LogContext) => {
    emit(success ? 'info' : 'warn', 'AI model call', {
      model,
      durationMs,
      success,
      ...ctx,
    });
  },
};

export default logger;
