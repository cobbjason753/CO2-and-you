import { q, one, type Db } from './db'
import { sendEmail } from './email'
import { env } from './env'

const HYSTERESIS_PPM = 100 // close a CO2 alert once it drops this far below the threshold
const RENOTIFY_HOURS = 6 // at most one email per device and alert type in this window

/** Threshold that applies to a room: its own rule if set, else the house rule. */
async function ruleFor(c: Db, houseId: string, roomId: string | null, kind: 'co2' | 'offline') {
  return one<{ threshold: number; enabled: boolean }>(
    `SELECT threshold, enabled FROM alert_rules
      WHERE house_id = $1 AND kind = $2 AND (room_id = $3 OR room_id IS NULL)
      ORDER BY room_id NULLS LAST LIMIT 1`,
    [houseId, kind, roomId],
    c,
  )
}

async function roomName(c: Db, roomId: string | null) {
  if (!roomId) return 'Unnamed device'
  return (await one<{ name: string }>('SELECT name FROM rooms WHERE id = $1', [roomId], c))?.name ?? 'Unnamed device'
}

async function notify(c: Db, eventId: number, houseId: string, deviceId: string, kind: string, subject: string, title: string, lines: string[]) {
  const recent = await one(
    `SELECT 1 FROM alert_events WHERE device_id = $1 AND kind = $2 AND notified_at > now() - make_interval(hours => $3) AND id <> $4`,
    [deviceId, kind, RENOTIFY_HOURS, eventId],
    c,
  )
  if (recent) return
  const members = await q<{ email: string }>(
    `SELECT u.email FROM house_members m JOIN users u ON u.id = m.user_id WHERE m.house_id = $1 AND u.password_hash IS NOT NULL`,
    [houseId],
    c,
  )
  for (const m of members) {
    await sendEmail(
      m.email,
      subject,
      title,
      [...lines.map((p) => ({ p })), { button: { label: 'Open dashboard', url: `${env.appUrl()}/app` } }, { small: 'Change alert settings in the portal under Alerts.' }],
      'alert',
    )
  }
  await q('UPDATE alert_events SET notified_at = now() WHERE id = $1', [eventId], c)
}

/** Called on every accepted upload with the newest reading. */
export async function evaluateCo2(c: Db, houseId: string, deviceId: string, roomId: string | null, co2: number) {
  const rule = await ruleFor(c, houseId, roomId, 'co2')
  const open = await one<{ id: number; threshold: number }>(
    `SELECT id, threshold FROM alert_events WHERE device_id = $1 AND kind = 'co2' AND resolved_at IS NULL`,
    [deviceId],
    c,
  )
  if (open) {
    if (!rule?.enabled || co2 < open.threshold - HYSTERESIS_PPM) {
      await q('UPDATE alert_events SET resolved_at = now() WHERE id = $1', [open.id], c)
    } else {
      await q('UPDATE alert_events SET value = greatest(value, $2) WHERE id = $1', [open.id, co2], c)
    }
    return
  }
  if (!rule?.enabled || co2 < rule.threshold) return
  const ev = await one<{ id: number }>(
    `INSERT INTO alert_events (house_id, device_id, room_id, kind, value, threshold) VALUES ($1,$2,$3,'co2',$4,$5) RETURNING id`,
    [houseId, deviceId, roomId, co2, rule.threshold],
    c,
  )
  const name = await roomName(c, roomId)
  await notify(c, ev!.id, houseId, deviceId, 'co2', `CO2 is high in ${name}`, `CO2 is ${co2} ppm in ${name}`, [
    `Your alert level is ${rule.threshold} ppm. Opening a window or door, or running ventilation, usually brings it down within minutes.`,
  ])
}

export async function resolveOffline(c: Db, deviceId: string) {
  await q(`UPDATE alert_events SET resolved_at = now() WHERE device_id = $1 AND kind = 'offline' AND resolved_at IS NULL`, [deviceId], c)
}

/** Cron: open "offline" alerts for devices that went quiet longer than their house rule. */
export async function checkOffline(c: Db): Promise<number> {
  const rows = await q<{ id: string; house_id: string; room_id: string | null; last_seen_at: Date; threshold: number }>(
    `SELECT d.id, d.house_id, d.room_id, d.last_seen_at, r.threshold
       FROM devices d
       JOIN LATERAL (
         SELECT threshold, enabled FROM alert_rules ar
          WHERE ar.house_id = d.house_id AND ar.kind = 'offline' AND (ar.room_id = d.room_id OR ar.room_id IS NULL)
          ORDER BY ar.room_id NULLS LAST LIMIT 1) r ON r.enabled
      WHERE d.status = 'assigned' AND d.last_seen_at IS NOT NULL
        AND d.last_seen_at < now() - make_interval(hours => r.threshold)
        AND NOT EXISTS (SELECT 1 FROM alert_events e WHERE e.device_id = d.id AND e.kind = 'offline' AND e.resolved_at IS NULL)`,
    [],
    c,
  )
  for (const d of rows) {
    const ev = await one<{ id: number }>(
      `INSERT INTO alert_events (house_id, device_id, room_id, kind, threshold) VALUES ($1,$2,$3,'offline',$4) RETURNING id`,
      [d.house_id, d.id, d.room_id, d.threshold],
      c,
    )
    const name = await roomName(c, d.room_id)
    await notify(c, ev!.id, d.house_id, d.id, 'offline', `${name} sensor is offline`, `${name} hasn't reported for ${d.threshold} hours`, [
      'This usually means the sensor lost power or WiFi. Check it is plugged in. If your WiFi name or password changed, hold the button on the back for 5 seconds to rejoin.',
    ])
  }
  return rows.length
}
