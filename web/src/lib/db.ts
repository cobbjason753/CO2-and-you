import { Pool, type PoolClient, type QueryResultRow } from 'pg'

// One pool per server process. On Vercel each function instance keeps its own small pool;
// use Neon's *pooled* connection string so that stays cheap.
const globalForPool = globalThis as unknown as { __pgPool?: Pool }

export function pool(): Pool {
  if (!globalForPool.__pgPool) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is not set')
    const local = /localhost|127\.0\.0\.1/.test(url)
    globalForPool.__pgPool = new Pool({
      connectionString: url,
      max: local ? 10 : 3,
      ssl: local ? undefined : { rejectUnauthorized: true },
    })
  }
  return globalForPool.__pgPool
}

type Queryable = Pool | PoolClient

export async function q<T extends QueryResultRow = any>(sql: string, params: unknown[] = [], c?: Queryable): Promise<T[]> {
  const res = await (c ?? pool()).query<T>(sql, params as any[])
  return res.rows
}

export async function one<T extends QueryResultRow = any>(sql: string, params: unknown[] = [], c?: Queryable): Promise<T | null> {
  const rows = await q<T>(sql, params, c)
  return rows[0] ?? null
}

export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool().connect()
  try {
    await c.query('BEGIN')
    const out = await fn(c)
    await c.query('COMMIT')
    return out
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    c.release()
  }
}

export type Db = Queryable
