import fs from 'fs';
import path from 'path';
import type { Pool as PgPool } from 'pg';

export interface QueryResult<T = any> {
  rows: T[];
  rowCount?: number;
}

export interface DbClient {
  query<T = any>(text: string, params?: any[]): Promise<QueryResult<T>>;
  exec(text: string): Promise<void>;
  transaction<T>(callback: (client: DbClient) => Promise<T>): Promise<T>;
  engineType?: 'pglite' | 'postgres';
}

export interface DbHealthResult {
  status: 'healthy' | 'unhealthy';
  engine: 'pglite' | 'postgres';
  latencyMs: number;
  error?: string;
}

declare global {
  // eslint-disable-next-line no-var
  var _pgPool: PgPool | undefined;
  // eslint-disable-next-line no-var
  var _pgliteInstance: any | undefined;
}

let dbInstance: DbClient | null = null;
let isInitialized = false;

function resolveSslConfig() {
  const caCertEnv = process.env.DATABASE_CA_CERT;
  let ca: string | undefined;

  if (caCertEnv) {
    if (fs.existsSync(caCertEnv)) {
      ca = fs.readFileSync(caCertEnv, 'utf8');
    } else {
      ca = caCertEnv;
    }
  }

  return {
    rejectUnauthorized: true, // Strict TLS verification mandated
    ...(ca ? { ca } : {}),
  };
}

async function createDbClient(): Promise<DbClient> {
  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl) {
    // External PostgreSQL via standard pg pool
    const { Pool } = await import('pg');

    if (!globalThis._pgPool) {
      globalThis._pgPool = new Pool({
        connectionString: databaseUrl,
        max: 2,
        idleTimeoutMillis: 10000,
        connectionTimeoutMillis: 5000,
        ssl: databaseUrl.includes('sslmode=disable') ? false : resolveSslConfig(),
      });
    }

    const pool = globalThis._pgPool;

    const client: DbClient = {
      engineType: 'postgres',
      async query<T = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
        const res = await pool.query(text, params);
        return { rows: res.rows as T[], rowCount: res.rowCount || 0 };
      },
      async exec(text: string): Promise<void> {
        await pool.query(text);
      },
      async transaction<T>(callback: (trx: DbClient) => Promise<T>): Promise<T> {
        const pgClient = await pool.connect();
        try {
          await pgClient.query('BEGIN');
          const trxClient: DbClient = {
            engineType: 'postgres',
            async query<R = any>(text: string, params?: any[]) {
              const res = await pgClient.query(text, params);
              return { rows: res.rows as R[], rowCount: res.rowCount || 0 };
            },
            async exec(text: string) {
              await pgClient.query(text);
            },
            async transaction() {
              throw new Error('Nested transactions are not supported');
            }
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
      }
    };
    return client;
  } else {
    // In-process persistent PostgreSQL via @electric-sql/pglite
    const { PGlite } = await import('@electric-sql/pglite');
    
    if (!globalThis._pgliteInstance) {
      const dataDir = path.join(process.cwd(), 'data', 'postgres');
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      globalThis._pgliteInstance = new PGlite(dataDir);
    }

    const pglite = globalThis._pgliteInstance;

    const client: DbClient = {
      engineType: 'pglite',
      async query<T = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
        const res = await pglite.query(text, params);
        return { rows: res.rows as T[], rowCount: res.rows?.length || 0 };
      },
      async exec(text: string): Promise<void> {
        await pglite.exec(text);
      },
      async transaction<T>(callback: (trx: DbClient) => Promise<T>): Promise<T> {
        return await pglite.transaction(async (tx: any) => {
          const txClient: DbClient = {
            engineType: 'pglite',
            async query<R = any>(text: string, params?: any[]) {
              const res = await tx.query(text, params);
              return { rows: res.rows as R[], rowCount: res.rows?.length || 0 };
            },
            async exec(text: string) {
              await tx.exec(text);
            },
            async transaction() {
              throw new Error('Nested transactions are not supported');
            }
          };
          return await callback(txClient);
        });
      }
    };
    return client;
  }
}

export async function checkDbHealth(client?: DbClient): Promise<DbHealthResult> {
  const start = Date.now();
  const db = client || (await getDb());
  const engine = db.engineType || 'pglite';

  try {
    const res = await db.query('SELECT 1 as ping');
    const latencyMs = Date.now() - start;
    if (res.rows && res.rows.length > 0) {
      return {
        status: 'healthy',
        engine,
        latencyMs,
      };
    }
    return {
      status: 'unhealthy',
      engine,
      latencyMs,
      error: 'Query returned empty result set',
    };
  } catch (err: any) {
    return {
      status: 'unhealthy',
      engine,
      latencyMs: Date.now() - start,
      error: err.message || String(err),
    };
  }
}

export async function getDb(): Promise<DbClient> {
  if (!dbInstance) {
    dbInstance = await createDbClient();
  }

  if (!isInitialized) {
    await initializeDatabase(dbInstance);
    isInitialized = true;
  }

  return dbInstance;
}

export function resetDbState(): void {
  dbInstance = null;
  isInitialized = false;
  if (globalThis._pgPool) {
    globalThis._pgPool.end().catch(() => {});
    globalThis._pgPool = undefined;
  }
  globalThis._pgliteInstance = undefined;
}

async function initializeDatabase(db: DbClient): Promise<void> {
  try {
    const { runMigrations } = await import('./migrations');
    await runMigrations(db);
  } catch (error) {
    console.error('Error initializing database migrations:', error);
    throw error;
  }
}
