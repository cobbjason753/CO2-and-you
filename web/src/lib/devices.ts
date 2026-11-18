import { q, one, tx, type Db } from './db'
import { hashClaimCode, newClaimCode, encrypt } from './crypto'
import { rateLimit } from './ratelimit'

export const DEVICE_ID_RE = /^esp32-[0-9A-F]{12}$/

export function normalizeDeviceId(s: string): string {
  const t = s.trim()
  const hex = t.replace(/^esp32-/i, '').replace(/[^0-9a-f]/gi, '').toUpperCase()
  return hex.length === 12 ? `esp32-${hex}` : t
}

/** Room by name in a house (case-insensitive), created if missing. */
export async function ensureRoom(c: Db, houseId: string, name: string): Promise<string> {
  const clean = name.trim().replace(/\s+/g, ' ').slice(0, 40)
  if (!clean) throw new Error('Room name is required')
  const found = await one<{ id: string }>('SELECT id FROM rooms WHERE house_id = $1 AND lower(name) = lower($2)', [houseId, clean], c)
  if (found) return found.id
  const row = await one<{ id: string }>('INSERT INTO rooms (house_id, name) VALUES ($1,$2) RETURNING id', [houseId, clean], c)
  return row!.id
}

/** Gives a device to a house. Closes any previous assignment. */
export async function assignDevice(c: Db, deviceId: string, houseId: string, how: 'packing' | 'claim' | 'staff', orderId: string | null = null) {
  await q('UPDATE device_assignments SET ended_at = now() WHERE device_id = $1 AND ended_at IS NULL', [deviceId], c)
  await q('INSERT INTO device_assignments (device_id, house_id, how) VALUES ($1,$2,$3)', [deviceId, houseId, how], c)
  await q(
    `UPDATE devices SET house_id = $2, room_id = NULL, status = 'assigned', assigned_at = now(), order_id = coalesce($3, order_id)
      WHERE id = $1`,
    [deviceId, houseId, orderId],
    c,
  )
  // A device that used the old on-device naming lands in a room with that name.
  const d = await one<{ legacy_location: string | null }>('SELECT legacy_location FROM devices WHERE id = $1', [deviceId], c)
  if (d?.legacy_location) {
    const roomId = await ensureRoom(c, houseId, prettifyLegacy(d.legacy_location))
    await q('UPDATE devices SET room_id = $2 WHERE id = $1', [deviceId, roomId], c)
  }
}

const prettifyLegacy = (s: string) => s.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())

/** Takes a device out of its house. Past readings stay with the house. */
export async function unassignDevice(c: Db, deviceId: string, status: 'in_stock' | 'returned' | 'defective' | 'revoked' = 'in_stock') {
  await q('UPDATE device_assignments SET ended_at = now() WHERE device_id = $1 AND ended_at IS NULL', [deviceId], c)
  await q(
    // claim_used_at is cleared so the label works again for the next owner (gift, resale).
    `UPDATE devices SET house_id = NULL, room_id = NULL, status = $2, assigned_at = NULL, target_fw = NULL, claim_used_at = NULL WHERE id = $1`,
    [deviceId, status],
    c,
  )
  await q(`UPDATE alert_events SET resolved_at = now() WHERE device_id = $1 AND resolved_at IS NULL`, [deviceId], c)
}

/**
 * A fresh claim code is issued whenever a device goes back into circulation, so a
 * previous owner who kept the label cannot reclaim it.
 */
export async function reissueClaimCode(c: Db, deviceId: string): Promise<string> {
  const code = newClaimCode()
  await q('UPDATE devices SET claim_code_hash = $2, claim_code_hint = $3, claim_used_at = NULL WHERE id = $1', [deviceId, hashClaimCode(code), code.slice(-4)], c)
  return code
}

export type ProvisionInput = { deviceId: string; fw: number | null; testResult: 'pass' | 'fail'; secretHex?: string | null; notes?: string }

export async function provisionDevice(c: Db, input: ProvisionInput): Promise<{ claimCode: string }> {
  const id = normalizeDeviceId(input.deviceId)
  if (!DEVICE_ID_RE.test(id)) throw new Error(`"${input.deviceId}" is not a DEVICE_ID (esp32- followed by 12 hex digits)`)
  const exists = await one('SELECT id FROM devices WHERE id = $1', [id], c)
  if (exists) throw new Error(`${id} is already registered`)
  if (input.secretHex && !/^[0-9a-f]{64}$/i.test(input.secretHex)) throw new Error('Device secret must be 64 hex characters')
  const claimCode = newClaimCode()
  const legacy = await one<{ legacy_location: string | null }>('SELECT legacy_location FROM unknown_devices WHERE device_id = $1', [id], c)
  await q(
    `INSERT INTO devices (id, claim_code_hash, claim_code_hint, test_result, fw_provisioned, secret_enc, secret_set_at, notes, legacy_location)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      id,
      hashClaimCode(claimCode),
      claimCode.slice(-4),
      input.testResult,
      input.fw,
      input.secretHex ? encrypt(input.secretHex.toLowerCase()) : null,
      input.secretHex ? new Date() : null,
      input.notes ?? '',
      legacy?.legacy_location ?? null,
    ],
    c,
  )
  await q('DELETE FROM unknown_devices WHERE device_id = $1', [id], c)
  return { claimCode }
}

export type ClaimResult = { ok: true; deviceId: string } | { ok: false; error: string }

/** Customer enters the claim code from the label. Codes are hashed, single use and rate-limited. */
export async function claimDevice(userId: string, houseId: string, code: string, roomName: string): Promise<ClaimResult> {
  if (!(await rateLimit(`claim:${userId}`, 10, 3600))) return { ok: false, error: 'Too many attempts. Try again in an hour.' }
  const hash = hashClaimCode(code)
  return tx(async (c) => {
    const d = await one<{ id: string; status: string; house_id: string | null; claim_used_at: Date | null; test_result: string }>(
      'SELECT id, status, house_id, claim_used_at, test_result FROM devices WHERE claim_code_hash = $1 FOR UPDATE',
      [hash],
      c,
    )
    if (!d || d.claim_used_at) return { ok: false, error: "That code didn't match a device. Check it and try again." } as const
    if (d.house_id === houseId) return { ok: false, error: 'That device is already in this house.' } as const
    if (d.house_id || d.status !== 'in_stock') return { ok: false, error: 'That device belongs to someone else. Contact support if you think this is wrong.' } as const
    if (d.test_result !== 'pass') return { ok: false, error: 'That device did not pass its factory test. Please contact support.' } as const
    await assignDevice(c, d.id, houseId, 'claim')
    await q('UPDATE devices SET claim_used_at = now() WHERE id = $1', [d.id], c)
    if (roomName.trim()) {
      const roomId = await ensureRoom(c, houseId, roomName)
      await q('UPDATE devices SET room_id = $2 WHERE id = $1', [d.id, roomId], c)
    }
    return { ok: true, deviceId: d.id } as const
  })
}
