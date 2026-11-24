import { describe, it, expect } from 'vitest'
import { summarize, recommendations, buildReport, sendDailyReports, type Reading, type DeviceInfo } from '../src/lib/daily-report'
import { q, one, tx } from '../src/lib/db'
import { createHouse } from '../src/lib/houses-core'

const TZ = 'America/Los_Angeles'
// 2026-11-20 15:00 UTC = 7:00 am Pacific
const NOW = Date.UTC(2026, 10, 20, 15, 0)
const localHour = (t: number) => Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(new Date(t)))

function demo(): { readings: Reading[]; devices: DeviceInfo[]; rooms: Map<string, string> } {
  const rooms = new Map([['r-bed', 'Primary bedroom'], ['r-kit', 'Kitchen'], ['r-off', 'Office'], ['r-base', 'Basement']])
  const readings: Reading[] = []
  for (let t = NOW - 8 * 86400_000; t <= NOW; t += 5 * 60_000) {
    const h = localHour(t)
    const night = h >= 22 || h < 7
    const lastDay = t > NOW - 24 * 3600_000
    readings.push({ t, device: 'esp32-BED000000001', room: 'r-bed', co2: night ? (lastDay ? 1650 : 1100) : 650, tempC: 20, hum: 44 })
    readings.push({ t, device: 'esp32-KIT000000002', room: 'r-kit', co2: h === 18 && lastDay ? 2300 : 620, tempC: 22, hum: 48 })
    readings.push({ t, device: 'esp32-OFF000000003', room: 'r-off', co2: 560, tempC: 21, hum: 25 })
    if (t < NOW - 5 * 3600_000) readings.push({ t, device: 'esp32-BAS000000004', room: 'r-base', co2: 700, tempC: 17, hum: 50 })
  }
  const dev = (id: string, room: string, seen: number): DeviceInfo => ({ id, room_id: room, last_seen_at: new Date(seen), last_reading_at: new Date(seen) })
  const devices = [
    dev('esp32-BED000000001', 'r-bed', NOW),
    dev('esp32-KIT000000002', 'r-kit', NOW),
    dev('esp32-OFF000000003', 'r-off', NOW),
    dev('esp32-BAS000000004', 'r-base', NOW - 5 * 3600_000),
  ]
  return { readings, devices, rooms }
}

describe('daily report (report.py format)', () => {
  it('summarizes rooms and produces the same recommendations in priority order', () => {
    const { readings, devices, rooms } = demo()
    const s = summarize(readings, devices, rooms, NOW, TZ)
    expect(s.map((r) => r.label)).toEqual(['Basement', 'Kitchen', 'Office', 'Primary bedroom'])
    const bed = s.find((r) => r.label === 'Primary bedroom')!
    expect(bed.nightAvg).toBeGreaterThan(1500)
    expect(bed.rating?.label).toBe('Poor') // 24-hour average ~1,025 ppm
    expect(s.find((r) => r.label === 'Basement')!.online).toBe(false)

    const recs = recommendations(s, devices, TZ, NOW)
    const heads = recs.map((r) => r.headline)
    expect(heads[0]).toBe('Basement stopped reporting')
    expect(heads).toContain('Primary bedroom gets stuffy overnight')
    expect(heads).toContain('Kitchen peaked at 2,300 ppm')
    expect(heads).toContain('Primary bedroom is up from its usual level')
    expect(heads).toContain('Office air is dry')
    expect(heads).not.toContain('Air quality looked good')
    expect(recs.find((r) => r.headline.includes('stuffy'))!.detail).toMatch(/poorer sleep quality/)

    const rep = buildReport({ id: 'H1', name: 'Demo Home', timezone: TZ }, s, recs, NOW, 'F', 'https://x/chart.png')
    expect(rep.subject).toBe('CobSci daily report: Basement stopped reporting')
    expect(rep.html).toContain('CobSci &middot; Daily report')
    expect(rep.html).toContain('https://x/chart.png')
    expect(rep.html).toContain('&#9650; Poor')
    expect(rep.text).toContain('- Basement: OFFLINE')
  })

  it('says air quality looked good when nothing stands out', () => {
    const readings: Reading[] = []
    for (let t = NOW - 2 * 86400_000; t <= NOW; t += 5 * 60_000) readings.push({ t, device: 'esp32-A00000000001', room: 'r1', co2: 600, tempC: 21, hum: 45 })
    const devices = [{ id: 'esp32-A00000000001', room_id: 'r1', last_seen_at: new Date(NOW), last_reading_at: new Date(NOW) }]
    const s = summarize(readings, devices, new Map([['r1', 'Living room']]), NOW, TZ)
    const recs = recommendations(s, devices, TZ, NOW)
    expect(recs.map((r) => r.headline)).toEqual(['Air quality looked good'])
    expect(buildReport({ id: 'H', name: 'Home', timezone: TZ }, s, recs, NOW, 'C', null).subject).toBe(
      'CobSci daily report: air quality looked good at Home',
    )
  })

  it('flags a connected sensor whose CO2 sensor went quiet differently from an offline one', () => {
    const readings: Reading[] = []
    for (let t = NOW - 2 * 86400_000; t <= NOW - 3 * 3600_000; t += 5 * 60_000) readings.push({ t, device: 'esp32-A00000000001', room: 'r1', co2: 600, tempC: 21, hum: 45 })
    const devices = [{ id: 'esp32-A00000000001', room_id: 'r1', last_seen_at: new Date(NOW), last_reading_at: new Date(NOW - 3 * 3600_000) }]
    const s = summarize(readings, devices, new Map([['r1', 'Downstairs']]), NOW, TZ)
    expect(recommendations(s, devices, TZ, NOW)[0].headline).toBe("Downstairs isn't sending CO2 readings")
  })

  it('sends once per house per local day, after 7 am, only to members who want it', async () => {
    const owner = await one(`INSERT INTO users (email, password_hash) VALUES ('daily1@example.com', 'x') RETURNING id`)
    const optedOut = await one(`INSERT INTO users (email, password_hash, daily_report) VALUES ('daily2@example.com', 'x', false) RETURNING id`)
    const houseId = await tx((c) => createHouse(c, owner.id, 'Daily House', TZ))
    await q(`INSERT INTO house_members (house_id, user_id, role) VALUES ($1,$2,'viewer')`, [houseId, optedOut.id])
    const dev = await one(`INSERT INTO devices (id, claim_code_hash, claim_code_hint, test_result, status, house_id) VALUES ('esp32-DA1100000001','x','x','pass','assigned',$1) RETURNING id`, [houseId])
    await q(`INSERT INTO readings (device_id, time, house_id, co2, temp_c, humidity) SELECT $1, to_timestamp($3 / 1000.0) - (n * interval '5 minutes'), $2, 700, 21, 45 FROM generate_series(0, 287) n`, [dev.id, houseId, NOW])

    const before7 = new Date(NOW - 30 * 60_000) // 6:30 am Pacific
    await sendDailyReports(before7)
    expect((await q(`SELECT 1 FROM email_outbox WHERE kind = 'daily_report' AND to_email LIKE 'daily%'`)).length).toBe(0)

    await sendDailyReports(new Date(NOW + 10 * 60_000))
    await sendDailyReports(new Date(NOW + 40 * 60_000)) // later the same morning: not again
    const mails = await q(`SELECT to_email, subject, html FROM email_outbox WHERE kind = 'daily_report' AND to_email LIKE 'daily%'`)
    expect(mails.map((m) => m.to_email)).toEqual(['daily1@example.com'])
    expect(mails[0].subject).toBe('CobSci daily report: air quality looked good at Daily House')
    expect(mails[0].html).toMatch(/\/api\/reports\/chart\?h=/)

    await sendDailyReports(new Date(NOW + 86400_000 + 10 * 60_000)) // next morning
    expect((await q(`SELECT 1 FROM email_outbox WHERE kind = 'daily_report' AND to_email = 'daily1@example.com'`)).length).toBe(2)
  })
})
