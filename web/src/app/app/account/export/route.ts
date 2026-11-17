import { zipSync, strToU8 } from 'fflate'
import { requireUser } from '@/lib/auth'
import { q } from '@/lib/db'
import { toCsv } from '@/lib/readings'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** "Download my data": profile, memberships, devices, alerts, and all readings for houses the user belongs to. */
export async function GET() {
  const { user } = await requireUser()
  const profile = await q(
    `SELECT id, email, name, role, temp_unit, weekly_report, totp_enabled, created_at, last_login_at FROM users WHERE id = $1`,
    [user.id],
  )
  const houses = await q(
    `SELECT h.id, h.name, h.timezone, m.role, m.created_at AS member_since FROM house_members m JOIN houses h ON h.id = m.house_id WHERE m.user_id = $1`,
    [user.id],
  )
  const files: Record<string, Uint8Array> = {
    'README.txt': strToU8(
      `CO2 & You data export for ${user.email}\nCreated ${new Date().toISOString()}\n\nprofile.json      your account\nhouses.json       houses you belong to, with rooms, devices, alert rules and alert history\nreadings-<HOUSE_ID>.csv   every reading recorded in that house (UTC)\norders.json       your orders\nsupport.json      messages you sent to support\n`,
    ),
    'profile.json': strToU8(JSON.stringify(profile[0], null, 2)),
  }
  const detail = []
  for (const h of houses as any[]) {
    const rooms = await q('SELECT id, name, created_at FROM rooms WHERE house_id = $1', [h.id])
    const devices = await q('SELECT id, room_id, fw_version, assigned_at, last_seen_at FROM devices WHERE house_id = $1', [h.id])
    const rules = await q('SELECT room_id, kind, threshold, enabled FROM alert_rules WHERE house_id = $1', [h.id])
    const events = await q('SELECT device_id, room_id, kind, value, threshold, started_at, resolved_at FROM alert_events WHERE house_id = $1 ORDER BY started_at', [h.id])
    detail.push({ ...h, rooms, devices, alert_rules: rules, alert_events: events })
    const rows = await q<any>(
      `SELECT to_char(r.time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS t, coalesce(rm.name, '') AS room, r.device_id, r.co2, r.temp_c, r.humidity
         FROM readings r LEFT JOIN rooms rm ON rm.id = r.room_id WHERE r.house_id = $1 ORDER BY r.time`,
      [h.id],
    )
    files[`readings-${h.id}.csv`] = strToU8(toCsv(['time_utc', 'room', 'device_id', 'co2_ppm', 'temp_c', 'humidity_pct'], rows.map((r) => [r.t, r.room, r.device_id, r.co2, r.temp_c, r.humidity])))
  }
  files['houses.json'] = strToU8(JSON.stringify(detail, null, 2))
  files['orders.json'] = strToU8(JSON.stringify(await q('SELECT number, status, device_qty, items, created_at, shipped_at FROM orders WHERE user_id = $1', [user.id]), null, 2))
  files['support.json'] = strToU8(JSON.stringify(await q('SELECT id, subject, body, created_at FROM support_requests WHERE user_id = $1', [user.id]), null, 2))
  const zip = zipSync(files, { level: 6 })
  return new Response(new Uint8Array(zip), {
    headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="co2andyou-data-${new Date().toISOString().slice(0, 10)}.zip"` },
  })
}
