import 'server-only'
import { cache } from 'react'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { TOTP, Secret } from 'otpauth'
import { q, one } from './db'
import { randomToken, sha256, encrypt, decrypt } from './crypto'
import { env } from './env'

export const SESSION_COOKIE = 'cs_session'
const SESSION_DAYS = 30

export type User = {
  id: string
  email: string
  name: string
  role: 'customer' | 'staff' | 'admin'
  totp_enabled: boolean
  temp_unit: 'F' | 'C'
  weekly_report: boolean
  daily_report: boolean
  password_hash: string | null
  stripe_customer_id: string | null
}

export type Session = { id_hash: string; user_id: string; mfa_ok: boolean; current_house_id: string | null }

export async function createSession(userId: string, mfaOk: boolean) {
  const raw = randomToken(32)
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000)
  await q('INSERT INTO sessions (id_hash, user_id, mfa_ok, expires_at) VALUES ($1,$2,$3,$4)', [sha256(raw), userId, mfaOk, expires])
  await q('UPDATE users SET last_login_at = now() WHERE id = $1', [userId])
  const jar = await cookies()
  jar.set(SESSION_COOKIE, raw, {
    httpOnly: true,
    secure: env.isProd(),
    sameSite: 'lax',
    path: '/',
    expires,
  })
}

export async function destroySession() {
  const jar = await cookies()
  const raw = jar.get(SESSION_COOKIE)?.value
  if (raw) await q('DELETE FROM sessions WHERE id_hash = $1', [sha256(raw)])
  jar.delete(SESSION_COOKIE)
}

/** Current session + user, or null. Cached for the duration of one request. */
export const getAuth = cache(async (): Promise<{ session: Session; user: User } | null> => {
  const raw = (await cookies()).get(SESSION_COOKIE)?.value
  if (!raw) return null
  const row = await one(
    `SELECT s.id_hash, s.user_id, s.mfa_ok, s.current_house_id,
            u.id, u.email, u.name, u.role, u.totp_enabled, u.temp_unit, u.weekly_report, u.daily_report, u.password_hash, u.stripe_customer_id
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id_hash = $1 AND s.expires_at > now()`,
    [sha256(raw)],
  )
  if (!row) return null
  const { id_hash, user_id, mfa_ok, current_house_id, ...user } = row
  return { session: { id_hash, user_id, mfa_ok, current_house_id }, user: user as User }
})

/** Signed-in user (second factor done if enabled). Redirects to login otherwise. */
export async function requireUser(): Promise<{ session: Session; user: User }> {
  const auth = await getAuth()
  if (!auth) redirect('/login')
  if (!auth.session.mfa_ok) redirect('/login/2fa')
  return auth
}

/** Staff-only area. Two-factor is mandatory for staff. */
export async function requireStaff(opts: { adminOnly?: boolean } = {}) {
  const auth = await requireUser()
  const { user } = auth
  if (user.role === 'customer') redirect('/app')
  if (opts.adminOnly && user.role !== 'admin') redirect('/admin')
  if (!user.totp_enabled) redirect('/app/account/security?staff=1')
  return auth
}

export async function clientIp(): Promise<string> {
  const h = await headers()
  return (h.get('x-forwarded-for') || '').split(',')[0].trim() || h.get('x-real-ip') || ''
}

// ---- TOTP (authenticator app) ----
export function newTotpSecret(): string {
  return new Secret({ size: 20 }).base32
}

export function totpFor(email: string, secretB32: string) {
  return new TOTP({ issuer: 'CobSci', label: email, algorithm: 'SHA1', digits: 6, period: 30, secret: Secret.fromBase32(secretB32) })
}

export function checkTotp(email: string, secretB32: string, code: string): boolean {
  const clean = code.replace(/\s/g, '')
  if (!/^\d{6}$/.test(clean)) return false
  return totpFor(email, secretB32).validate({ token: clean, window: 1 }) !== null
}

export async function userTotpSecret(userId: string): Promise<string | null> {
  const row = await one<{ totp_secret: string | null }>('SELECT totp_secret FROM users WHERE id = $1', [userId])
  return row?.totp_secret ? decrypt(row.totp_secret) : null
}

export const encryptTotp = (s: string) => encrypt(s)
