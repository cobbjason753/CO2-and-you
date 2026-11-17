import { q, one, type Db } from './db'
import { sendEmail, type EmailBlock } from './email'
import { env } from './env'
import { cToF } from './units'

export type RoomWeek = { name: string; avg: number; max: number; hoursAbove1000: number; avgTempC: number; avgHum: number; readings: number }

/** Summary of the 7 days before `end`, one row per room the readings were recorded in. */
export async function weeklySummary(houseId: string, end: Date, c?: Db): Promise<RoomWeek[]> {
  const start = new Date(end.getTime() - 7 * 86400_000)
  return q<RoomWeek>(
    `SELECT coalesce(rm.name, 'Unnamed device') AS name,
            round(avg(r.co2))::int AS avg, max(r.co2) AS max,
            round((count(*) FILTER (WHERE r.co2 >= 1000)) * 5 / 60.0, 1)::float AS "hoursAbove1000",
            avg(r.temp_c)::float AS "avgTempC", avg(r.humidity)::float AS "avgHum", count(*)::int AS readings
       FROM readings r LEFT JOIN rooms rm ON rm.id = r.room_id
      WHERE r.house_id = $1 AND r.time >= $2 AND r.time < $3
      GROUP BY 1 ORDER BY 1`,
    [houseId, start, end],
    c,
  )
}

function reportBlocks(houseName: string, rows: RoomWeek[], unit: 'F' | 'C'): EmailBlock[] {
  if (!rows.length) return [{ p: `We didn't receive any readings from ${houseName} this week. Check your sensors are plugged in and online.` }]
  const worst = [...rows].sort((a, b) => b.hoursAbove1000 - a.hoursAbove1000)[0]
  const td = 'padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:left'
  const table =
    `<table style="border-collapse:collapse;width:100%;font-size:14px;margin:0 0 16px">` +
    `<tr><th style="${td}">Room</th><th style="${td}">Avg CO2</th><th style="${td}">Peak</th><th style="${td}">Hours ≥1000</th><th style="${td}">Temp</th></tr>` +
    rows
      .map((r) => {
        const t = unit === 'F' ? `${cToF(r.avgTempC).toFixed(0)}°F` : `${r.avgTempC.toFixed(0)}°C`
        const name = r.name.replace(/[<>&]/g, '')
        return `<tr><td style="${td}">${name}</td><td style="${td}">${r.avg} ppm</td><td style="${td}">${r.max}</td><td style="${td}">${r.hoursAbove1000}</td><td style="${td}">${t}</td></tr>`
      })
      .join('') +
    `</table>`
  const tip =
    worst.hoursAbove1000 >= 3
      ? `${worst.name} spent ${worst.hoursAbove1000} hours at 1000 ppm or more. Cracking a window or leaving the door open overnight usually fixes this.`
      : 'Air quality stayed in a healthy range most of the week. Nice work.'
  return [{ html: table }, { p: tip }, { button: { label: 'See the full history', url: `${env.appUrl()}/app/history?range=week` } }]
}

/** Cron (Mondays): one email per member per house who wants it. Skips houses already sent this week. */
export async function sendWeeklyReports(now = new Date(), c?: Db): Promise<number> {
  const weekStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7)))
  const houses = await q<{ id: string; name: string }>(
    `SELECT h.id, h.name FROM houses h
      WHERE EXISTS (SELECT 1 FROM devices d WHERE d.house_id = h.id)
        AND NOT EXISTS (SELECT 1 FROM weekly_reports w WHERE w.house_id = h.id AND w.week_start = $1)`,
    [weekStart],
    c,
  )
  let sent = 0
  for (const h of houses) {
    const rows = await weeklySummary(h.id, weekStart, c)
    const members = await q<{ email: string; temp_unit: 'F' | 'C' }>(
      `SELECT u.email, u.temp_unit FROM house_members m JOIN users u ON u.id = m.user_id
        WHERE m.house_id = $1 AND u.weekly_report AND u.password_hash IS NOT NULL`,
      [h.id],
      c,
    )
    for (const m of members) {
      await sendEmail(m.email, `Your week of air: ${h.name}`, `${h.name}: your week of air`, reportBlocks(h.name, rows, m.temp_unit), 'weekly_report')
      sent++
    }
    await q('INSERT INTO weekly_reports (house_id, week_start) VALUES ($1,$2) ON CONFLICT DO NOTHING', [h.id, weekStart], c)
  }
  return sent
}

export async function sendTestReport(houseId: string, email: string, unit: 'F' | 'C') {
  const h = await one<{ name: string }>('SELECT name FROM houses WHERE id = $1', [houseId])
  const rows = await weeklySummary(houseId, new Date())
  await sendEmail(email, `Your week of air: ${h!.name} (preview)`, `${h!.name}: your last 7 days`, reportBlocks(h!.name, rows, unit), 'weekly_report')
}
