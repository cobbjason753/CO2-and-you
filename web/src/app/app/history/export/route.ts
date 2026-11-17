import { requireHouse } from '@/lib/houses'
import { exportRows, toCsv } from '@/lib/readings'
import { zonedMidnight } from '@/lib/time'
import { cToF } from '@/lib/units'

export const dynamic = 'force-dynamic'

/** CSV of every reading in the range (house time zone), for the current house only. */
export async function GET(req: Request) {
  const { house, user } = await requireHouse()
  const url = new URL(req.url)
  const from = zonedMidnight(url.searchParams.get('from') ?? '', house.timezone)
  const toStart = zonedMidnight(url.searchParams.get('to') ?? '', house.timezone)
  if (!from || !toStart || toStart < from || toStart.getTime() - from.getTime() > 400 * 86400_000)
    return new Response('Choose a valid date range (up to 400 days).', { status: 400 })
  const rows = await exportRows(house.id, from, new Date(toStart.getTime() + 86400_000), house.timezone)
  const f = user.temp_unit === 'F'
  const csv = toCsv(
    ['local_time', 'room', 'device_id', 'co2_ppm', f ? 'temp_f' : 'temp_c', 'humidity_pct'],
    rows.map((r) => [r.local_time, r.room, r.device_id, r.co2, (f ? cToF(r.temp_c) : r.temp_c).toFixed(1), r.humidity.toFixed(1)]),
  )
  const name = `${house.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${url.searchParams.get('from')}-to-${url.searchParams.get('to')}.csv`
  return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"` } })
}
