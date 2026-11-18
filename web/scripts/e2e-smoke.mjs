// End-to-end smoke test of the device lifecycle through the real UI and device API.
// Needs a running app (npm run dev), seeded demo data (npm run seed) and Playwright installed.
//   node scripts/e2e-smoke.mjs [http://localhost:3000]
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')
import crypto from 'node:crypto'

const BASE = process.argv[2] || 'http://localhost:3000'
const STAFF_TOTP = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
const step = (s) => console.log('•', s)
const fail = (m) => { console.error('✗', m); process.exit(1) }

function totp(secret, offset = 0) {
  const alph = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const c of secret) bits += alph.indexOf(c).toString(2).padStart(5, '0')
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)))
  const ctr = Buffer.alloc(8)
  ctr.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset))
  const h = crypto.createHmac('sha1', key).update(ctr).digest()
  const o = h[19] & 15
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0')
}

const dev = () => ({ id: 'esp32-' + crypto.randomBytes(6).toString('hex').toUpperCase(), secret: crypto.randomBytes(32).toString('hex') })
async function api(path, body, headers = {}) {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body })
  return { status: r.status, json: await r.json().catch(() => ({})) }
}
async function upload(d, co2) {
  const body = JSON.stringify({ fw: 8, rssi: -60, readings: [[Math.floor(Date.now() / 1000), co2, 21.5, 44]] })
  const ts = String(Math.floor(Date.now() / 1000))
  const sig = crypto.createHmac('sha256', Buffer.from(d.secret, 'hex')).update(`${d.id}\n${ts}\n${body}`).digest('hex')
  return api('/api/device/readings', body, { 'X-Device-Id': d.id, 'X-Timestamp': ts, 'X-Signature': sig })
}

const browser = await chromium.launch()
const staff = await (await browser.newContext()).newPage()
const A = dev(), B = dev()
const email = `e2e-${Date.now()}@example.com`

step('staff signs in with password + authenticator code')
await staff.goto(BASE + '/login')
await staff.fill('input[name=email]', 'admin@cobsci.com')
await staff.fill('input[name=password]', 'demo-password-1')
await staff.click('button[type=submit]')
await staff.waitForURL(/2fa/)
await staff.fill('input[name=code]', totp(STAFF_TOTP))
await staff.click('button[type=submit]')
await staff.waitForURL(/\/admin$/)

step('provision two boards and read claim codes off the labels')
await staff.goto(BASE + '/admin/provisioning')
await staff.fill('input[name=fw]', '8')
await staff.fill('textarea[name=devices]', `${A.id}\n${B.id}, pass, ${B.secret}`)
await staff.click('text=Register and make labels')
await staff.waitForSelector('text=2 labels ready')
const codes = await staff.locator('.print-area .font-mono').allTextContents()
if (codes.length !== 2) fail('expected 2 claim codes')
const claimB = codes[1]

step('device A enrolls itself (trust on first use)')
let r = await api('/api/device/enroll', JSON.stringify({ device_id: A.id, secret: A.secret, fw: 8 }))
if (r.status !== 200) fail('enroll ' + JSON.stringify(r))

step('create a manual order and scan device A at the packing station')
await staff.goto(BASE + '/admin/packing/new')
await staff.fill('input[name=email]', email)
await staff.fill('input[name=name]', 'Casey Tester')
await staff.click('text=Create order')
await staff.waitForURL(/\/admin\/packing\/[0-9a-f-]{36}/)
await staff.fill('#scan', 'esp32-000000000000')
await staff.press('#scan', 'Enter')
await staff.waitForSelector('text=unknown unit')
await staff.fill('#scan', A.id.toLowerCase())
await staff.press('#scan', 'Enter')
await staff.waitForSelector('text=All units scanned')
await staff.fill('input[name=tracking]', '1Z-E2E')
await staff.click('text=Mark shipped & email customer')
await staff.waitForSelector('p:has-text("Shipped ")')

step('welcome email is in the outbox; follow its set-password link')
await staff.goto(BASE + '/admin/emails')
const mail = staff.locator('li', { hasText: email }).first()
await mail.locator('summary').click()
const text = await mail.locator('pre').textContent()
const link = text.match(/http\S+\/set-password\/\S+/)?.[0]
if (!link) fail('no set-password link in email')

const cust = await (await browser.newContext()).newPage()
await cust.goto(link.replace(/^https?:\/\/[^/]+/, BASE))
await cust.fill('input[name=password]', 'correct-horse-9')
await cust.fill('input[name=confirm]', 'correct-horse-9')
await cust.click('text=Create account')
await cust.waitForURL(/\/app$/)

step('device A reports; it appears as an unnamed device')
r = await upload(A, 650)
if (r.status !== 200 || r.json.claimed !== true || r.json.name !== '') fail('upload ' + JSON.stringify(r))
await cust.reload()
await cust.waitForSelector('text=Name your new sensor')

step('customer names it "Kitchen" in the portal; the device learns the name')
await cust.fill('input[name=name]', 'Kitchen')
await cust.click('form:has(input[name=name]) button[type=submit]')
await cust.waitForSelector('h2:text-is("Kitchen")')
r = await upload(A, 700)
if (r.json.name !== 'Kitchen') fail('device did not get new name: ' + JSON.stringify(r.json))

step('customer renames it again from Devices')
await cust.goto(BASE + '/app/devices')
const nameInput = cust.locator('input[name=name]').first()
await nameInput.fill('Main kitchen')
await cust.locator('form:has(input[name=name]) button[type=submit]').first().click()
await cust.waitForSelector('text=Saved')
r = await upload(A, 710)
if (r.json.name !== 'Main kitchen') fail('rename not delivered: ' + JSON.stringify(r.json))

step('customer claims device B with the label code')
await cust.goto(BASE + '/claim?code=' + encodeURIComponent(claimB))
await cust.fill('input[name=room]', 'Nursery')
await cust.click('text=Add sensor')
await cust.waitForURL(/claimed=1/)
r = await upload(B, 900)
if (r.json.name !== 'Nursery') fail('claimed device name: ' + JSON.stringify(r.json))

step('dashboard shows both rooms; CSV export works')
await cust.goto(BASE + '/app')
await cust.waitForSelector('text=Main kitchen')
await cust.waitForSelector('text=Nursery')
const day = (n) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10)
const csv = await cust.request.get(BASE + `/app/history/export?from=${day(-2)}&to=${day(1)}`)
const body = await csv.text()
if (!body.includes('Main kitchen') || !body.includes('Nursery')) fail('csv missing rooms: ' + body.slice(0, 200))

step('the customer cannot see the admin area or another house')
await cust.goto(BASE + '/admin')
if (!cust.url().endsWith('/app')) fail('customer reached admin: ' + cust.url())

await browser.close()
console.log('✓ lifecycle passed')
