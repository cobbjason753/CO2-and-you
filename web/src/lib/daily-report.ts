/**
 * Daily house report — the format from the CO2-and-you-reports repo (report.py), now built
 * from the CobSci platform's own data and sent by the platform.
 *
 * For each house: the last 24 hours per room (CO2, temperature, humidity) compared with the
 * 7 days before, devices that stopped reporting, plain-language recommendations, a CO2 chart
 * and a by-room table.
 */
import crypto from 'node:crypto'
import { q, one, type Db } from './db'
import { env } from './env'
import { cToF } from './units'
import { sendRawEmail } from './email'

// ---- thresholds (ppm). Outdoor air is roughly 420 ppm. Same as report.py. ----
export const CO2_GOOD = 800
export const CO2_FAIR = 1000
export const CO2_POOR = 1500
export const CO2_SPIKE = 2000
export const HUMIDITY_LOW = 30
export const HUMIDITY_HIGH = 60
const OFFLINE_AFTER_MS = 30 * 60_000
const NIGHT_START_HOUR = 22 // local; "overnight" = 10 pm – 7 am
const NIGHT_END_HOUR = 7
export const SEND_AFTER_LOCAL_HOUR = 7 // each house gets its report after 7 am local time

export const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948']
const INK = '#0b0b0b'
const INK_2 = '#52514e'
const MUTED = '#898781'
const GRID = '#e1e0d9'
const SURFACE = '#fcfcfb'

type Rating = { max: number; label: string; bg: string; fg: string }
const RATINGS: Rating[] = [
  { max: CO2_GOOD, label: 'Good', bg: '#e3f5e3', fg: '#0a6b0a' },
  { max: CO2_FAIR, label: 'Fair', bg: '#fff4d6', fg: '#7a5200' },
  { max: CO2_POOR, label: 'Poor', bg: '#fde6dc', fg: '#9a3a14' },
  { max: Infinity, label: 'Very poor', bg: '#fbe1e1', fg: '#a32323' },
]
export const ratingFor = (avg: number | null) => (avg == null ? null : RATINGS.find((r) => avg < r.max)!)

// ---- data ----
export type Reading = { t: number; device: string; room: string | null; co2: number; tempC: number; hum: number }
export type HouseInfo = { id: string; name: string; timezone: string }
export type DeviceInfo = { id: string; room_id: string | null; last_seen_at: Date | null; last_reading_at: Date | null }

export async function loadHouse(houseId: string, now: Date, c?: Db) {
  const house = await one<HouseInfo>('SELECT id, name, timezone FROM houses WHERE id = $1', [houseId], c)
  if (!house) throw new Error('No such house')
  const rows = await q<{ t: Date; device_id: string; room_id: string | null; co2: number; temp_c: number; humidity: number }>(
    `SELECT time AS t, device_id, room_id, co2, temp_c, humidity FROM readings
      WHERE house_id = $1 AND time >= $2 AND time <= $3 ORDER BY time`,
    [houseId, new Date(now.getTime() - 8 * 86400_000), now],
    c,
  )
  const devices = await q<DeviceInfo>('SELECT id, room_id, last_seen_at, last_reading_at FROM devices WHERE house_id = $1', [houseId], c)
  const roomNames = new Map(
    (await q<{ id: string; name: string }>('SELECT id, name FROM rooms WHERE house_id = $1', [houseId], c)).map((r) => [r.id, r.name]),
  )
  const readings: Reading[] = rows.map((r) => ({ t: new Date(r.t).getTime(), device: r.device_id, room: r.room_id, co2: r.co2, tempC: r.temp_c, hum: r.humidity }))
  return { house, readings, devices, roomNames }
}

// ---- analysis ----
export type RoomSummary = {
  key: string
  label: string
  deviceId: string
  color: string
  lastReading: number | null
  online: boolean
  connected: boolean // checking in (firmware v10+) even if its CO2 sensor is silent
  readings: number
  co2Avg: number | null
  co2Max: number | null
  co2MaxTime: number | null
  hoursOver1000: number
  nightAvg: number | null
  worstHour: number | null
  priorAvg: number | null
  tempAvgC: number | null
  humAvg: number | null
  rating: Rating | null
}

const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null)

function localHour(t: number, tz: string) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(t))
  return Number(p.find((x) => x.type === 'hour')!.value)
}

function sampleIntervalHours(times: number[]) {
  if (times.length < 2) return 5 / 60
  const diffs = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b)
  const minutes = diffs[Math.floor(diffs.length / 2)] / 60_000
  return Math.min(Math.max(minutes, 0.5), 30) / 60
}

export function summarize(
  readings: Reading[],
  devices: DeviceInfo[],
  roomNames: Map<string, string>,
  now: number,
  tz: string,
): RoomSummary[] {
  const dayStart = now - 24 * 3600_000
  // One series per (room, device), like report.py's (location, device).
  const groups = new Map<string, Reading[]>()
  for (const r of readings) {
    const k = `${r.room ?? 'none'}|${r.device}`
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(r)
  }
  // Devices in the house with no readings in 8 days still get a row (they're offline).
  for (const d of devices) {
    if (![...groups.keys()].some((k) => k.endsWith(`|${d.id}`))) groups.set(`${d.room_id ?? 'none'}|${d.id}`, [])
  }
  const labelFor = (room: string | null, device: string) => (room && roomNames.get(room)) || `Unnamed (…${device.slice(-4)})`
  const entries = [...groups.entries()].map(([k, g]) => {
    const [room, device] = k.split('|')
    return { k, room: room === 'none' ? null : room, device, g }
  })
  const labelCounts = new Map<string, number>()
  for (const e of entries) labelCounts.set(labelFor(e.room, e.device), (labelCounts.get(labelFor(e.room, e.device)) ?? 0) + 1)
  entries.sort((a, b) => labelFor(a.room, a.device).localeCompare(labelFor(b.room, b.device)))

  const devMap = new Map(devices.map((d) => [d.id, d]))
  return entries.map((e, i) => {
    const base = labelFor(e.room, e.device)
    const label = (labelCounts.get(base) ?? 0) > 1 ? `${base} (${e.device.slice(-4)})` : base
    const day = e.g.filter((r) => r.t >= dayStart)
    const prior = e.g.filter((r) => r.t < dayStart)
    const lastReading = e.g.length ? e.g[e.g.length - 1].t : devMap.get(e.device)?.last_reading_at?.getTime() ?? null
    const lastSeen = devMap.get(e.device)?.last_seen_at?.getTime() ?? null
    const s: RoomSummary = {
      key: e.k,
      label,
      deviceId: e.device,
      color: SERIES_COLORS[i % SERIES_COLORS.length],
      lastReading,
      // A series from a room the device has since left isn't "offline".
      online: lastReading != null && now - lastReading <= OFFLINE_AFTER_MS,
      connected: lastSeen != null && now - lastSeen <= OFFLINE_AFTER_MS,
      readings: day.length,
      co2Avg: null,
      co2Max: null,
      co2MaxTime: null,
      hoursOver1000: 0,
      nightAvg: null,
      worstHour: null,
      priorAvg: mean(prior.map((r) => r.co2)),
      tempAvgC: null,
      humAvg: null,
      rating: null,
    }
    if (!day.length) return s
    const h = sampleIntervalHours(day.map((r) => r.t))
    s.co2Avg = mean(day.map((r) => r.co2))
    const peak = day.reduce((m, r) => (r.co2 > m.co2 ? r : m), day[0])
    s.co2Max = peak.co2
    s.co2MaxTime = peak.t
    s.hoursOver1000 = day.filter((r) => r.co2 > CO2_FAIR).length * h
    const hours = day.map((r) => localHour(r.t, tz))
    const night = day.filter((_, j) => hours[j] >= NIGHT_START_HOUR || hours[j] < NIGHT_END_HOUR)
    if (night.length * h >= 3) s.nightAvg = mean(night.map((r) => r.co2))
    const byHour = new Map<number, number[]>()
    day.forEach((r, j) => byHour.set(hours[j], [...(byHour.get(hours[j]) ?? []), r.co2]))
    let worst: [number, number] = [-1, -Infinity]
    for (const [hr, v] of byHour) if (mean(v)! > worst[1]) worst = [hr, mean(v)!]
    s.worstHour = worst[0]
    s.tempAvgC = mean(day.map((r) => r.tempC))
    s.humAvg = mean(day.map((r) => r.hum))
    s.rating = ratingFor(s.co2Avg)
    return s
  })
}

// Only rooms whose device still lives there count for "stopped reporting".
const isCurrent = (r: RoomSummary, devices: DeviceInfo[]) => {
  const d = devices.find((x) => x.id === r.deviceId)
  return !!d && (d.room_id ?? 'none') === r.key.split('|')[0]
}

const fmtHour = (h: number) => `${h % 12 || 12} ${h < 12 ? 'am' : 'pm'}`
const fmtTime = (t: number, tz: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(t)).toLowerCase()
const fmtDay = (t: number, tz: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric' }).format(new Date(t))
const n0 = (v: number) => Math.round(v).toLocaleString('en-US')

export type Rec = { priority: number; headline: string; detail: string }

/** Same rules and wording as report.py's recommendations(). Lower priority = more important. */
export function recommendations(rooms: RoomSummary[], devices: DeviceInfo[], tz: string, now: number): Rec[] {
  const recs: Rec[] = []
  for (const r of rooms) {
    const name = r.label
    if (!r.online && isCurrent(r, devices)) {
      if (r.connected) {
        recs.push({
          priority: 0,
          headline: `${name} isn't sending CO2 readings`,
          detail: `The sensor is connected, but its last reading was ${r.lastReading ? (now - r.lastReading < 86400_000 ? `at ${fmtTime(r.lastReading, tz)}` : `on ${fmtDay(r.lastReading, tz)}`) : 'never'}. Unplug it for 10 seconds and plug it back in; if that doesn't help, contact us from the Help page.`,
        })
      } else {
        const when = r.lastReading == null ? 'a while ago' : now - r.lastReading < 86400_000 ? `at ${fmtTime(r.lastReading, tz)}` : `on ${fmtDay(r.lastReading, tz)}`
        recs.push({
          priority: 0,
          headline: `${name} stopped reporting`,
          detail: `Its last reading was ${when}. Check that it has power and is within WiFi range; unplugging it for 10 seconds usually reconnects it.`,
        })
      }
    }
    if (r.co2Avg == null) continue

    if (r.nightAvg != null && r.nightAvg > CO2_FAIR) {
      const strong = r.nightAvg > CO2_POOR
      recs.push({
        priority: strong ? 1 : 2,
        headline: `${name} gets stuffy overnight`,
        detail:
          `CO2 averaged ${n0(r.nightAvg)} ppm between ${fmtHour(NIGHT_START_HOUR)} and ${fmtHour(NIGHT_END_HOUR)}. Sleeping with the door ajar or a window cracked, or setting the HVAC fan to run overnight, brings bedroom CO2 down noticeably.` +
          (strong ? ' Levels this high are linked to poorer sleep quality.' : ''),
      })
    } else if (r.hoursOver1000 >= 2) {
      recs.push({
        priority: 2,
        headline: `${name} was above 1,000 ppm for ${r.hoursOver1000.toFixed(1)} hours`,
        detail: `It was worst around ${fmtHour(r.worstHour!)}. Opening a window or running an exhaust fan during that part of the day will help most.`,
      })
    }
    if (r.co2Max != null && r.co2Max >= CO2_SPIKE) {
      recs.push({
        priority: 3,
        headline: `${name} peaked at ${n0(r.co2Max)} ppm`,
        detail: `That was at ${fmtTime(r.co2MaxTime!, tz)}. Short spikes usually come from cooking (especially on a gas stove), a gathering, or a closed door. Run the range hood or exhaust fan and air the room out when it happens.`,
      })
    }
    if (r.priorAvg && r.co2Avg - r.priorAvg >= Math.max(100, 0.15 * r.priorAvg)) {
      recs.push({
        priority: 4,
        headline: `${name} is up from its usual level`,
        detail: `Today's average of ${n0(r.co2Avg)} ppm is higher than its 7-day average of ${n0(r.priorAvg)} ppm. Something changed - windows closed, more people home, or a ventilation setting.`,
      })
    }
    if (r.humAvg != null && r.humAvg < HUMIDITY_LOW) {
      recs.push({
        priority: 5,
        headline: `${name} air is dry`,
        detail: `Humidity averaged ${r.humAvg.toFixed(0)}%. Below ${HUMIDITY_LOW}% can irritate eyes, skin and sinuses; a humidifier can bring it back into the 30-50% range.`,
      })
    } else if (r.humAvg != null && r.humAvg > HUMIDITY_HIGH) {
      recs.push({
        priority: 5,
        headline: `${name} is humid`,
        detail: `Humidity averaged ${r.humAvg.toFixed(0)}%. Staying above ${HUMIDITY_HIGH}% encourages mold and dust mites; a dehumidifier or exhaust fan can bring it down.`,
      })
    }
  }
  if (!rooms.length) {
    recs.push({
      priority: 0,
      headline: 'No devices have reported in the last 8 days',
      detail:
        'Check that each device is plugged in and shows readings on its screen. If the screen shows a setup QR code, it needs to be connected to WiFi again.',
    })
  }
  if (!recs.some((x) => x.priority <= 3) && rooms.some((r) => r.co2Avg != null)) {
    recs.push({ priority: 9, headline: 'Air quality looked good', detail: "No room stayed above 1,000 ppm for long. Keep doing what you're doing." })
  }
  return recs.sort((a, b) => a.priority - b.priority)
}

// ---- chart link (PNG drawn by /api/reports/chart, signed so it can't be guessed) ----
export function chartSig(houseId: string, t: number) {
  return crypto.createHmac('sha256', 'report-chart:' + (process.env.APP_SECRET ?? '')).update(`${houseId}:${t}`).digest('hex').slice(0, 32)
}
export function chartUrl(houseId: string, t: number) {
  return `${env.appUrl()}/api/reports/chart?h=${encodeURIComponent(houseId)}&t=${t}&s=${chartSig(houseId, t)}`
}

// ---- email ----
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const num = (v: number | null, f: (x: number) => string = n0, unit = '') => (v == null ? '&ndash;' : f(v) + unit)

function chip(r: Rating) {
  const icon = { Good: '&#10003;', Fair: '&#9679;', Poor: '&#9650;', 'Very poor': '&#9650;' }[r.label]
  return `<span style="display:inline-block;padding:2px 8px;border-radius:10px;background:${r.bg};color:${r.fg};font-size:12px;font-weight:600;white-space:nowrap">${icon} ${r.label}</span>`
}

export type DailyReport = { subject: string; html: string; text: string; urgent: boolean; rooms: RoomSummary[]; recs: Rec[] }

export function buildReport(
  house: HouseInfo,
  rooms: RoomSummary[],
  recs: Rec[],
  now: number,
  unit: 'F' | 'C',
  chart: string | null,
): DailyReport {
  const tz = house.timezone
  const reporting = rooms.filter((r) => r.co2Avg != null)
  const urgent = recs.filter((x) => x.priority <= 3)
  let subject: string
  let headline: string
  if (!reporting.length) {
    subject = `CobSci: no readings from ${house.name} in the last 24 hours`
    headline = 'No readings in the last 24 hours'
  } else if (urgent.length) {
    subject = `CobSci daily report: ${urgent[0].headline}`
    headline = urgent[0].headline
  } else {
    subject = `CobSci daily report: air quality looked good at ${house.name}`
    headline = 'Air quality looked good'
  }
  const fmtP = (t: number) =>
    new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(t))
  const period = `${fmtP(now - 24 * 3600_000)} &ndash; ${fmtP(now)}`
  const temp = (c: number | null) => (c == null ? null : unit === 'F' ? cToF(c) : c)

  const td = `padding:10px 8px;border-top:1px solid ${GRID}`
  const rows = rooms
    .map((r) => {
      let status = r.rating ? chip(r.rating) : ''
      if (!r.online && r.lastReading != null && Date.now() - r.lastReading < 9 * 86400_000)
        status += `<br><span style="color:#a32323;font-size:12px;white-space:nowrap">&#9888; ${r.connected ? 'No readings' : 'Offline'}</span>`
      const swatch = `<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${r.color};margin-right:6px"></span>`
      return `<tr>
          <td style="${td};color:${INK};font-weight:600">${swatch}${esc(r.label)}</td>
          <td style="${td}">${status}</td>
          <td style="${td};text-align:right;color:${INK};white-space:nowrap">${num(r.co2Avg)}<br><span style="color:${INK_2};font-size:12px">peak ${num(r.co2Max)}</span></td>
          <td style="${td};text-align:right;color:${INK};white-space:nowrap">${num(r.hoursOver1000, (x) => x.toFixed(1), ' h')}</td>
          <td style="${td};text-align:right;color:${INK};white-space:nowrap">${num(temp(r.tempAvgC), (x) => x.toFixed(0), `&deg;${unit}`)}</td>
          <td style="${td};text-align:right;color:${INK};white-space:nowrap">${num(r.humAvg, (x) => x.toFixed(0), '%')}</td>
        </tr>`
    })
    .join('')
  const recHtml = recs
    .map(
      (x) =>
        `<tr><td style="padding:0 0 14px 0"><div style="font-weight:600;color:${INK};margin-bottom:3px">${esc(x.headline)}</div><div style="color:${INK_2};line-height:1.45">${esc(x.detail)}</div></td></tr>`,
    )
    .join('')
  const chartHtml = chart
    ? `<img src="${esc(chart)}" width="600" alt="CO2 levels over the last 24 hours by room" style="display:block;width:100%;max-width:600px;height:auto;border:0;border-radius:6px">`
    : ''
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f1f0ec">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f0ec">
<tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
       style="max-width:640px;background:${SURFACE};border-radius:12px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;color:${INK}">
  <tr><td style="padding:24px 20px 4px 20px">
    <div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:${INK_2}">CobSci &middot; Daily report</div>
    <div style="font-size:22px;font-weight:700;margin:6px 0 4px 0">${esc(headline)}</div>
    <div style="color:${INK_2};font-size:13px">${esc(house.name)} &middot; ${period}</div>
  </td></tr>
  <tr><td style="padding:16px 20px 0 20px">
    <div style="font-size:15px;font-weight:700;margin-bottom:10px">What to do</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${recHtml}</table>
  </td></tr>
  ${chart ? `<tr><td style="padding:8px 20px 0 20px">
    <div style="font-size:15px;font-weight:700;margin-bottom:6px">CO2 over the last 24 hours</div>
    ${chartHtml}
  </td></tr>` : ''}
  <tr><td style="padding:16px 20px 8px 20px">
    <div style="font-size:15px;font-weight:700;margin-bottom:6px">By room</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px">
      <tr style="color:${INK_2};font-size:12px">
        <td style="padding:4px 8px">Room</td><td style="padding:4px 8px">Air</td>
        <td style="padding:4px 8px;text-align:right">Avg CO2 (ppm)</td>
        <td style="padding:4px 8px;text-align:right">Over 1,000</td>
        <td style="padding:4px 8px;text-align:right">Temp</td>
        <td style="padding:4px 8px;text-align:right">Humidity</td>
      </tr>
      ${rows}
    </table>
  </td></tr>
  <tr><td style="padding:12px 20px 8px 20px">
    <a href="${env.appUrl()}/app/history" style="display:inline-block;background:#0f766e;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">Open the CobSci app</a>
  </td></tr>
  <tr><td style="padding:12px 20px 24px 20px;color:${MUTED};font-size:12px;line-height:1.5">
    Ratings use each room's 24-hour average CO2: Good under ${CO2_GOOD}, Fair ${CO2_GOOD}&ndash;${n0(CO2_FAIR)},
    Poor ${n0(CO2_FAIR)}&ndash;${n0(CO2_POOR)}, Very poor above ${n0(CO2_POOR)} ppm. Outdoor air is about 420 ppm.
    Turn this email off in the CobSci app under Reports.
  </td></tr>
</table>
</td></tr></table>
</body></html>`

  const text = [
    `CobSci daily report - ${house.name}`,
    headline,
    '',
    'What to do:',
    ...recs.map((x) => `- ${x.headline}: ${x.detail}`),
    '',
    'By room (avg CO2 / peak / hours over 1,000 / temp / humidity):',
    ...rooms.map((r) => {
      const t = temp(r.tempAvgC)
      return `- ${r.label}: ${r.online ? '' : r.connected ? 'NO READINGS ' : 'OFFLINE '}${r.co2Avg == null ? '-' : n0(r.co2Avg)} / ${r.co2Max == null ? '-' : n0(r.co2Max)} ppm / ${r.hoursOver1000.toFixed(1)} h / ${t == null ? '-' : t.toFixed(0) + unit} / ${r.humAvg == null ? '-' : r.humAvg.toFixed(0) + '%'}`
    }),
    '',
    `Open the CobSci app: ${env.appUrl()}/app/history`,
  ].join('\n')
  return { subject, html, text, urgent: urgent.length > 0, rooms, recs }
}

/** Everything needed to show or send a house's report as of `now`. */
export async function houseReport(houseId: string, now: Date, unit: 'F' | 'C', c?: Db) {
  const t = Math.floor(now.getTime() / 60_000) * 60_000
  const { house, readings, devices, roomNames } = await loadHouse(houseId, new Date(t), c)
  const rooms = summarize(readings, devices, roomNames, t, house.timezone)
  const recs = recommendations(rooms, devices, house.timezone, t)
  const hasDay = readings.some((r) => r.t >= t - 24 * 3600_000)
  return buildReport(house, rooms, recs, t, unit, hasDay ? chartUrl(house.id, t) : null)
}

// ---- sending ----
function localParts(now: Date, tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  )
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) }
}

/**
 * Called by the scheduled job (every 15 min). Each house with sensors gets one report per local
 * day, after 7 am its time, to every member who has daily reports on.
 */
export async function sendDailyReports(now = new Date(), c?: Db): Promise<number> {
  const houses = await q<{ id: string; timezone: string }>(
    `SELECT h.id, h.timezone FROM houses h WHERE EXISTS (SELECT 1 FROM devices d WHERE d.house_id = h.id)`,
    [],
    c,
  )
  let sent = 0
  for (const h of houses) {
    const { date, hour } = localParts(now, h.timezone)
    if (hour < SEND_AFTER_LOCAL_HOUR) continue
    // Claim the day first so overlapping runs can't send twice.
    const claimed = await one(`INSERT INTO daily_reports (house_id, local_date) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING 1`, [h.id, date], c)
    if (!claimed) continue
    const members = await q<{ email: string; temp_unit: 'F' | 'C' }>(
      `SELECT u.email, u.temp_unit FROM house_members m JOIN users u ON u.id = m.user_id
        WHERE m.house_id = $1 AND u.daily_report AND u.password_hash IS NOT NULL`,
      [h.id],
      c,
    )
    const byUnit = new Map<'F' | 'C', DailyReport>()
    for (const m of members) {
      if (!byUnit.has(m.temp_unit)) byUnit.set(m.temp_unit, await houseReport(h.id, now, m.temp_unit, c))
      const r = byUnit.get(m.temp_unit)!
      await sendRawEmail(m.email, r.subject, r.html, r.text, 'daily_report')
      sent++
    }
  }
  return sent
}
