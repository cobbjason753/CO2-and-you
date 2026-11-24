import { pool, q } from '@/lib/db'
import { checkOffline } from '@/lib/alerts'
import { deliverOutbox } from '@/lib/email'
import { sendWeeklyReports } from '@/lib/reports'
import { sendDailyReports } from '@/lib/daily-report'
import { env } from '@/lib/env'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Housekeeping, safe to call as often as every few minutes:
 * offline alerts, email retries, weekly reports (Mondays from 13:00 UTC), cleanup.
 * Call with  Authorization: Bearer $CRON_SECRET  (Vercel Cron sends this automatically).
 */
export async function GET(req: Request) {
  const secret = env.cronSecret()
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return new Response('unauthorized', { status: 401 })
  const now = new Date()
  const offline = await checkOffline(pool())
  let reports = 0
  if (now.getUTCDay() === 1 && now.getUTCHours() >= 13) reports = await sendWeeklyReports(now)
  // Daily report: each house once a day, after 7 am in its own time zone.
  const daily = await sendDailyReports(now)
  const emails = await deliverOutbox()
  await q(`DELETE FROM sessions WHERE expires_at < now()`)
  await q(`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`)
  await q(`DELETE FROM tokens WHERE expires_at < now() - interval '7 days'`)
  return Response.json({ ok: true, offline, reports, daily, emails })
}
