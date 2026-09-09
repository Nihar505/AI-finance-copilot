import fs from 'fs';
import path from 'path';

export interface QueryResult<T = any> {
  rows: T[];
  rowCount?: number;
}

export interface DbClient {
  query<T = any>(text: string, params?: any[]): Promise<QueryResult<T>>;
  exec(text: string): Promise<void>;
  transaction<T>(callback: (client: DbClient) => Promise<T>): Promise<T>;
}

let dbInstance: DbClient | null = null;
let isInitialized = false;

async function createDbClient(): Promise<DbClient> {
  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl) {
    // External PostgreSQL via standard pg pool
    const { Pool } = await import('pg');
    const pool = new Pool({
      connectionString: databaseUrl,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
    });

    const client: DbClient = {
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
    const dataDir = path.join(process.cwd(), 'data', 'postgres');
    
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const pglite = new PGlite(dataDir);

    const client: DbClient = {
      async query<T = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
        const res = await pglite.query<T>(text, params);
        return { rows: res.rows, rowCount: res.rows?.length || 0 };
      },
      async exec(text: string): Promise<void> {
        await pglite.exec(text);
      },
      async transaction<T>(callback: (trx: DbClient) => Promise<T>): Promise<T> {
        return await pglite.transaction(async (tx) => {
          const txClient: DbClient = {
            async query<R = any>(text: string, params?: any[]) {
              const res = await tx.query<R>(text, params);
              return { rows: res.rows, rowCount: res.rows?.length || 0 };
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

async function initializeDatabase(db: DbClient): Promise<void> {
  try {
    const schemaPath = path.join(process.cwd(), 'src', 'lib', 'schema.sql');
    if (fs.existsSync(schemaPath)) {
      const sql = fs.readFileSync(schemaPath, 'utf8');
      await db.exec(sql);
    }
  } catch (error) {
    console.error('Error initializing PostgreSQL schema:', error);
    throw error;
  }
}
