import { businessMetrics, shippedByMonth } from '@/lib/metrics'
import { Card, PageHeader } from '@/components/ui'

export const metadata = { title: 'Metrics' }

export default async function MetricsPage() {
  const [m, months] = await Promise.all([businessMetrics(), shippedByMonth()])
  const tiles = [
    ['Active subscriptions', m.active_subs],
    ['Past due', m.past_due],
    ['Churn (30 days)', `${m.churn_30d}%`],
    ['Cancelled (30 days)', m.canceled_30d],
    ['Devices shipped (all time)', m.shipped_total],
    ['Shipped (30 days)', m.shipped_30d],
    ['Devices reporting (24 h)', `${m.reporting_24h} of ${m.assigned}`],
    ['Customers / houses', `${m.customers} / ${m.houses}`],
  ]
  const max = Math.max(1, ...months.map((x) => x.n))
  return (
    <div className="space-y-4">
      <PageHeader title="Business metrics" sub="Churn = subscriptions cancelled in the last 30 days ÷ (active + those cancelled)." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map(([l, v]) => (
          <div key={l as string} className="rounded-2xl border border-line bg-surface p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">{l}</p>
            <p className="mt-1 text-2xl font-bold tabular">{v}</p>
          </div>
        ))}
      </div>
      <Card title="Devices shipped per month">
        {months.length === 0 ? <p className="text-sm text-muted">Nothing shipped yet.</p> : (
          <ul className="space-y-1.5">
            {months.map((x) => (
              <li key={x.month} className="flex items-center gap-3 text-sm">
                <span className="w-20 shrink-0 text-muted">{x.month}</span>
                <span className="h-5 rounded bg-brand" style={{ width: `${(x.n / max) * 100}%`, minWidth: 4 }} />
                <span className="tabular">{x.n}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
