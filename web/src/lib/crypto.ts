import crypto from 'node:crypto'

export const sha256 = (s: string | Buffer) => crypto.createHash('sha256').update(s).digest('hex')

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url')

// Crockford base32: no I, L, O, U, so codes survive being read aloud or typed from a label.
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export function randomB32(len: number): string {
  const bytes = crypto.randomBytes(len)
  let s = ''
  for (let i = 0; i < len; i++) s += B32[bytes[i] & 31]
  return s
}

/** HOUSE_ID: random, never a security boundary (every query is scoped by membership). */
export const newHouseId = () => 'H' + randomB32(9)

/** Claim code printed on the unit: XXXX-XXXX-XXXX (60 bits). */
export const newClaimCode = () => {
  const s = randomB32(12)
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`
}

export function normalizeClaimCode(input: string): string {
  const s = input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
  return s
}

export const hashClaimCode = (code: string) => sha256('claim:' + normalizeClaimCode(code))

// ---- passwords (scrypt, built into Node; no native deps) ----
export async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.randomBytes(16)
  const key = await new Promise<Buffer>((res, rej) =>
    crypto.scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? rej(e) : res(k))),
  )
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`
}

export async function verifyPassword(pw: string, stored: string | null): Promise<boolean> {
  if (!stored) return false
  const [alg, saltB64, keyB64] = stored.split('$')
  if (alg !== 'scrypt') return false
  const salt = Buffer.from(saltB64, 'base64')
  const expected = Buffer.from(keyB64, 'base64')
  const key = await new Promise<Buffer>((res, rej) =>
    crypto.scrypt(pw, salt, expected.length, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? rej(e) : res(k))),
  )
  return crypto.timingSafeEqual(key, expected)
}

// ---- symmetric encryption for device secrets and TOTP seeds ----
function key(): Buffer {
  const s = process.env.APP_SECRET
  if (!s || s.length < 16) throw new Error('APP_SECRET must be set (16+ characters)')
  return crypto.createHash('sha256').update('cobsci-enc:' + s).digest()
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv)
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':')
}

export function decrypt(blob: string): string {
  const [v, ivB, tagB, ctB] = blob.split(':')
  if (v !== 'v1') throw new Error('unknown ciphertext version')
  const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB, 'base64'))
  d.setAuthTag(Buffer.from(tagB, 'base64'))
  return Buffer.concat([d.update(Buffer.from(ctB, 'base64')), d.final()]).toString('utf8')
}

export function hmacHex(secret: string, msg: string | Buffer): string {
  return crypto.createHmac('sha256', Buffer.from(secret, 'hex')).update(msg).digest('hex')
}

export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length || !/^[0-9a-f]*$/i.test(a)) return false
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
}
