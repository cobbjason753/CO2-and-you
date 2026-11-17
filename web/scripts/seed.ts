// Demo data for local development and demos. Safe to re-run (skips if demo user exists).
//   npm run seed
import crypto from 'node:crypto'
import { loadEnv } from './load-env'
loadEnv()
const { pool, q, one, tx } = await import('../src/lib/db')
const { hashPassword, encrypt } = await import('../src/lib/crypto')
const { createHouse } = await import('../src/lib/houses-core')
const { provisionDevice, assignDevice, ensureRoom } = await import('../src/lib/devices')
const { createOrder } = await import('../src/lib/orders')
const { migrate } = await import('./migrate')

await migrate(false)

const DEMO_PW = 'demo-password-1'
// Fixed so the demo staff login works with any authenticator app.
const STAFF_TOTP = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'

if (await one(`SELECT 1 FROM users WHERE email = 'demo@cobsci.com'`)) {
  console.log('Demo data already present.')
  await pool().end()
  process.exit(0)
}

const pw = await hashPassword(DEMO_PW)
const customer = await one<{ id: string }>(`INSERT INTO users (email, name, password_hash) VALUES ('demo@cobsci.com', 'Jordan Demo', $1) RETURNING id`, [pw])
await one(
  `INSERT INTO users (email, name, password_hash, role, totp_secret, totp_enabled) VALUES ('admin@cobsci.com', 'Demo Admin', $1, 'admin', $2, true) RETURNING id`,
  [pw, encrypt(STAFF_TOTP)],
)
await q(`INSERT INTO subscriptions (id, user_id, status, plan, current_period_end) VALUES ('manual-demo', $1, 'active', 'standard', now() + interval '20 days')`, [customer!.id])

const houseId = await tx((c) => createHouse(c, customer!.id, 'Maple Street'))
await tx((c) => createHouse(c, customer!.id, 'Lake cabin'))
await q(`UPDATE alert_rules SET threshold = 1400 WHERE house_id = $1 AND kind = 'co2'`, [houseId])

const mk = () => 'esp32-' + crypto.randomBytes(6).toString('hex').toUpperCase()
const rooms = ['Living room', 'Bedroom', 'Office', null]
const now = Math.floor(Date.now() / 1000)
for (let i = 0; i < rooms.length; i++) {
  const id = mk()
  await tx(async (c) => {
    await provisionDevice(c, { deviceId: id, fw: 7, testResult: 'pass', secretHex: crypto.randomBytes(32).toString('hex') })
    await assignDevice(c, id, houseId, 'packing')
    let roomId: string | null = null
    if (rooms[i]) {
      roomId = await ensureRoom(c, houseId, rooms[i]!)
      await q('UPDATE devices SET room_id = $2 WHERE id = $1', [id, roomId], c)
    }
    // 14 days of 5-minute readings (fewer for the new, unnamed one)
    const days = rooms[i] ? 14 : 0.3
    const ts: number[] = [], co2: number[] = [], temp: number[] = [], hum: number[] = []
    for (let t = now - Math.floor(days * 86400); t <= now; t += 300) {
      const hour = (new Date(t * 1000).getUTCHours() - 5 + 24) % 24
      const occupied = i === 1 ? hour >= 22 || hour < 7 : i === 2 ? hour >= 9 && hour < 17 : hour >= 17 && hour < 23
      const target = occupied ? [1100, 1350, 950, 700][i] : 480
      ts.push(t)
      co2.push(Math.round(target + 80 * Math.sin(t / 2000 + i) + Math.random() * 50))
      temp.push(+(20.5 + i * 0.6 + 1.2 * Math.sin((hour / 24) * 6.28)).toFixed(2))
      hum.push(+(40 + i * 3 + 5 * Math.sin(t / 9000)).toFixed(1))
    }
    await c.query(
      `INSERT INTO readings (device_id, time, house_id, room_id, co2, temp_c, humidity)
       SELECT $1, to_timestamp(t), $2, $3, co2, temp, hum FROM unnest($4::float8[], $5::int[], $6::real[], $7::real[]) AS x(t, co2, temp, hum)`,
      [id, houseId, roomId, ts, co2, temp, hum],
    )
    const last = ts.length - 1
    await q(
      `UPDATE devices SET fw_version = 7, last_seen_at = now(), last_reading_at = to_timestamp($2), last_co2 = $3, last_temp_c = $4,
              last_humidity = $5, last_rssi = $6 WHERE id = $1`,
      [id, ts[last], co2[last], temp[last], hum[last], -52 - i * 9],
      c,
    )
  })
}

// Back office demo: stock on the shelf, an order to pack, a firmware release, an unknown device.
for (let i = 0; i < 4; i++) await tx((c) => provisionDevice(c, { deviceId: mk(), fw: 7, testResult: i === 3 ? 'fail' : 'pass' }))
await createOrder({ source: 'manual', email: 'new.customer@example.com', name: 'Alex Rivera', deviceQty: 2, shipTo: { line1: '12 Elm St', city: 'Portland', state: 'OR', postal_code: '97201', country: 'US' } })
await q(`INSERT INTO firmware_releases (version, url, sha256, stage, notes) VALUES (7, 'https://cobbjason753.github.io/CO2-and-you/firmware-v7.bin', repeat('0', 64), 'general', 'Seed entry')`)
await q(`INSERT INTO unknown_devices (device_id, fw_version, last_ip, legacy_location) VALUES ($1, 6, '203.0.113.7', 'kitchen')`, [mk()])

console.log(`
Demo data ready.
  Customer: demo@cobsci.com / ${DEMO_PW}
  Admin:    admin@cobsci.com / ${DEMO_PW}   (authenticator secret ${STAFF_TOTP})
`)
await pool().end()
