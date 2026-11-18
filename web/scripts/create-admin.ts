// Creates (or promotes) the first admin account and prints a link to set its password.
//   npm run create-admin -- you@cobsci.com "Your Name"
// The admin then signs in, is sent to set up two-step verification, and can use /admin.
import { loadEnv } from './load-env'
loadEnv()
const { pool, one, q } = await import('../src/lib/db')
const { randomToken, sha256 } = await import('../src/lib/crypto')
const { migrate } = await import('./migrate')

const [email, name = ''] = process.argv.slice(2)
if (!email) {
  console.error('usage: npm run create-admin -- you@example.com "Your Name"')
  process.exit(1)
}
await migrate(false)
const e = email.toLowerCase()
let u = await one<{ id: string }>('SELECT id FROM users WHERE lower(email) = $1', [e])
if (u) await q(`UPDATE users SET role = 'admin' WHERE id = $1`, [u.id])
else u = await one<{ id: string }>(`INSERT INTO users (email, name, role) VALUES ($1,$2,'admin') RETURNING id`, [e, name])
const raw = randomToken(32)
await q(`INSERT INTO tokens (id_hash, kind, user_id, expires_at) VALUES ($1,'set_password',$2, now() + interval '7 days')`, [sha256(raw), u!.id])
console.log(`\n${e} is an admin. Set the password here (valid 7 days):\n  ${(process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '')}/set-password/${raw}\n`)
await pool().end()
