import { requireHouse } from '@/lib/houses'
import { houseReport } from '@/lib/daily-report'

export const dynamic = 'force-dynamic'

/** The daily report for the current house as of now, exactly as it would be emailed. */
export async function GET() {
  const { house, user } = await requireHouse()
  const r = await houseReport(house.id, new Date(), user.temp_unit)
  return new Response(r.html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
}
