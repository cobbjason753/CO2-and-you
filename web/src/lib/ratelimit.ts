import { one } from './db'

/**
 * Fixed-window counter in Postgres. Returns true if the call is allowed.
 * Good enough for a proof of concept; swap for Redis/Upstash at scale.
 */
export async function rateLimit(key: string, max: number, windowSec: number): Promise<boolean> {
  const row = await one<{ count: number }>(
    `INSERT INTO rate_limits (key, window_start, count) VALUES ($1, now(), 1)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start < now() - make_interval(secs => $2) THEN 1 ELSE rate_limits.count + 1 END,
       window_start = CASE WHEN rate_limits.window_start < now() - make_interval(secs => $2) THEN now() ELSE rate_limits.window_start END
     RETURNING count`,
    [key, windowSec],
  )
  return (row?.count ?? 0) <= max
}
