import { q, type Db } from './db'

export type SeriesPoint = { t: number; co2: number; temp_c: number; humidity: number }
export type Series = { key: string; name: string; points: SeriesPoint[] }

/** Bucket size that keeps a chart under ~600 points per room. */
export function bucketFor(fromMs: number, toMs: number): { label: string; seconds: number } {
  const days = (toMs - fromMs) / 86400_000
  if (days <= 2) return { label: '5 min', seconds: 300 }
  if (days <= 8) return { label: '30 min', seconds: 1800 }
  if (days <= 35) return { label: '2 h', seconds: 7200 }
  if (days <= 100) return { label: '6 h', seconds: 21600 }
  return { label: '1 day', seconds: 86400 }
}

/**
 * One series per room for a house (devices not in a room appear by themselves).
 * Grouping is by the room the reading was recorded in, so moving a device later
 * doesn't rewrite history.
 */
export async function houseSeries(houseId: string, from: Date, to: Date, c?: Db): Promise<{ series: Series[]; bucket: string }> {
  const b = bucketFor(from.getTime(), to.getTime())
  const rows = await q<{ key: string; t: Date; co2: number; temp_c: number; humidity: number }>(
    `SELECT coalesce(r.room_id::text, 'device:' || r.device_id) AS key,
            date_bin(make_interval(secs => $4), r.time, timestamptz '2000-01-01') AS t,
            round(avg(r.co2))::int AS co2, avg(r.temp_c)::real AS temp_c, avg(r.humidity)::real AS humidity
       FROM readings r
      WHERE r.house_id = $1 AND r.time >= $2 AND r.time < $3
      GROUP BY 1, 2 ORDER BY 2`,
    [houseId, from, to, b.seconds],
    c,
  )
  const names = await seriesNames(houseId, c)
  const map = new Map<string, Series>()
  for (const r of rows) {
    let s = map.get(r.key)
    if (!s) map.set(r.key, (s = { key: r.key, name: names.get(r.key) ?? 'Unnamed device', points: [] }))
    s.points.push({ t: new Date(r.t).getTime(), co2: r.co2, temp_c: r.temp_c, humidity: r.humidity })
  }
  return { series: [...map.values()].sort((a, b) => a.name.localeCompare(b.name)), bucket: b.label }
}

async function seriesNames(houseId: string, c?: Db) {
  const rooms = await q<{ id: string; name: string }>('SELECT id, name FROM rooms WHERE house_id = $1', [houseId], c)
  const m = new Map(rooms.map((r) => [r.id, r.name]))
  const devs = await q<{ device_id: string }>('SELECT DISTINCT device_id FROM readings WHERE house_id = $1 AND room_id IS NULL', [houseId], c)
  for (const d of devs) m.set('device:' + d.device_id, `Unnamed (…${d.device_id.slice(-4)})`)
  return m
}

/** Raw readings for CSV export, in the house's time zone. */
export async function exportRows(houseId: string, from: Date, to: Date, tz: string, c?: Db) {
  return q<{ local_time: string; room: string; device_id: string; co2: number; temp_c: number; humidity: number }>(
    `SELECT to_char(r.time AT TIME ZONE $4, 'YYYY-MM-DD HH24:MI:SS') AS local_time,
            coalesce(rm.name, 'Unnamed') AS room, r.device_id, r.co2, r.temp_c, r.humidity
       FROM readings r LEFT JOIN rooms rm ON rm.id = r.room_id
      WHERE r.house_id = $1 AND r.time >= $2 AND r.time < $3
      ORDER BY r.time, room`,
    [houseId, from, to, tz],
    c,
  )
}

export function toCsv(header: string[], rows: (string | number | null)[][]): string {
  const cell = (v: string | number | null) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\n') + '\n'
}
