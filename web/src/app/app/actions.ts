'use server'

import { redirect } from 'next/navigation'
import { qrSvg } from '@/lib/barcode'
import { q, one, tx, pool } from '@/lib/db'
import { requireUser, newTotpSecret, totpFor, checkTotp, encryptTotp, userTotpSecret, clientIp, destroySession } from '@/lib/auth'
import { requireHouse, housesFor, createHouse } from '@/lib/houses'
import { claimDevice, ensureRoom, unassignDevice } from '@/lib/devices'
import { hashPassword, verifyPassword, randomToken, sha256 } from '@/lib/crypto'
import { sendEmail } from '@/lib/email'
import { sendTestReport } from '@/lib/reports'
import { billingPortalUrl } from '@/lib/billing'
import { rateLimit } from '@/lib/ratelimit'
import { audit } from '@/lib/audit'
import { env } from '@/lib/env'
import { run, str, int, UserError, type FormState } from '@/lib/action'

// ---------- house switching ----------
export async function switchHouse(d: FormData) {
  const { user, session } = await requireUser()
  const id = str(d, 'house')
  const houses = await housesFor(user.id)
  if (houses.some((h) => h.id === id)) await q('UPDATE sessions SET current_house_id = $2 WHERE id_hash = $1', [session.id_hash, id])
  redirect(str(d, 'back').startsWith('/app') ? str(d, 'back') : '/app')
}

// ---------- devices & rooms ----------
/** Device must be in the current house. Returns it with its room. */
async function ownedDevice(houseId: string, deviceId: string) {
  const dev = await one<{ id: string; room_id: string | null }>('SELECT id, room_id FROM devices WHERE id = $1 AND house_id = $2', [deviceId, houseId])
  if (!dev) throw new UserError('That device is not in this house.')
  return dev
}

const cleanName = (s: string) => {
  const n = s.replace(/\s+/g, ' ').trim()
  if (!n) throw new UserError('Enter a name.')
  if (n.length > 40) throw new UserError('Keep names to 40 characters.')
  return n
}

/**
 * Name or rename a device's location. If it is the only device in its room, the room is
 * renamed (history follows the new name). If another room already has that name, the device
 * joins it. Replaces the House ID / Location ID fields of the on-device setup page.
 */
export async function nameDevice(_: FormState, d: FormData): Promise<FormState> {
  return run(async () => {
    const { house, user } = await requireHouse({ owner: true })
    const dev = await ownedDevice(house.id, str(d, 'device'))
    const name = cleanName(str(d, 'name'))
    await tx(async (c) => {
      const clash = await one<{ id: string }>('SELECT id FROM rooms WHERE house_id = $1 AND lower(name) = lower($2)', [house.id, name], c)
      if (dev.room_id) {
        const alone = await one<{ n: number }>('SELECT count(*)::int AS n FROM devices WHERE room_id = $1', [dev.room_id], c)
        if (!clash && alone!.n === 1) {
          await q('UPDATE rooms SET name = $2 WHERE id = $1', [dev.room_id, name], c)
          return
        }
        if (clash?.id === dev.room_id) {
          await q('UPDATE rooms SET name = $2 WHERE id = $1', [dev.room_id, name], c) // capitalisation change
          return
        }
      }
      const roomId = clash?.id ?? (await ensureRoom(c, house.id, name))
      await q('UPDATE devices SET room_id = $2 WHERE id = $1', [dev.id, roomId], c)
    })
    await audit(user, 'device.rename', { type: 'device', id: dev.id }, { name })
    return `Saved. The sensor shows "${name}" after its next upload (within 5 minutes).`
  }, '/app')
}

/** Move a device to a different room. Earlier readings stay with the room they were taken in. */
export async function moveDevice(_: FormState, d: FormData): Promise<FormState> {
  return run(async () => {
    const { house, user } = await requireHouse({ owner: true })
    const dev = await ownedDevice(house.id, str(d, 'device'))
    const target = str(d, 'room')
    let roomId: string
    if (target === '__new') {
      roomId = await ensureRoom(pool(), house.id, cleanName(str(d, 'new_room')))
    } else {
      const r = await one<{ id: string }>('SELECT id FROM rooms WHERE id = $1 AND house_id = $2', [target, house.id])
      if (!r) throw new UserError('Choose a room.')
      roomId = r.id
    }
    await q('UPDATE devices SET room_id = $2 WHERE id = $1', [dev.id, roomId])
    await audit(user, 'device.move', { type: 'device', id: dev.id }, { room: roomId })
    return 'Moved.'
  }, '/app')
}

/** Owner turns a sensor's screen and LED on or off. Reaches the sensor with its next upload. */
export async function setDisplay(_: FormState, d: FormData): Promise<FormState> {
  return run(async () => {
    const { house, user } = await requireHouse({ owner: true })
    const dev = await ownedDevice(house.id, str(d, 'device'))
    const on = str(d, 'on') === 'true'
    await q('UPDATE devices SET display_on = $2 WHERE id = $1', [dev.id, on])
    await audit(user, 'device.display', { type: 'device', id: dev.id }, { on })
    return on ? 'Screen and light on. The sensor updates within 5 minutes.' : 'Screen and light off. The sensor updates within 5 minutes.'
  }, '/app/devices')
}

export async function removeDevice(_: FormState, d: FormData): Promise<FormState> {
  return run(async () => {
    const { house, user } = await requireHouse({ owner: true })
    const dev = await ownedDevice(house.id, str(d, 'device'))
    await tx(async (c) => {
      await unassignDevice(c, dev.id, 'in_stock')
      await audit(user, 'device.remove_by_customer', { type: 'device', id: dev.id }, { house: house.id }, '', c)
    })
    return 'Removed. Its past readings stay in your history. Anyone with the claim code on its label can now add it to their house.'
  }, '/app')
}

export async function claim(_: FormState, d: FormData): Promise<FormState> {
  const { house, user } = await requireHouse({ owner: true }).catch(() => {
    throw new UserError('Only house owners can add devices.')
  })
  const r = await claimDevice(user.id, house.id, str(d, 'code'), str(d, 'room'))
  if (!r.ok) return { error: r.error }
  await audit(user, 'device.claim', { type: 'device', id: r.deviceId }, { house: house.id })
  redirect('/app/devices?claimed=1')
}

export async function renameRoom(_: FormState, d: FormData): Promise<FormState> {
  return run(async () => {
    const { house } = await requireHouse({ owner: true })
    const name = cleanName(str(d, 'name'))
    const clash = await one('SELECT 1 FROM rooms WHERE house_id = $1 AND lower(name) = lower($2) AND id <> $3', [house.id, name, str(d, 'room')])
    if (clash) throw new UserError('Room names must be different.')
    await q('UPDATE rooms SET name = $3 WHERE id = $1 AND house_id = $2', [str(d, 'room'), house.id, name])
    return 'Renamed.'
  }, '/app')
}

export async function deleteRoom(_: FormState, d: FormData): Promise<FormState> {
  return run(async () => {
    const { house } = await requireHouse({ owner: true })
    const inUse = await one('SELECT 1 FROM devices WHERE room_id = $1', [str(d, 'room')])
    if (inUse) throw new UserError('Move its sensor to another room first.')
    // Readings keep room_id; history shows them as "Unnamed" once the room is gone.
    await q('DELETE FROM rooms WHERE id = $1 AND house_id = $2', [str(d, 'room'), house.id])
    return 'Room deleted.'
  }, '/app')
}

// ---------- alerts ----------
export async function saveAlerts(_: FormState, d: FormData): Promise<FormState> {
  return run(async () => {
    const { house } = await requireHouse({ owner: true })
    const co2 = int(d, 'co2')
    const hours = int(d, 'offline')
    if (co2 == null || co2 < 600 || co2 > 5000) throw new UserError('CO2 alert level must be 600–5000 ppm.')
    if (hours == null || hours < 1 || hours > 72) throw new UserError('Offline alert must be 1–72 hours.')
    await q(`UPDATE alert_rules SET threshold = $2, enabled = $3 WHERE house_id = $1 AND kind = 'co2' AND room_id IS NULL`, [house.id, co2, d.get('co2_on') === 'on'])
    await q(`UPDATE alert_rules SET threshold = $2, enabled = $3 WHERE house_id = $1 AND kind = 'offline' AND room_id IS NULL`, [house.id, hours, d.get('offline_on') === 'on'])
    return 'Alert settings saved.'
  }, '/app/alerts')
}

export async function saveRoomAlert(_: FormState, d: FormData): Promise<FormState> {
  return run(async () => {
    const { house } = await requireHouse({ owner: true })
    const room = await one<{ id: string }>('SELECT id FROM rooms WHERE id = $1 AND house_id = $2', [str(d, 'room'), house.id])
    if (!room) throw new UserError('Choose a room.')
    const raw = str(d, 'co2')
    if (!raw) {
      await q(`DELETE FROM alert_rules WHERE house_id = $1 AND room_id = $2 AND kind = 'co2'`, [house.id, room.id])
      return 'Using the house setting for this room.'
    }
    const v = parseInt(raw, 10)
    if (!(v >= 600 && v <= 5000)) throw new UserError('CO2 alert level must be 600–5000 ppm.')
    await q(
      `INSERT INTO alert_rules (house_id, room_id, kind, threshold) VALUES ($1,$2,'co2',$3)
       ON CONFLICT (house_id, kind, coalesce(room_id::text, '')) DO UPDATE SET threshold = $3, enabled = true`,
      [house.id, room.id, v],
    )
    return 'Saved.'
  }, '/app/alerts')
}

// ---------- reports ----------
export async function setWeeklyReport(_: FormState, d: FormData): Promise<FormState> {
  return run(async () => {
    const { user } = await requireUser()
    await q('UPDATE users SET weekly_report = $2 WHERE id = $1', [user.id, d.get('on') === 'on'])
    return 'Saved.'
  }, '/app/reports')
}

export async function sendReportNow(_: FormState): Promise<FormState> {
  return run(async () => {
    const { house, user } = await requireHouse()
    if (!(await rateLimit(`report:${user.id}`, 3, 3600))) throw new UserError('Too many test emails. Try again later.')
    await sendTestReport(house.id, user.email, user.temp_unit)
    return `Sent to ${user.email}.`
  })
}

// ---------- household ----------
export async function saveHouse(_: FormState, d: FormData): Promise<FormState> {
  return run(async () => {
    const { house } = await requireHouse({ owner: true })
    const tz = str(d, 'timezone')
    if (!Intl.supportedValuesOf('timeZone').includes(tz)) throw new UserError('Choose a time zone.')
    await q('UPDATE houses SET name = $2, timezone = $3 WHERE id = $1', [house.id, cleanName(str(d, 'name')), tz])
    return 'Saved.'
  }, '/app')
}

export async function invite(_: FormState, d: FormData): Promise<FormState> {
  return run(async () => {
    const { house, user } = await requireHouse({ owner: true })
    const email = str(d, 'email').toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new UserError('Enter an email address.')
    if (!(await rateLimit(`invite:${user.id}`, 20, 86400))) throw new UserError('Too many invites today.')
    const member = await one('SELECT 1 FROM house_members m JOIN users u ON u.id = m.user_id WHERE m.house_id = $1 AND lower(u.email) = $2', [house.id, email])
    if (member) throw new UserError('They are already a member.')
    const raw = randomToken(32)
    await q(`INSERT INTO tokens (id_hash, kind, email, data, expires_at) VALUES ($1,'invite',$2,$3, now() + interval '14 days')`, [
      sha256(raw),
      email,
      JSON.stringify({ house_id: house.id, invited_by: user.id }),
    ])
    await sendEmail(email, `${user.name || user.email} invited you to CobSci`, `Join ${house.name}`, [
      { p: `${user.name || user.email} invited you to see indoor air quality for ${house.name}. You'll be able to view rooms, history and reports.` },
      { button: { label: 'Accept invite', url: `${env.appUrl()}/invite/${raw}` } },
      { small: 'This invite works for 14 days.' },
    ], 'invite')
    return `Invite sent to ${email}.`
  }, '/app/household')
}

export async function removeMember(_: FormState, d: FormData): Promise<FormState> {
  return run(async () => {
    const { house, user } = await requireHouse()
    const target = str(d, 'user')
    if (target !== user.id && house.role !== 'owner') throw new UserError('Only house owners can do that.')
    const owners = await one<{ n: number }>(`SELECT count(*)::int AS n FROM house_members WHERE house_id = $1 AND role = 'owner'`, [house.id])
    const t = await one<{ role: string }>('SELECT role FROM house_members WHERE house_id = $1 AND user_id = $2', [house.id, target])
    if (t?.role === 'owner' && owners!.n <= 1) throw new UserError('A house needs at least one owner.')
    await q('DELETE FROM house_members WHERE house_id = $1 AND user_id = $2', [house.id, target])
    if (target === user.id) redirect('/app')
    return 'Removed.'
  }, '/app/household')
}

export async function setMemberRole(_: FormState, d: FormData): Promise<FormState> {
  return run(async () => {
    const { house, user } = await requireHouse({ owner: true })
    const role = str(d, 'role') === 'owner' ? 'owner' : 'viewer'
    if (str(d, 'user') === user.id) throw new UserError('Ask another owner to change your role.')
    await q('UPDATE house_members SET role = $3 WHERE house_id = $1 AND user_id = $2', [house.id, str(d, 'user'), role])
    return 'Updated.'
  }, '/app/household')
}

export async function addHouse(_: FormState, d: FormData): Promise<FormState> {
  const { user, session } = await requireUser()
  const owned = (await housesFor(user.id)).filter((h) => h.role === 'owner')
  if (owned.length === 0) return { error: 'Only customers who own a house can add another.' }
  if (owned.length >= 10) return { error: 'That is a lot of houses — contact support.' }
  const id = await tx((c) => createHouse(c, user.id, cleanName(str(d, 'name') || 'New home'), owned[0].timezone))
  await q('UPDATE sessions SET current_house_id = $2 WHERE id_hash = $1', [session.id_hash, id])
  redirect('/app/household')
}

// ---------- account ----------
export async function saveProfile(_: FormState, d: FormData): Promise<FormState> {
  return run(async () => {
    const { user } = await requireUser()
    const unit = str(d, 'temp_unit') === 'C' ? 'C' : 'F'
    await q('UPDATE users SET name = $2, temp_unit = $3 WHERE id = $1', [user.id, str(d, 'name').slice(0, 80), unit])
    return 'Saved.'
  }, '/app')
}

export async function changePassword(_: FormState, d: FormData): Promise<FormState> {
  return run(async () => {
    const { user, session } = await requireUser()
    if (!(await verifyPassword(String(d.get('current') ?? ''), user.password_hash))) throw new UserError('Current password is wrong.')
    const pw = String(d.get('password') ?? '')
    if (pw.length < 10) throw new UserError('Use at least 10 characters.')
    await q('UPDATE users SET password_hash = $2 WHERE id = $1', [user.id, await hashPassword(pw)])
    await q('DELETE FROM sessions WHERE user_id = $1 AND id_hash <> $2', [user.id, session.id_hash])
    return 'Password changed. Other devices were signed out.'
  })
}

export async function start2fa(): Promise<{ secret: string; svg: string; uri: string }> {
  const { user } = await requireUser()
  const secret = newTotpSecret()
  const uri = totpFor(user.email, secret).toString()
  const svg = qrSvg(uri, 4)
  // Stored but not enabled until a code is confirmed.
  await q('UPDATE users SET totp_secret = $2 WHERE id = $1 AND NOT totp_enabled', [user.id, encryptTotp(secret)])
  return { secret, svg, uri }
}

export async function confirm2fa(_: FormState, d: FormData): Promise<FormState> {
  return run(async () => {
    const { user } = await requireUser()
    const secret = await userTotpSecret(user.id)
    if (!secret || !checkTotp(user.email, secret, str(d, 'code'))) throw new UserError('That code is not right. Try the newest one.')
    await q('UPDATE users SET totp_enabled = true WHERE id = $1', [user.id])
    await audit(user, 'user.2fa_enabled', { type: 'user', id: user.id }, {}, await clientIp())
    return 'Two-step verification is on.'
  }, '/app')
}

export async function disable2fa(_: FormState, d: FormData): Promise<FormState> {
  return run(async () => {
    const { user } = await requireUser()
    if (user.role !== 'customer') throw new UserError('Two-step verification is required for staff accounts.')
    if (!(await verifyPassword(String(d.get('password') ?? ''), user.password_hash))) throw new UserError('Password is wrong.')
    await q('UPDATE users SET totp_enabled = false, totp_secret = NULL WHERE id = $1', [user.id])
    return 'Two-step verification is off.'
  }, '/app')
}

export async function openBilling() {
  const { user } = await requireUser()
  const url = user.stripe_customer_id ? await billingPortalUrl(user.stripe_customer_id) : null
  redirect(url ?? '/app/account?billing=unavailable#billing')
}

export async function deleteAccount(_: FormState, d: FormData): Promise<FormState> {
  const { user } = await requireUser()
  if (user.role !== 'customer') return { error: 'Staff accounts are removed by an admin.' }
  if (!(await verifyPassword(String(d.get('password') ?? ''), user.password_hash))) return { error: 'Password is wrong.' }
  if (str(d, 'confirm') !== 'DELETE') return { error: 'Type DELETE to confirm.' }
  await tx(async (c) => {
    // Houses where this user is the only owner are deleted with their readings; devices are released.
    const sole = await q<{ house_id: string }>(
      `SELECT m.house_id FROM house_members m WHERE m.user_id = $1 AND m.role = 'owner'
         AND NOT EXISTS (SELECT 1 FROM house_members o WHERE o.house_id = m.house_id AND o.role = 'owner' AND o.user_id <> $1)`,
      [user.id],
      c,
    )
    for (const { house_id } of sole) {
      const devs = await q<{ id: string }>('SELECT id FROM devices WHERE house_id = $1', [house_id], c)
      for (const dv of devs) await unassignDevice(c, dv.id, 'in_stock')
      await q('DELETE FROM readings WHERE house_id = $1', [house_id], c)
      await q('DELETE FROM houses WHERE id = $1', [house_id], c)
    }
    await audit({ id: user.id, email: user.email }, 'user.deleted_self', { type: 'user', id: user.id }, { houses_deleted: sole.map((s) => s.house_id) }, '', c)
    await q('DELETE FROM users WHERE id = $1', [user.id], c)
  })
  await destroySession()
  redirect('/login')
}

// ---------- help ----------
export async function contactSupport(_: FormState, d: FormData): Promise<FormState> {
  return run(async () => {
    const { user, house } = await requireHouse()
    if (!(await rateLimit(`support:${user.id}`, 5, 3600))) throw new UserError('Too many messages. Try again in an hour.')
    const subject = str(d, 'subject').slice(0, 120)
    const body = str(d, 'body').slice(0, 5000)
    if (!subject || !body) throw new UserError('Add a subject and a message.')
    // House and device details are attached automatically so support doesn't have to ask.
    const devices = await q(
      `SELECT d.id, r.name AS room, d.fw_version, d.last_seen_at, d.last_rssi, d.last_co2, d.status
         FROM devices d LEFT JOIN rooms r ON r.id = d.room_id WHERE d.house_id = $1`,
      [house.id],
    )
    const context = { house_id: house.id, house_name: house.name, devices }
    const row = await one<{ id: number }>(
      'INSERT INTO support_requests (user_id, house_id, email, subject, body, context) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [user.id, house.id, user.email, subject, body, JSON.stringify(context)],
    )
    const deviceLines = devices.map((x: any) => `${x.id} · ${x.room ?? 'unnamed'} · fw ${x.fw_version ?? '?'} · last seen ${x.last_seen_at ? new Date(x.last_seen_at).toISOString() : 'never'} · RSSI ${x.last_rssi ?? '?'}`)
    await sendEmail(env.supportEmail(), `[Support #${row!.id}] ${subject}`, subject, [
      { p: `From ${user.name || ''} <${user.email}>` },
      { p: body },
      { small: `House ${house.id} (${house.name})` },
      ...deviceLines.map((small) => ({ small })),
    ], 'support')
    return `Thanks — we got it (request #${row!.id}). We'll reply to ${user.email}.`
  })
}

// ---------- orders ----------
/** An existing customer with several houses picks where a new order's devices go. */
export async function chooseOrderHouse(_: FormState, d: FormData): Promise<FormState> {
  return run(async () => {
    const { user } = await requireUser()
    const houses = (await housesFor(user.id)).filter((h) => h.role === 'owner')
    const houseId = str(d, 'house')
    if (!houses.some((h) => h.id === houseId)) throw new UserError('Choose one of your houses.')
    await q(`UPDATE orders SET house_id = $3 WHERE id = $1 AND user_id = $2 AND status = 'paid' AND house_id IS NULL`, [str(d, 'order'), user.id, houseId])
    return 'Thanks — the sensors will be linked to that house when they ship.'
  }, '/app')
}
