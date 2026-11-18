'use server'

import { redirect } from 'next/navigation'
import { q, one, tx } from '@/lib/db'
import { createSession, getAuth, checkTotp, userTotpSecret, clientIp, destroySession } from '@/lib/auth'
import { hashPassword, verifyPassword, randomToken, sha256 } from '@/lib/crypto'
import { rateLimit } from '@/lib/ratelimit'
import { sendEmail } from '@/lib/email'
import { env } from '@/lib/env'
import { str, type FormState } from '@/lib/action'
import { audit } from '@/lib/audit'

const MIN_PW = 10
const safeNext = (n: string) => (n.startsWith('/') && !n.startsWith('//') ? n : '')

export async function login(_: FormState, d: FormData): Promise<FormState> {
  const email = str(d, 'email').toLowerCase()
  const password = String(d.get('password') ?? '')
  const ip = await clientIp()
  if (!(await rateLimit(`login:${email}`, 10, 900)) || !(await rateLimit(`login-ip:${ip}`, 50, 900)))
    return { error: 'Too many attempts. Wait 15 minutes and try again.' }
  const user = await one<{ id: string; password_hash: string | null; totp_enabled: boolean; role: string }>(
    'SELECT id, password_hash, totp_enabled, role FROM users WHERE lower(email) = $1',
    [email],
  )
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return { error: user && !user.password_hash ? 'Use the link in your welcome email to set a password first, or reset it below.' : 'Email or password is wrong.' }
  }
  await createSession(user.id, !user.totp_enabled)
  const next = safeNext(str(d, 'next'))
  if (user.totp_enabled) redirect(`/login/2fa${next ? `?next=${encodeURIComponent(next)}` : ''}`)
  redirect(next || (user.role === 'customer' ? '/app' : '/admin'))
}

export async function verify2fa(_: FormState, d: FormData): Promise<FormState> {
  const auth = await getAuth()
  if (!auth) redirect('/login')
  if (!(await rateLimit(`2fa:${auth.user.id}`, 10, 900))) return { error: 'Too many attempts. Wait 15 minutes.' }
  const secret = await userTotpSecret(auth.user.id)
  if (!secret || !checkTotp(auth.user.email, secret, str(d, 'code'))) return { error: 'That code is not right. Codes change every 30 seconds.' }
  await q('UPDATE sessions SET mfa_ok = true WHERE id_hash = $1', [auth.session.id_hash])
  if (auth.user.role !== 'customer') await audit(auth.user, 'staff.login', null, {}, await clientIp())
  redirect(safeNext(str(d, 'next')) || (auth.user.role === 'customer' ? '/app' : '/admin'))
}

export async function forgot(_: FormState, d: FormData): Promise<FormState> {
  const email = str(d, 'email').toLowerCase()
  const done = { ok: 'If that email has an account, a reset link is on its way. It works for 1 hour.' }
  if (!email || !(await rateLimit(`forgot:${email}`, 3, 3600))) return done
  const user = await one<{ id: string }>('SELECT id FROM users WHERE lower(email) = $1', [email])
  if (!user) return done
  const raw = randomToken(32)
  await q(`INSERT INTO tokens (id_hash, kind, user_id, expires_at) VALUES ($1,'reset_password',$2, now() + interval '1 hour')`, [sha256(raw), user.id])
  await sendEmail(email, 'Reset your CO2 & You password', 'Reset your password', [
    { p: 'Someone (hopefully you) asked to reset your password. This link works for 1 hour.' },
    { button: { label: 'Choose a new password', url: `${env.appUrl()}/reset/${raw}` } },
    { small: "If you didn't ask for this, you can ignore this email." },
  ], 'reset')
  return done
}

async function validToken(raw: string, kinds: string[]) {
  return one<{ id_hash: string; kind: string; user_id: string | null; email: string | null; data: any }>(
    `SELECT id_hash, kind, user_id, email, data FROM tokens WHERE id_hash = $1 AND kind = ANY($2) AND used_at IS NULL AND expires_at > now()`,
    [sha256(raw), kinds],
  )
}

export async function tokenStatus(raw: string, kinds: string[]) {
  const t = await validToken(raw, kinds)
  if (!t) return null
  if (t.kind === 'invite') {
    const h = await one<{ name: string }>('SELECT name FROM houses WHERE id = $1', [t.data.house_id])
    const existing = await one<{ password_hash: string | null }>('SELECT password_hash FROM users WHERE lower(email) = lower($1)', [t.email])
    return { kind: t.kind, email: t.email!, houseName: h?.name ?? 'a house', hasAccount: !!existing?.password_hash }
  }
  const u = await one<{ email: string; name: string }>('SELECT email, name FROM users WHERE id = $1', [t.user_id])
  return { kind: t.kind, email: u?.email ?? '', name: u?.name ?? '', houseName: '', hasAccount: false }
}

/** Welcome link (set_password) and reset link (reset_password). */
export async function setPassword(_: FormState, d: FormData): Promise<FormState> {
  const raw = str(d, 'token')
  const pw = String(d.get('password') ?? '')
  if (pw.length < MIN_PW) return { error: `Use at least ${MIN_PW} characters.` }
  if (pw !== String(d.get('confirm') ?? '')) return { error: "The two passwords don't match." }
  const t = await validToken(raw, ['set_password', 'reset_password'])
  if (!t?.user_id) return { error: 'This link has expired or was already used. Ask for a new one from the sign-in page.' }
  const hash = await hashPassword(pw)
  const name = str(d, 'name')
  await tx(async (c) => {
    await q('UPDATE tokens SET used_at = now() WHERE id_hash = $1', [t.id_hash], c)
    await q(`UPDATE users SET password_hash = $2, name = CASE WHEN $3 <> '' THEN $3 ELSE name END WHERE id = $1`, [t.user_id, hash, name], c)
    await q('DELETE FROM sessions WHERE user_id = $1', [t.user_id], c) // sign out everywhere else
  })
  const u = await one<{ totp_enabled: boolean }>('SELECT totp_enabled FROM users WHERE id = $1', [t.user_id])
  await createSession(t.user_id, !u!.totp_enabled)
  redirect(u!.totp_enabled ? '/login/2fa' : '/app')
}

/** Household invite: join as a viewer, creating an account if needed. */
export async function acceptInvite(_: FormState, d: FormData): Promise<FormState> {
  const raw = str(d, 'token')
  const t = await validToken(raw, ['invite'])
  if (!t?.email) return { error: 'This invite has expired or was already used. Ask the house owner to send a new one.' }
  const existing = await one<{ id: string; password_hash: string | null; totp_enabled: boolean }>(
    'SELECT id, password_hash, totp_enabled FROM users WHERE lower(email) = lower($1)',
    [t.email],
  )
  let userId: string
  if (existing?.password_hash) {
    // Existing account: must prove it's theirs with their password.
    if (!(await verifyPassword(String(d.get('password') ?? ''), existing.password_hash))) return { error: 'Password is wrong for this account.' }
    userId = existing.id
  } else {
    const pw = String(d.get('password') ?? '')
    if (pw.length < MIN_PW) return { error: `Use at least ${MIN_PW} characters.` }
    const hash = await hashPassword(pw)
    if (existing) {
      await q(`UPDATE users SET password_hash = $2, name = $3 WHERE id = $1`, [existing.id, hash, str(d, 'name')])
      userId = existing.id
    } else {
      const u = await one<{ id: string }>('INSERT INTO users (email, name, password_hash) VALUES ($1,$2,$3) RETURNING id', [t.email.toLowerCase(), str(d, 'name'), hash])
      userId = u!.id
    }
  }
  await tx(async (c) => {
    await q('UPDATE tokens SET used_at = now() WHERE id_hash = $1', [t.id_hash], c)
    await q(`INSERT INTO house_members (house_id, user_id, role) VALUES ($1,$2,'viewer') ON CONFLICT DO NOTHING`, [t.data.house_id, userId], c)
  })
  await createSession(userId, !existing?.totp_enabled)
  await q('UPDATE sessions SET current_house_id = $2 WHERE user_id = $1', [userId, t.data.house_id])
  redirect(existing?.totp_enabled ? '/login/2fa' : '/app')
}

export async function logout() {
  await destroySession()
  redirect('/login')
}
