// Pretends to be a CO2 & You sensor: enrolls, then uploads signed readings exactly like the firmware.
//
//   npm run simulate -- --device esp32-AABBCCDDEEFF [--url http://localhost:3000] [--secret <64 hex>]
//                       [--backfill-hours 48] [--every 300] [--once]
//
// The secret is stored in .sim-secrets.json so restarts reuse it (like the device's NVS).
import crypto from 'node:crypto'
import fs from 'node:fs'

const args = Object.fromEntries(
  process.argv.slice(2).reduce<[string, string][]>((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true'])
    return acc
  }, []),
)
const url = (args.url || process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '')
const deviceId = args.device
if (!deviceId) {
  console.error('usage: npm run simulate -- --device esp32-AABBCCDDEEFF')
  process.exit(1)
}
const store = '.sim-secrets.json'
const secrets: Record<string, string> = fs.existsSync(store) ? JSON.parse(fs.readFileSync(store, 'utf8')) : {}
const secret = args.secret || secrets[deviceId] || crypto.randomBytes(32).toString('hex')
secrets[deviceId] = secret
fs.writeFileSync(store, JSON.stringify(secrets, null, 2))
const fw = parseInt(args.fw || '8', 10)

// A plausible room: CO2 builds up in the evening and overnight, drops in the day.
function reading(t: number, seed: number) {
  const hour = (new Date(t * 1000).getUTCHours() - 5 + 24) % 24
  const occupied = hour >= 18 || hour < 7
  const base = occupied ? 650 + Math.min(900, ((hour + 6) % 24) * 70) : 480
  const co2 = Math.round(base + 60 * Math.sin(t / 1300 + seed) + Math.random() * 40)
  const temp = 20.5 + 1.5 * Math.sin((hour / 24) * 2 * Math.PI) + seed * 0.3
  const hum = 42 + 6 * Math.sin(t / 9000 + seed)
  return [t, co2, +temp.toFixed(2), +hum.toFixed(1)]
}

async function post(path: string, body: string, headers: Record<string, string> = {}) {
  const res = await fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}

async function upload(readings: number[][]) {
  const body = JSON.stringify({ fw, rssi: -58 - Math.round(Math.random() * 10), readings })
  const ts = String(Math.floor(Date.now() / 1000))
  const sig = crypto.createHmac('sha256', Buffer.from(secret, 'hex')).update(`${deviceId}\n${ts}\n${body}`).digest('hex')
  return post('/api/device/readings', body, { 'X-Device-Id': deviceId, 'X-Timestamp': ts, 'X-Signature': sig })
}

const seed = parseInt(deviceId.slice(-2), 16) / 64
const enr = await post('/api/device/enroll', JSON.stringify({ device_id: deviceId, secret, fw }))
console.log('enroll', enr.status, enr.json)
if (enr.status !== 200) process.exit(1)

const now = Math.floor(Date.now() / 1000)
const back = parseFloat(args['backfill-hours'] || '0')
if (back > 0) {
  // Upload history in chunks of 288 (one day), like a device catching up after being offline.
  let t = now - Math.floor(back * 3600)
  t -= t % 300
  while (t < now) {
    const batch: number[][] = []
    for (let i = 0; i < 288 && t < now; i++, t += 300) batch.push(reading(t, seed))
    const r = await upload(batch)
    console.log('backfill', r.status, r.json)
  }
}

const every = parseInt(args.every || '300', 10)
do {
  const r = await upload([reading(Math.floor(Date.now() / 1000), seed)])
  console.log(new Date().toISOString(), r.status, JSON.stringify(r.json))
  if (args.once) break
  await new Promise((res) => setTimeout(res, every * 1000))
} while (true)
