import { q, one, tx, type Db } from './db'
import { createHouse } from './houses-core'
import { assignDevice, unassignDevice, normalizeDeviceId } from './devices'
import { sendEmail, deliverOutbox } from './email'
import { randomToken, sha256 } from './crypto'
import { env } from './env'

export type NewOrder = {
  source: 'stripe' | 'manual'
  externalId?: string | null
  email: string
  name?: string
  deviceQty: number
  items?: unknown[]
  isGift?: boolean
  giftEmail?: string | null
  giftName?: string | null
  shipTo?: Record<string, unknown>
  /** Set when a logged-in customer checked out: their order attaches to their house directly. */
  userId?: string | null
  houseId?: string | null
}

/** Find an account by email, or create a pending one (no password until the welcome link is used). */
export async function findOrCreateUser(c: Db, email: string, name = ''): Promise<{ id: string; created: boolean }> {
  const e = email.trim().toLowerCase()
  const found = await one<{ id: string }>('SELECT id FROM users WHERE lower(email) = $1', [e], c)
  if (found) return { id: found.id, created: false }
  const row = await one<{ id: string }>('INSERT INTO users (email, name) VALUES ($1,$2) RETURNING id', [e, name], c)
  return { id: row!.id, created: true }
}

/**
 * Order paid (Stripe webhook or staff test order).
 * New buyer -> pending account + new HOUSE_ID. Existing customer with one house -> that house.
 * Existing customer with several houses -> house left empty; the customer (or staff) picks one.
 * Gift -> the account and house belong to the recipient.
 */
export async function createOrder(o: NewOrder): Promise<{ orderId: string; number: number; duplicate: boolean }> {
  return tx(async (c) => {
    if (o.externalId) {
      const dup = await one<{ id: string; number: number }>('SELECT id, number FROM orders WHERE external_id = $1', [o.externalId], c)
      if (dup) return { orderId: dup.id, number: dup.number, duplicate: true }
    }
    if (!(o.deviceQty >= 0 && o.deviceQty <= 50)) throw new Error('Device quantity must be 0–50')
    const ownerEmail = o.isGift && o.giftEmail ? o.giftEmail : o.email
    const ownerName = o.isGift && o.giftEmail ? (o.giftName ?? '') : (o.name ?? '')

    let userId = o.userId && !o.isGift ? o.userId : null
    if (!userId) userId = (await findOrCreateUser(c, ownerEmail, ownerName)).id

    let houseId: string | null = null
    if (o.houseId) {
      const m = await one(`SELECT 1 FROM house_members WHERE house_id = $1 AND user_id = $2 AND role = 'owner'`, [o.houseId, userId], c)
      if (m) houseId = o.houseId
    }
    if (!houseId) {
      const owned = await q<{ house_id: string }>(`SELECT house_id FROM house_members WHERE user_id = $1 AND role = 'owner'`, [userId], c)
      if (owned.length === 0) houseId = await createHouse(c, userId)
      else if (owned.length === 1) houseId = owned[0].house_id
    }

    const row = await one<{ id: string; number: number }>(
      `INSERT INTO orders (source, external_id, email, customer_name, user_id, house_id, device_qty, items, is_gift, gift_email, gift_name, ship_to)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id, number`,
      [
        o.source,
        o.externalId ?? null,
        o.email.trim().toLowerCase(),
        o.name ?? '',
        userId,
        houseId,
        o.deviceQty,
        JSON.stringify(o.items ?? []),
        !!o.isGift,
        o.giftEmail ?? null,
        o.giftName ?? null,
        JSON.stringify(o.shipTo ?? {}),
      ],
      c,
    )
    return { orderId: row!.id, number: row!.number, duplicate: false }
  })
}

export type ScanResult = { ok: true; message: string } | { ok: false; error: string }

/** Packing station: scan one unit against an order. This is where a device gets its owner. */
export async function scanUnit(orderId: string, rawId: string, staffId: string): Promise<ScanResult> {
  const deviceId = normalizeDeviceId(rawId)
  return tx(async (c) => {
    const order = await one<any>('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId], c)
    if (!order) return { ok: false, error: 'Order not found' } as const
    if (order.status !== 'paid') return { ok: false, error: `Order is ${order.status}` } as const
    if (!order.house_id) return { ok: false, error: 'Choose which house this order goes to first' } as const
    const count = (await one<{ n: number }>('SELECT count(*)::int AS n FROM order_units WHERE order_id = $1', [orderId], c))!.n
    if (count >= order.device_qty) return { ok: false, error: `Order already has all ${order.device_qty} units` } as const
    const d = await one<any>('SELECT * FROM devices WHERE id = $1 FOR UPDATE', [deviceId], c)
    if (!d) return { ok: false, error: `${deviceId}: unknown unit — not provisioned` } as const
    if (d.test_result !== 'pass') return { ok: false, error: `${deviceId}: failed factory test` } as const
    if (d.status !== 'in_stock' || d.house_id) return { ok: false, error: `${deviceId}: already assigned (${d.status})` } as const
    await q('INSERT INTO order_units (order_id, device_id, scanned_by) VALUES ($1,$2,$3)', [orderId, deviceId, staffId], c)
    await assignDevice(c, deviceId, order.house_id, 'packing', orderId)
    return { ok: true, message: `${deviceId} added (${count + 1} of ${order.device_qty})` } as const
  })
}

export async function removeUnit(orderId: string, deviceId: string) {
  return tx(async (c) => {
    const order = await one<any>('SELECT status FROM orders WHERE id = $1', [orderId], c)
    if (order?.status !== 'paid') throw new Error('Only unshipped orders can be changed')
    const del = await c.query('DELETE FROM order_units WHERE order_id = $1 AND device_id = $2', [orderId, deviceId])
    if (del.rowCount) {
      await unassignDevice(c, deviceId, 'in_stock')
      await q('UPDATE devices SET order_id = NULL WHERE id = $1', [deviceId], c)
    }
  })
}

/** Mark shipped: only when every unit is scanned. Sends welcome or "new device added" email. */
export async function markShipped(orderId: string, tracking: string) {
  const emailId = await tx(async (c) => {
    const order = await one<any>('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId], c)
    if (!order || order.status !== 'paid') throw new Error('Order is not waiting to ship')
    const n = (await one<{ n: number }>('SELECT count(*)::int AS n FROM order_units WHERE order_id = $1', [orderId], c))!.n
    if (n !== order.device_qty) throw new Error(`Scanned ${n} of ${order.device_qty} units`)
    await q(`UPDATE orders SET status = 'shipped', shipped_at = now(), tracking = $2 WHERE id = $1`, [orderId, tracking || null], c)
    const user = await one<any>('SELECT id, email, name, password_hash FROM users WHERE id = $1', [order.user_id], c)
    if (!user) return null
    const trackLine = tracking ? `Tracking number: ${tracking}.` : ''
    const units = `${n} sensor${n === 1 ? '' : 's'}`
    if (!user.password_hash) {
      const raw = randomToken(32)
      await q(
        `INSERT INTO tokens (id_hash, kind, user_id, expires_at) VALUES ($1,'set_password',$2, now() + interval '30 days')`,
        [sha256(raw), user.id],
        c,
      )
      const from = order.is_gift ? `${order.customer_name || 'Someone'} sent you a gift. ` : ''
      return sendEmail(
        user.email,
        'Your CO2 & You sensors are on the way',
        'Welcome to CobSci',
        [
          { p: `${from}Your ${units} shipped today. ${trackLine}` },
          { p: 'Set a password now so your readings are waiting for you when you plug in.' },
          { button: { label: 'Set your password', url: `${env.appUrl()}/set-password/${raw}` } },
          { p: 'When it arrives: plug it in, scan the QR code on its screen with your phone camera, and pick your home WiFi. Then name each room in the portal.' },
          { button: { label: 'Setup guide', url: `${env.appUrl()}/app/help#setup` } },
        ],
        'welcome',
        c,
      )
    }
    return sendEmail(
      user.email,
      'New sensors added to your account',
      'New sensors on the way',
      [
        { p: `Your ${units} shipped today and ${n === 1 ? 'is' : 'are'} already linked to your house. ${trackLine}` },
        { p: 'Plug in, scan the QR code on the screen to join WiFi, then name the room in the portal.' },
        { button: { label: 'Open the portal', url: `${env.appUrl()}/app/devices` } },
      ],
      'new_device',
      c,
    )
  })
  await deliverOutbox()
  return emailId
}
