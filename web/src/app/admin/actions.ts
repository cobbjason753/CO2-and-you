'use server'

import crypto from 'node:crypto'
import { redirect } from 'next/navigation'
import { q, one, tx, pool } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { requireStaff, clientIp } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { provisionDevice, assignDevice, unassignDevice, reissueClaimCode, normalizeDeviceId } from '@/lib/devices'
import { createOrder, scanUnit, removeUnit, markShipped } from '@/lib/orders'
import { qrSvg, code128Svg } from '@/lib/barcode'
import { randomToken, sha256 } from '@/lib/crypto'
import { sendEmail } from '@/lib/email'
import { env } from '@/lib/env'
import { run, str, int, UserError, type FormState } from '@/lib/action'

async function staff() {
  const { user } = await requireStaff()
  return { actor: { id: user.id, email: user.email }, ip: await clientIp(), user }
}

// ---------- provisioning ----------
export type Label = { deviceId: string; claimCode: string; qr: string; barcode: string; fw: number | null }
export type ProvisionState = { error?: string; ok?: string; labels?: Label[]; failures?: string[] } | null

export async function makeLabel(deviceId: string, claimCode: string, fw: number | null): Promise<Label> {
  return {
    deviceId,
    claimCode,
    fw,
    qr: qrSvg(`${env.appUrl()}/claim?code=${claimCode}`, 2),
    barcode: code128Svg(deviceId),
  }
}

/**
 * Register flashed boards. One per line: DEVICE_ID [, test result pass|fail] [, 64-hex device secret].
 * Claim codes are shown once, on the labels, and only their hash is stored.
 */
export async function provision(_: ProvisionState, d: FormData): Promise<ProvisionState> {
  const { actor, ip } = await staff()
  const fw = int(d, 'fw')
  const defaultResult = str(d, 'test_result') === 'fail' ? 'fail' : 'pass'
  const lines = str(d, 'devices').split(/\n+/).map((l) => l.trim()).filter(Boolean)
  if (!lines.length) return { error: 'Enter at least one DEVICE_ID.' }
  if (lines.length > 100) return { error: 'Up to 100 at a time.' }
  const labels: Label[] = []
  const failures: string[] = []
  for (const line of lines) {
    const [rawId, a, b] = line.split(/[,\s\t]+/)
    const result = [a, b].find((x) => x === 'pass' || x === 'fail') ?? defaultResult
    const secret = [a, b].find((x) => x && /^[0-9a-f]{64}$/i.test(x)) ?? null
    try {
      const deviceId = normalizeDeviceId(rawId)
      const { claimCode } = await tx(async (c) => {
        const r = await provisionDevice(c, { deviceId, fw, testResult: result as 'pass' | 'fail', secretHex: secret, notes: str(d, 'notes') })
        await audit(actor, 'device.provision', { type: 'device', id: deviceId }, { fw, test_result: result, secret_pinned: !!secret }, ip, c)
        return r
      })
      if (result === 'pass') labels.push(await makeLabel(deviceId, claimCode, fw))
      else failures.push(`${deviceId}: registered as failed test (no label)`)
    } catch (e) {
      failures.push(`${rawId}: ${(e as Error).message}`)
    }
  }
  return { ok: `${labels.length} label${labels.length === 1 ? '' : 's'} ready.`, labels, failures }
}

export async function reissueLabel(_: ProvisionState, d: FormData): Promise<ProvisionState> {
  const { actor, ip } = await staff()
  const id = str(d, 'device')
  const dev = await one<{ fw_provisioned: number | null; house_id: string | null }>('SELECT fw_provisioned, house_id FROM devices WHERE id = $1', [id])
  if (!dev) return { error: 'Unknown device' }
  const code = await reissueClaimCode(pool(), id)
  await audit(actor, 'device.reissue_claim_code', { type: 'device', id }, {}, ip)
  return { ok: 'New claim code issued. The old label no longer works.', labels: [await makeLabel(id, code, dev.fw_provisioned)] }
}

// ---------- device actions ----------
export async function deviceAction(_: FormState, d: FormData): Promise<FormState> {
  return run(async () => {
    const { actor, ip } = await staff()
    const id = str(d, 'device')
    const action = str(d, 'action')
    const dev = await one<any>('SELECT * FROM devices WHERE id = $1', [id])
    if (!dev) throw new UserError('Unknown device')
    let msg = 'Done.'
    await tx(async (c) => {
      switch (action) {
        case 'unassign':
          await unassignDevice(c, id, 'in_stock')
          msg = 'Unassigned and back in stock.'
          break
        case 'returned':
        case 'defective':
          await unassignDevice(c, id, action)
          msg = `Marked ${action}. It can no longer upload.`
          break
        case 'restock':
          if (dev.house_id) throw new UserError('Unassign it first.')
          await q(`UPDATE devices SET status = 'in_stock' WHERE id = $1`, [id], c)
          msg = 'Back in stock.'
          break
        case 'revoke':
          await unassignDevice(c, id, 'revoked')
          await q('UPDATE devices SET secret_enc = NULL, secret_set_at = NULL WHERE id = $1', [id], c)
          msg = 'Credential revoked. The device is blocked until restocked.'
          break
        case 'reset_secret':
          await q('UPDATE devices SET secret_enc = NULL, secret_set_at = NULL WHERE id = $1', [id], c)
          msg = 'Secret cleared. The next device to enroll with this DEVICE_ID sets a new one.'
          break
        case 'reassign': {
          const house = await one<{ id: string }>('SELECT id FROM houses WHERE id = $1', [str(d, 'house').toUpperCase()], c)
          if (!house) throw new UserError('No house with that HOUSE_ID')
          if (!['in_stock', 'assigned'].includes(dev.status)) throw new UserError(`Device is ${dev.status}; restock it first.`)
          await assignDevice(c, id, house.id, 'staff')
          msg = `Assigned to ${house.id}.`
          break
        }
        case 'pilot':
          await q('UPDATE devices SET pilot = NOT pilot WHERE id = $1', [id], c)
          msg = dev.pilot ? 'Removed from pilot group.' : 'Added to pilot group.'
          break
        case 'force_fw': {
          const v = int(d, 'version')
          if (v == null) {
            await q('UPDATE devices SET target_fw = NULL WHERE id = $1', [id], c)
            msg = 'Forced update cleared.'
            break
          }
          const rel = await one('SELECT 1 FROM firmware_releases WHERE version = $1 AND stage <> $2', [v, 'retired'], c)
          if (!rel) throw new UserError('No such release')
          await q('UPDATE devices SET target_fw = $2 WHERE id = $1', [id, v], c)
          msg = `v${v} will be offered on the device's next upload (within 5 minutes).`
          break
        }
        case 'notes':
          await q('UPDATE devices SET notes = $2 WHERE id = $1', [id, str(d, 'notes')], c)
          msg = 'Notes saved.'
          break
        default:
          throw new UserError('Unknown action')
      }
      await audit(actor, `device.${action}`, { type: 'device', id }, { from_house: dev.house_id, house: str(d, 'house') || undefined, version: str(d, 'version') || undefined }, ip, c)
    })
    return msg
  }, '/admin')
}

// ---------- orders & packing ----------
export async function createTestOrder(_: FormState, d: FormData): Promise<FormState> {
  const { actor, ip } = await staff()
  const qty = int(d, 'qty')
  if (!str(d, 'email') || qty == null || qty < 1) return { error: 'Email and quantity are required.' }
  const o = await createOrder({
    source: 'manual',
    email: str(d, 'email'),
    name: str(d, 'name'),
    deviceQty: qty,
    items: [{ name: 'Manual order', qty }],
    isGift: d.get('gift') === 'on',
    giftEmail: str(d, 'gift_email') || null,
    giftName: str(d, 'gift_name') || null,
    shipTo: { line1: str(d, 'line1'), city: str(d, 'city'), state: str(d, 'state'), postal_code: str(d, 'zip'), country: 'US' },
  })
  if (d.get('subscription') === 'on') {
    const uid = await one<{ user_id: string }>('SELECT user_id FROM orders WHERE id = $1', [o.orderId])
    await q(`INSERT INTO subscriptions (id, user_id, status, plan, current_period_end) VALUES ($1,$2,'active','standard', now() + interval '1 month') ON CONFLICT DO NOTHING`, [
      'manual-' + crypto.randomUUID(),
      uid!.user_id,
    ])
  }
  await audit(actor, 'order.create_manual', { type: 'order', id: o.orderId }, { qty }, ip)
  redirect(`/admin/packing/${o.orderId}`)
}

export async function scan(_: FormState, d: FormData): Promise<FormState> {
  const { actor, ip } = await staff()
  const order = str(d, 'order')
  const r = await scanUnit(order, str(d, 'device'), actor.id)
  if (!r.ok) return { error: r.error }
  await audit(actor, 'packing.scan', { type: 'order', id: order }, { device: normalizeDeviceId(str(d, 'device')) }, ip)
  revalidatePath(`/admin/packing/${order}`)
  return { ok: r.message }
}

export async function unscan(_: FormState, d: FormData): Promise<FormState> {
  return run(async () => {
    const { actor, ip } = await staff()
    await removeUnit(str(d, 'order'), str(d, 'device'))
    await audit(actor, 'packing.unscan', { type: 'order', id: str(d, 'order') }, { device: str(d, 'device') }, ip)
    return 'Removed from order and back in stock.'
  }, '/admin/packing')
}

export async function setOrderHouse(_: FormState, d: FormData): Promise<FormState> {
  return run(async () => {
    const { actor, ip } = await staff()
    const order = await one<{ user_id: string }>(`SELECT user_id FROM orders WHERE id = $1 AND status = 'paid'`, [str(d, 'order')])
    const ok = order && (await one(`SELECT 1 FROM house_members WHERE user_id = $1 AND house_id = $2 AND role = 'owner'`, [order.user_id, str(d, 'house')]))
    if (!ok) throw new UserError('Choose one of the customer’s houses.')
    await q('UPDATE orders SET house_id = $2 WHERE id = $1', [str(d, 'order'), str(d, 'house')])
    await audit(actor, 'order.set_house', { type: 'order', id: str(d, 'order') }, { house: str(d, 'house') }, ip)
    return 'House set.'
  }, '/admin/packing')
}

export async function ship(_: FormState, d: FormData): Promise<FormState> {
  return run(async () => {
    const { actor, ip } = await staff()
    await markShipped(str(d, 'order'), str(d, 'tracking'))
    await audit(actor, 'order.shipped', { type: 'order', id: str(d, 'order') }, { tracking: str(d, 'tracking') }, ip)
    return 'Marked shipped. The customer has been emailed.'
  }, '/admin/packing')
}

export async function cancelOrder(_: FormState, d: FormData): Promise<FormState> {
  return run(async () => {
    const { actor, ip } = await staff()
    const id = str(d, 'order')
    await tx(async (c) => {
      const o = await one<{ status: string }>('SELECT status FROM orders WHERE id = $1 FOR UPDATE', [id], c)
      if (o?.status !== 'paid') throw new UserError('Only unshipped orders can be cancelled here.')
      const units = await q<{ device_id: string }>('SELECT device_id FROM order_units WHERE order_id = $1', [id], c)
      for (const u of units) await unassignDevice(c, u.device_id, 'in_stock')
      await q('DELETE FROM order_units WHERE order_id = $1', [id], c)
      await q(`UPDATE orders SET status = 'cancelled' WHERE id = $1`, [id], c)
      await audit(actor, 'order.cancelled', { type: 'order', id }, {}, ip, c)
    })
    return 'Cancelled. Refund the payment in Stripe if needed.'
  }, '/admin/packing')
}

// ---------- customers ----------
export async function resendWelcome(_: FormState, d: FormData): Promise<FormState> {
  return run(async () => {
    const { actor, ip } = await staff()
    const u = await one<{ id: string; email: string; password_hash: string | null }>('SELECT id, email, password_hash FROM users WHERE id = $1', [str(d, 'user')])
    if (!u) throw new UserError('Unknown user')
    const raw = randomToken(32)
    const kind = u.password_hash ? 'reset_password' : 'set_password'
    await q(`INSERT INTO tokens (id_hash, kind, user_id, expires_at) VALUES ($1,$2,$3, now() + interval '7 days')`, [sha256(raw), kind, u.id])
    await sendEmail(u.email, kind === 'set_password' ? 'Set your CO2 & You password' : 'Reset your CO2 & You password', 'Your sign-in link', [
      { p: 'Our support team sent you this link to get into your account. It works for 7 days.' },
      { button: { label: kind === 'set_password' ? 'Set password' : 'Choose a new password', url: `${env.appUrl()}/${kind === 'set_password' ? 'set-password' : 'reset'}/${raw}` } },
    ], 'support_link')
    await audit(actor, 'user.send_password_link', { type: 'user', id: u.id }, {}, ip)
    return `Link sent to ${u.email}.`
  }, '/admin/customers')
}

export async function setRole(_: FormState, d: FormData): Promise<FormState> {
  return run(async () => {
    const { user } = await requireStaff({ adminOnly: true })
    const email = str(d, 'email').toLowerCase()
    const role = ['customer', 'staff', 'admin'].includes(str(d, 'role')) ? str(d, 'role') : 'customer'
    const target = await one<{ id: string }>('SELECT id FROM users WHERE lower(email) = $1', [email])
    if (!target) throw new UserError('No account with that email. They need an account first (e.g. a test order, then set password).')
    if (target.id === user.id) throw new UserError('Ask another admin to change your own role.')
    await q('UPDATE users SET role = $2 WHERE id = $1', [target.id, role])
    await q('DELETE FROM sessions WHERE user_id = $1', [target.id])
    await audit({ id: user.id, email: user.email }, 'user.set_role', { type: 'user', id: target.id }, { role }, await clientIp())
    return `${email} is now ${role}.`
  }, '/admin/staff')
}

export async function closeSupport(_: FormState, d: FormData): Promise<FormState> {
  return run(async () => {
    const { actor, ip } = await staff()
    await q(`UPDATE support_requests SET status = CASE WHEN status = 'open' THEN 'closed' ELSE 'open' END WHERE id = $1`, [int(d, 'id')])
    await audit(actor, 'support.toggle', { type: 'support', id: str(d, 'id') }, {}, ip)
    return 'Updated.'
  }, '/admin/support')
}

// ---------- firmware ----------
export async function addRelease(_: FormState, d: FormData): Promise<FormState> {
  return run(async () => {
    const { actor, ip } = await staff()
    const version = int(d, 'version')
    if (version == null || version < 1) throw new UserError('Version must be a whole number (the v<N> tag).')
    if (await one('SELECT 1 FROM firmware_releases WHERE version = $1', [version])) throw new UserError(`v${version} already exists.`)
    const file = d.get('file')
    const url = str(d, 'url')
    let bin: Buffer | null = null
    if (file instanceof File && file.size > 0) {
      if (file.size > 4 * 1024 * 1024) throw new UserError('Build must be under 4 MB.')
      bin = Buffer.from(await file.arrayBuffer())
      if (bin[0] !== 0xe9) throw new UserError('That does not look like an ESP32 app image (.bin from the build output).')
    } else if (url) {
      if (!/^https:\/\//.test(url)) throw new UserError('URL must start with https://')
      const res = await fetch(url, { redirect: 'follow' })
      if (!res.ok) throw new UserError(`Couldn't download the build (${res.status}).`)
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf[0] !== 0xe9) throw new UserError('That URL did not return an ESP32 app image.')
      bin = buf
    } else throw new UserError('Upload a .bin or give its URL.')
    const sha = crypto.createHash('sha256').update(bin).digest('hex')
    await q(
      `INSERT INTO firmware_releases (version, url, bin_data, size_bytes, sha256, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [version, url || null, url ? null : bin, bin.length, sha, str(d, 'notes'), actor.id],
    )
    await audit(actor, 'firmware.add', { type: 'firmware', id: String(version) }, { sha256: sha, size: bin.length, url: url || 'uploaded' }, ip)
    return `v${version} added as a draft (sha256 ${sha.slice(0, 12)}…). Promote it to pilot when ready.`
  }, '/admin/firmware')
}

export async function setReleaseStage(_: FormState, d: FormData): Promise<FormState> {
  return run(async () => {
    const { actor, ip } = await staff()
    const stage = str(d, 'stage')
    if (!['draft', 'pilot', 'general', 'retired'].includes(stage)) throw new UserError('Bad stage')
    await q('UPDATE firmware_releases SET stage = $2 WHERE version = $1', [int(d, 'version'), stage])
    if (stage === 'retired') await q('UPDATE devices SET target_fw = NULL WHERE target_fw = $1', [int(d, 'version')])
    await audit(actor, 'firmware.stage', { type: 'firmware', id: str(d, 'version') }, { stage }, ip)
    return `v${str(d, 'version')} is now ${stage}.`
  }, '/admin/firmware')
}

export async function setPilotGroup(_: FormState, d: FormData): Promise<FormState> {
  return run(async () => {
    const { actor, ip } = await staff()
    const ids = str(d, 'devices').split(/[\s,]+/).filter(Boolean).map(normalizeDeviceId)
    await q('UPDATE devices SET pilot = (id = ANY($1))', [ids])
    await audit(actor, 'firmware.pilot_group', null, { devices: ids }, ip)
    return `Pilot group is now ${ids.length} device${ids.length === 1 ? '' : 's'}.`
  }, '/admin/firmware')
}
