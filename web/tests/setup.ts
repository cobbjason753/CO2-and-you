import fs from 'node:fs'
import path from 'node:path'
import { beforeAll } from 'vitest'

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres@localhost:5432/cobsci_test'
process.env.APP_SECRET = 'test-secret-0123456789abcdef'
process.env.APP_URL = 'http://test.local'
process.env.RESEND_API_KEY = ''

beforeAll(async () => {
  const { pool } = await import('../src/lib/db')
  const p = pool()
  await p.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  const dir = path.join(import.meta.dirname, '..', 'migrations')
  for (const f of fs.readdirSync(dir).sort()) await p.query(fs.readFileSync(path.join(dir, f), 'utf8'))
})
