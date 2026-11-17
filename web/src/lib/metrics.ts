import { q, one } from './db'

export async function businessMetrics() {
  const m = await one<any>(`
    SELECT
      (SELECT count(*) FROM subscriptions WHERE status IN ('active','trialing'))::int AS active_subs,
      (SELECT count(*) FROM subscriptions WHERE status = 'past_due')::int AS past_due,
      (SELECT count(*) FROM subscriptions WHERE canceled_at > now() - interval '30 days')::int AS canceled_30d,
      (SELECT count(*) FROM order_units u JOIN orders o ON o.id = u.order_id WHERE o.status = 'shipped')::int AS shipped_total,
      (SELECT count(*) FROM order_units u JOIN orders o ON o.id = u.order_id WHERE o.status = 'shipped' AND o.shipped_at > now() - interval '30 days')::int AS shipped_30d,
      (SELECT count(*) FROM devices WHERE status = 'assigned')::int AS assigned,
      (SELECT count(*) FROM devices WHERE last_seen_at > now() - interval '24 hours')::int AS reporting_24h,
      (SELECT count(*) FROM devices WHERE status = 'in_stock' AND test_result = 'pass')::int AS in_stock,
      (SELECT count(*) FROM orders WHERE status = 'paid')::int AS to_ship,
      (SELECT count(*) FROM houses)::int AS houses,
      (SELECT count(*) FROM users WHERE role = 'customer')::int AS customers,
      (SELECT count(*) FROM support_requests WHERE status = 'open')::int AS open_support
  `)
  const churn = m.active_subs + m.canceled_30d > 0 ? (m.canceled_30d / (m.active_subs + m.canceled_30d)) * 100 : 0
  return { ...m, churn_30d: Math.round(churn * 10) / 10 }
}

export async function shippedByMonth() {
  return q<{ month: string; n: number }>(`
    SELECT to_char(date_trunc('month', o.shipped_at), 'Mon YYYY') AS month, count(u.*)::int AS n
      FROM orders o JOIN order_units u ON u.order_id = o.id
     WHERE o.status = 'shipped' AND o.shipped_at > now() - interval '12 months'
     GROUP BY date_trunc('month', o.shipped_at) ORDER BY date_trunc('month', o.shipped_at)`)
}

export async function fleetHealth() {
  const latest = await one<{ v: number | null }>(`SELECT max(version) AS v FROM firmware_releases WHERE stage = 'general'`)
  const base = `SELECT d.id, d.house_id, d.status, d.fw_version, d.last_seen_at, d.last_rssi, d.ingest_errors, d.last_error, d.last_error_at, r.name AS room
                  FROM devices d LEFT JOIN rooms r ON r.id = d.room_id`
  const [offline, failing, outdated, weak, unknown, unclaimed] = await Promise.all([
    q(`${base} WHERE d.status = 'assigned' AND (d.last_seen_at IS NULL OR d.last_seen_at < now() - interval '1 hour') ORDER BY d.last_seen_at NULLS FIRST LIMIT 200`),
    q(`${base} WHERE d.ingest_errors > 0 AND d.last_error_at > now() - interval '24 hours' ORDER BY d.ingest_errors DESC LIMIT 200`),
    latest?.v ? q(`${base} WHERE d.status = 'assigned' AND coalesce(d.fw_version, 0) < $1 ORDER BY d.fw_version NULLS FIRST LIMIT 200`, [latest.v]) : Promise.resolve([]),
    q(`${base} WHERE d.status = 'assigned' AND d.last_rssi < -80 AND d.last_seen_at > now() - interval '1 day' ORDER BY d.last_rssi LIMIT 200`),
    q(`SELECT * FROM unknown_devices ORDER BY last_seen_at DESC LIMIT 200`),
    q(`${base} WHERE d.house_id IS NULL AND d.last_seen_at > now() - interval '7 days' ORDER BY d.last_seen_at DESC LIMIT 200`),
  ])
  return { latest: latest?.v ?? null, offline, failing, outdated, weak, unknown, unclaimed }
}
