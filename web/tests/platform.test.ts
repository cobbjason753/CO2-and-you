import { describe, it, expect } from 'vitest'
import { q, one, tx } from '../src/lib/db'
import { provisioned, enroll, upload, nowS, fakeDevice } from './helpers'
import { createOrder, scanUnit, markShipped, removeUnit } from '../src/lib/orders'
import { claimDevice, unassignDevice } from '../src/lib/devices'
import { createHouse } from '../src/lib/houses-core'
import { otaOfferFor } from '../src/lib/firmware'
import { checkOffline } from '../src/lib/alerts'
import { houseSeries } from '../src/lib/readings'
import { sendWeeklyReports } from '../src/lib/reports'

describe('device ingest', () => {
  it('rejects unknown devices and logs them for staff', async () => {
    const d = fakeDevice()
    const r = await enroll(d)
    expect(r.status).toBe(404)
    const u = await one('SELECT * FROM unknown_devices WHERE device_id = $1', [d.id])
    expect(u).toBeTruthy()
  })

  it('enrolls once (trust on first use) and refuses a different secret', async () => {
    const d = await provisioned()
    expect((await enroll(d)).status).toBe(200)
    expect((await enroll(d)).status).toBe(200)
    expect((await enroll({ id: d.id, secret: 'ab'.repeat(32) })).status).toBe(409)
  })

  it('requires a valid signature and fresh timestamp', async () => {
    const d = await provisioned()
    expect((await upload(d, [[nowS(), 600, 21, 40]])).status).toBe(401) // not enrolled yet
    await enroll(d)
    expect((await upload(d, [[nowS(), 600, 21, 40]], { badSig: true })).body.error).toBe('bad_signature')
    expect((await upload(d, [[nowS(), 600, 21, 40]], { ts: nowS() - 3600 })).body.error).toBe('bad_timestamp')
    const dev = await one('SELECT ingest_errors FROM devices WHERE id = $1', [d.id])
    expect(dev.ingest_errors).toBe(2)
  })

  it('flags unassigned devices without writing readings to any house', async () => {
    const d = await provisioned()
    await enroll(d)
    const r = await upload(d, [[nowS(), 600, 21, 40]])
    expect(r.status).toBe(200)
    expect(r.body.claimed).toBe(false)
    expect(r.body.accepted).toBe(0)
    const dev = await one('SELECT last_seen_at, last_co2 FROM devices WHERE id = $1', [d.id])
    expect(dev.last_seen_at).toBeTruthy()
    expect(dev.last_co2).toBe(600)
    expect((await q('SELECT * FROM readings WHERE device_id = $1', [d.id])).length).toBe(0)
  })

  it('revoked devices are refused', async () => {
    const d = await provisioned()
    await enroll(d)
    await q(`UPDATE devices SET status = 'revoked' WHERE id = $1`, [d.id])
    expect((await upload(d, [[nowS(), 600, 21, 40]])).status).toBe(403)
  })
})

describe('order → pack → ship → readings', () => {
  it('runs the whole lifecycle', async () => {
    const order = await createOrder({ source: 'manual', email: 'Buyer@Example.com', name: 'Pat Buyer', deviceQty: 2 })
    const o = await one('SELECT * FROM orders WHERE id = $1', [order.orderId])
    expect(o.house_id).toMatch(/^H[0-9A-Z]{9}$/)
    const user = await one('SELECT * FROM users WHERE id = $1', [o.user_id])
    expect(user.email).toBe('buyer@example.com')
    expect(user.password_hash).toBeNull()

    const staff = await one(`INSERT INTO users (email, role) VALUES ('staff-' || gen_random_uuid() || '@x.com', 'staff') RETURNING id`)
    const a = await provisioned()
    const b = await provisioned()
    const bad = await provisioned({ test: 'fail' })

    expect((await scanUnit(order.orderId, 'esp32-000000000000', staff.id)).ok).toBe(false)
    const badScan = await scanUnit(order.orderId, bad.id, staff.id)
    expect(badScan.ok).toBe(false)
    expect((await scanUnit(order.orderId, a.id.toLowerCase(), staff.id)).ok).toBe(true)
    expect((await scanUnit(order.orderId, a.id, staff.id)).ok).toBe(false) // already assigned
    await expect(markShipped(order.orderId, '')).rejects.toThrow(/Scanned 1 of 2/)
    expect((await scanUnit(order.orderId, b.id, staff.id)).ok).toBe(true)
    await removeUnit(order.orderId, b.id)
    expect((await one('SELECT status FROM devices WHERE id = $1', [b.id])).status).toBe('in_stock')
    expect((await scanUnit(order.orderId, b.id, staff.id)).ok).toBe(true)

    await markShipped(order.orderId, '1Z999')
    const mail = await one(`SELECT * FROM email_outbox WHERE to_email = 'buyer@example.com' ORDER BY id DESC LIMIT 1`)
    expect(mail.kind).toBe('welcome')
    expect(mail.text_body).toMatch(/set-password\//)

    // Device joins WiFi and reports: readings land in the house as "Unnamed device"
    await enroll(a)
    const t = nowS()
    const r = await upload(a, [[t - 600, 700, 21.5, 45], [t - 300, 750, 21.6, 45]])
    expect(r.body).toMatchObject({ accepted: 2, claimed: true, name: '' })
    const rows = await q('SELECT * FROM readings WHERE device_id = $1', [a.id])
    expect(rows.every((x) => x.house_id === o.house_id && x.room_id === null)).toBe(true)

    // Re-sending the same batch is harmless
    expect((await upload(a, [[t - 600, 700, 21.5, 45]])).body.accepted).toBe(0)

    // Customer names the room in the portal; the device learns its name on the next upload
    const room = await one(`INSERT INTO rooms (house_id, name) VALUES ($1, 'Kitchen') RETURNING id`, [o.house_id])
    await q('UPDATE devices SET room_id = $2 WHERE id = $1', [a.id, room.id])
    const r2 = await upload(a, [[t, 800, 21.6, 45]])
    expect(r2.body.name).toBe('Kitchen')

    const { series } = await houseSeries(o.house_id, new Date((t - 3600) * 1000), new Date((t + 60) * 1000))
    expect(series.map((s) => s.name).sort()).toEqual(['Kitchen', `Unnamed (…${a.id.slice(-4)})`])
  })

  it('existing customer with two houses must choose; gift goes to recipient', async () => {
    const first = await createOrder({ source: 'manual', email: 'two@example.com', deviceQty: 1 })
    const u = await one('SELECT user_id FROM orders WHERE id = $1', [first.orderId])
    await tx((c) => createHouse(c, u.user_id, 'Cabin'))
    const second = await createOrder({ source: 'manual', email: 'two@example.com', deviceQty: 1 })
    expect((await one('SELECT house_id FROM orders WHERE id = $1', [second.orderId])).house_id).toBeNull()

    const gift = await createOrder({ source: 'manual', email: 'giver@example.com', deviceQty: 1, isGift: true, giftEmail: 'friend@example.com', giftName: 'Sam' })
    const g = await one('SELECT o.*, u.email AS owner FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = $1', [gift.orderId])
    expect(g.owner).toBe('friend@example.com')
  })

  it('stripe webhook replays do not duplicate orders', async () => {
    const a = await createOrder({ source: 'stripe', externalId: 'cs_test_1', email: 'x@example.com', deviceQty: 1 })
    const b = await createOrder({ source: 'stripe', externalId: 'cs_test_1', email: 'x@example.com', deviceQty: 1 })
    expect(b.duplicate).toBe(true)
    expect(b.orderId).toBe(a.orderId)
  })
})

describe('claim codes', () => {
  it('claims once, rejects wrong codes and devices that already belong to someone', async () => {
    const user = await one(`INSERT INTO users (email) VALUES ('claimer@example.com') RETURNING id`)
    const house = await tx((c) => createHouse(c, user.id))
    const d = await provisioned()
    expect((await claimDevice(user.id, house, 'AAAA-BBBB-CCCC', '')).ok).toBe(false)
    const lower = d.claimCode.toLowerCase().replace(/-/g, ' ')
    const r = await claimDevice(user.id, house, lower, 'Bedroom')
    expect(r.ok).toBe(true)
    const dev = await one('SELECT d.*, r.name FROM devices d JOIN rooms r ON r.id = d.room_id WHERE d.id = $1', [d.id])
    expect(dev.house_id).toBe(house)
    expect(dev.name).toBe('Bedroom')

    const other = await one(`INSERT INTO users (email) VALUES ('other@example.com') RETURNING id`)
    const otherHouse = await tx((c) => createHouse(c, other.id))
    expect((await claimDevice(other.id, otherHouse, d.claimCode, '')).ok).toBe(false)

    // Owner removes it (gift); the label works again for the new owner
    await tx((c) => unassignDevice(c, d.id))
    expect((await claimDevice(other.id, otherHouse, d.claimCode, '')).ok).toBe(true)
  })
})

describe('firmware rollout', () => {
  it('offers pilot builds only to pilot devices, and honours forced versions', async () => {
    await q(`INSERT INTO firmware_releases (version, url, sha256, stage) VALUES (50, 'https://x/50.bin', 'aa', 'general'), (51, 'https://x/51.bin', 'bb', 'pilot')`)
    const base = { id: 'esp32-AAAAAAAAAAAA', target_fw: null }
    expect((await otaOfferFor({ ...base, fw_version: 10, pilot: false }))?.version).toBe(50)
    expect((await otaOfferFor({ ...base, fw_version: 10, pilot: true }))?.version).toBe(51)
    expect(await otaOfferFor({ ...base, fw_version: 51, pilot: true })).toBeNull()
    expect((await otaOfferFor({ ...base, fw_version: 51, pilot: false, target_fw: 50 }))?.version).toBe(50)
  })
})

describe('alerts and reports', () => {
  it('opens a CO2 alert once, emails members, and closes with hysteresis', async () => {
    const order = await createOrder({ source: 'manual', email: 'alert@example.com', deviceQty: 1 })
    const o = await one('SELECT * FROM orders WHERE id = $1', [order.orderId])
    await q(`UPDATE users SET password_hash = 'x' WHERE id = $1`, [o.user_id])
    const staff = await one(`INSERT INTO users (email, role) VALUES ('s2@x.com', 'staff') RETURNING id`)
    const d = await provisioned()
    await scanUnit(order.orderId, d.id, staff.id)
    await enroll(d)
    const t = nowS()
    await upload(d, [[t - 120, 1500, 21, 40]])
    await upload(d, [[t - 60, 1600, 21, 40]])
    const evs = await q(`SELECT * FROM alert_events WHERE device_id = $1`, [d.id])
    expect(evs.length).toBe(1)
    expect(evs[0].value).toBe(1600)
    expect((await q(`SELECT * FROM email_outbox WHERE to_email = 'alert@example.com' AND kind = 'alert'`)).length).toBe(1)
    await upload(d, [[t - 30, 1150, 21, 40]]) // within hysteresis of 1200: still open
    expect((await one(`SELECT resolved_at FROM alert_events WHERE device_id = $1`, [d.id])).resolved_at).toBeNull()
    await upload(d, [[t, 900, 21, 40]])
    expect((await one(`SELECT resolved_at FROM alert_events WHERE device_id = $1`, [d.id])).resolved_at).not.toBeNull()

    // Offline alert after the house threshold (6 h)
    await q(`UPDATE devices SET last_seen_at = now() - interval '7 hours' WHERE id = $1`, [d.id])
    const { pool } = await import('../src/lib/db')
    expect(await checkOffline(pool())).toBeGreaterThanOrEqual(1)
    expect(await checkOffline(pool())).toBe(0) // not re-opened

    const sent = await sendWeeklyReports(new Date(Date.now() + 7 * 86400_000))
    expect(sent).toBeGreaterThanOrEqual(1)
    const rep = await one(`SELECT * FROM email_outbox WHERE to_email = 'alert@example.com' AND kind = 'weekly_report'`)
    expect(rep.html).toMatch(/Unnamed device/)
  })
})

describe('screen & light setting', () => {
  it('is on by default and follows the portal setting in the upload reply', async () => {
    const order = await createOrder({ source: 'manual', email: 'display@example.com', deviceQty: 1 })
    const staff = await one(`INSERT INTO users (email, role) VALUES ('s3@x.com', 'staff') RETURNING id`)
    const d = await provisioned()
    await scanUnit(order.orderId, d.id, staff.id)
    await enroll(d)
    expect((await upload(d, [[nowS() - 60, 600, 21, 40]])).body.display).toBe(true)
    await q('UPDATE devices SET display_on = false WHERE id = $1', [d.id])
    expect((await upload(d, [[nowS(), 610, 21, 40]])).body.display).toBe(false)
  })
})
