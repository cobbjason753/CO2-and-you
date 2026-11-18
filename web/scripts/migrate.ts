// Applies migrations/*.sql in order, once each. Usage: npm run migrate
import fs from 'node:fs'
import path from 'node:path'
import { loadEnv } from './load-env'
loadEnv()
// Schema changes go over a direct connection when one is configured (Neon: the non-pooler URL).
if (process.env.DATABASE_URL_UNPOOLED) process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED
const { pool } = await import('../src/lib/db')

export async function migrate(log = true) {
  const p = pool()
  await p.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
  const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'migrations')
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  const done = new Set((await p.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name))
  for (const f of files) {
    if (done.has(f)) continue
    const c = await p.connect()
    try {
      await c.query('BEGIN')
      await c.query(fs.readFileSync(path.join(dir, f), 'utf8'))
      await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f])
      await c.query('COMMIT')
      if (log) console.log('applied', f)
    } catch (e) {
      await c.query('ROLLBACK')
      throw e
    } finally {
      c.release()
    }
  }
}

if (process.argv[1]?.endsWith('migrate.ts')) {
  await migrate()
  await pool().end()
}
