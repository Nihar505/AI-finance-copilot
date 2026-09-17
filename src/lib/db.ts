/**
 * src/lib/db.ts
 *
 * Single entry point for all database access.
 *
 * Runtime routing:
 *   DATABASE_URL set   → managed PostgreSQL (Neon / Supabase / RDS, etc.)
 *   DATABASE_URL unset → embedded PGlite in ./data/postgres (local dev only)
 *
 * Serverless safety:
 *   The pg.Pool is cached on globalThis._pgPool so Next.js hot-reloads and
 *   serverless function invocations share the same pool instance instead of
 *   opening a new connection for every request.
 *
 * TLS policy:
 *   rejectUnauthorized is ALWAYS true.  Supply a provider CA bundle via
 *   DATABASE_CA_CERT (PEM string in env var) or DATABASE_CA_CERT_FILE (path)
 *   when connecting to a self-signed or private CA — never disable cert
 *   verification.
 */

import fs from 'fs';
import path from 'path';
import { runMigrations } from './migrations';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface QueryResult<T = any> {
  rows: T[];
  rowCount?: number;
}

export interface DbClient {
  query<T = any>(text: string, params?: any[]): Promise<QueryResult<T>>;
  exec(text: string): Promise<void>;
  transaction<T>(callback: (client: DbClient) => Promise<T>): Promise<T>;
}

export interface DbHealth {
  ok: boolean;
  engine: 'postgres' | 'pglite';
  latencyMs?: number;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Module-level state (shared across hot-reloads via globalThis)
// ─────────────────────────────────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var _pgPool: import('pg').Pool | undefined;
}

let _pgliteInstance: any | null = null;     // PGlite singleton
let _initialized = false;                   // schema/migrations run flag
let _dbClient: DbClient | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// TLS helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildSslConfig(): import('pg').PoolConfig['ssl'] {
  const caCert =
    process.env.DATABASE_CA_CERT ??
    (process.env.DATABASE_CA_CERT_FILE
      ? fs.readFileSync(process.env.DATABASE_CA_CERT_FILE, 'utf8')
      : undefined);

  // Always verify the server certificate.  If the provider uses a private CA
  // (e.g. Neon / Supabase), supply the CA bundle via DATABASE_CA_CERT.
  const ssl: import('tls').ConnectionOptions = { rejectUnauthorized: true };
  if (caCert) ssl.ca = caCert;
  return ssl;
}

// ─────────────────────────────────────────────────────────────────────────────
// PostgreSQL client (managed DB)
// ─────────────────────────────────────────────────────────────────────────────

async function buildPostgresClient(databaseUrl: string): Promise<DbClient> {
  const { Pool } = await import('pg');

  // Re-use the cached pool if available (critical for serverless environments).
  if (!globalThis._pgPool) {
    globalThis._pgPool = new Pool({
      connectionString: databaseUrl,
      ssl: buildSslConfig(),
      // Serverless-safe sizing: keep a small pool per container worker.
      max: 2,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    });

    globalThis._pgPool.on('error', (err) => {
      console.error('[db] Unexpected pool error', err);
    });
  }

  const pool = globalThis._pgPool;

  return {
    async query<T = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
      const res = await pool.query(text, params);
      return { rows: res.rows as T[], rowCount: res.rowCount ?? 0 };
    },

    async exec(text: string): Promise<void> {
      await pool.query(text);
    },

    async transaction<T>(callback: (trx: DbClient) => Promise<T>): Promise<T> {
      const pgClient = await pool.connect();
      try {
        await pgClient.query('BEGIN');

        const trxClient: DbClient = {
          async query<R = any>(text: string, params?: any[]): Promise<QueryResult<R>> {
            const res = await pgClient.query(text, params);
            return { rows: res.rows as R[], rowCount: res.rowCount ?? 0 };
          },
          async exec(text: string): Promise<void> {
            await pgClient.query(text);
          },
          async transaction<U>(): Promise<U> {
            throw new Error('[db] Nested transactions are not supported');
          },
        };

        const result = await callback(trxClient);
        await pgClient.query('COMMIT');
        return result;
      } catch (err) {
        await pgClient.query('ROLLBACK');
        throw err;
      } finally {
        pgClient.release();
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PGlite client (local dev fallback)
// ─────────────────────────────────────────────────────────────────────────────

async function buildPgliteClient(): Promise<DbClient> {
  const { PGlite } = await import('@electric-sql/pglite');
  const dataDir = path.join(process.cwd(), 'data', 'postgres');

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!_pgliteInstance) {
    _pgliteInstance = new PGlite(dataDir);
  }

  const pglite = _pgliteInstance;

  return {
    async query<T = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
      const res = await pglite.query(text, params);
      return { rows: (res.rows ?? []) as T[], rowCount: res.rows?.length ?? 0 };
    },

    async exec(text: string): Promise<void> {
      await pglite.exec(text);
    },

    async transaction<T>(callback: (trx: DbClient) => Promise<T>): Promise<T> {
      return await pglite.transaction(async (tx: any) => {
        const txClient: DbClient = {
          async query<R = any>(text: string, params?: any[]): Promise<QueryResult<R>> {
            const res = await tx.query(text, params);
            return { rows: (res.rows ?? []) as R[], rowCount: res.rows?.length ?? 0 };
          },
          async exec(text: string): Promise<void> {
            await tx.exec(text);
          },
          async transaction<U>(): Promise<U> {
            throw new Error('[db] Nested transactions are not supported');
          },
        };
        return await callback(txClient);
      });
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Initialisation (schema + migrations, run once per process)
// ─────────────────────────────────────────────────────────────────────────────

async function initializeDatabase(db: DbClient): Promise<void> {
  await runMigrations(db);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export async function getDb(): Promise<DbClient> {
  if (!_dbClient) {
    const databaseUrl = process.env.DATABASE_URL;
    _dbClient = databaseUrl
      ? await buildPostgresClient(databaseUrl)
      : await buildPgliteClient();
  }

  if (!_initialized) {
    await initializeDatabase(_dbClient);
    _initialized = true;
  }

  return _dbClient;
}

/**
 * Check database connectivity and measure round-trip latency.
 * Safe to call from health-check routes without side-effects.
 */
export async function checkDbHealth(): Promise<DbHealth> {
  const databaseUrl = process.env.DATABASE_URL;
  const engine: DbHealth['engine'] = databaseUrl ? 'postgres' : 'pglite';

  try {
    const db = await getDb();
    const start = Date.now();
    await db.query('SELECT 1');
    return { ok: true, engine, latencyMs: Date.now() - start };
  } catch (err: any) {
    return { ok: false, engine, error: err?.message ?? String(err) };
  }
}

/**
 * Reset the module-level singletons.
 * Only intended for use inside unit tests — do not call in production.
 */
export function _resetDbForTesting(): void {
  _dbClient = null;
  _initialized = false;
  _pgliteInstance = null;
  if (globalThis._pgPool) {
    globalThis._pgPool.end().catch(() => {});
    globalThis._pgPool = undefined;
  }
}
