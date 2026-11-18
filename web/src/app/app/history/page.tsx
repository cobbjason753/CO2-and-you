import Link from 'next/link'
import { requireHouse } from '@/lib/houses'
import { houseSeries } from '@/lib/readings'
import { resolveRange, ymdIn } from '@/lib/time'
import { cToF } from '@/lib/units'
import { Card, PageHeader, Empty, Input, buttonClass, cx } from '@/components/ui'
import { HistoryChart, type ChartSeries } from '@/components/portal/history-chart'

export const metadata = { title: 'History' }

type SP = { range?: string; from?: string; to?: string; metric?: string; rooms?: string | string[] }

const METRICS = { co2: 'CO2', temp: 'Temperature', humidity: 'Humidity' } as const

export default async function HistoryPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams
  const { house, user } = await requireHouse()
  const { range, from, to } = resolveRange(sp, house.timezone)
  const metric = (sp.metric && sp.metric in METRICS ? sp.metric : 'co2') as keyof typeof METRICS
  const { series, bucket } = await houseSeries(house.id, from, to)
  const picked = sp.rooms ? new Set([sp.rooms].flat()) : null
  const shown = series.filter((s) => !picked || picked.has(s.key))

  const unit = metric === 'co2' ? 'ppm' : metric === 'humidity' ? '%' : `°${user.temp_unit}`
  const chart: ChartSeries[] = shown.map((s) => ({
    name: s.name,
    points: s.points.map((p) => [p.t, metric === 'co2' ? p.co2 : metric === 'humidity' ? p.humidity : user.temp_unit === 'F' ? cToF(p.temp_c) : p.temp_c]),
  }))

  const stats = shown.map((s) => {
    const vals = s.points.map((p) => p.co2)
    const avg = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null
    return { name: s.name, avg, max: vals.length ? Math.max(...vals) : null }
  })

  const qs = (patch: Partial<SP>) => {
    const p = new URLSearchParams()
    const merged = { ...sp, ...patch }
    for (const [k, v] of Object.entries(merged)) for (const x of [v ?? []].flat()) if (x) p.append(k, String(x))
    return `?${p.toString()}`
  }
  const fromYmd = ymdIn(from, house.timezone)
  const toYmd = ymdIn(new Date(to.getTime() - 61_000), house.timezone)
  const exportHref = `/app/history/export?from=${fromYmd}&to=${toYmd}`

  return (
    <div className="space-y-4">
      <PageHeader
        title="History"
        sub={`${house.name} · averaged every ${bucket} · times in ${house.timezone.replace('_', ' ')}`}
        action={
          <a href={exportHref} className={buttonClass('secondary', 'sm')} download>
            Export CSV
          </a>
        }
      />

      <div className="flex flex-wrap gap-2">
        {(['day', 'week', 'month'] as const).map((r) => (
          <Link key={r} href={qs({ range: r, from: undefined, to: undefined })} className={cx(buttonClass(range === r ? 'primary' : 'secondary', 'sm'))}>
            {r === 'day' ? '24 hours' : r === 'week' ? '7 days' : '30 days'}
          </Link>
        ))}
        <details className="group" open={range === 'custom'}>
          <summary className={cx(buttonClass(range === 'custom' ? 'primary' : 'secondary', 'sm'), 'cursor-pointer list-none')}>Custom</summary>
          <form className="mt-2 flex flex-wrap items-end gap-2 rounded-xl border border-line bg-surface p-3">
            <input type="hidden" name="range" value="custom" />
            <input type="hidden" name="metric" value={metric} />
            <label className="text-sm">
              From <Input type="date" name="from" defaultValue={fromYmd} required />
            </label>
            <label className="text-sm">
              To <Input type="date" name="to" defaultValue={toYmd} required />
            </label>
            <button className={buttonClass('primary', 'sm')}>Show</button>
          </form>
        </details>
      </div>

      <div className="flex gap-1 rounded-xl border border-line bg-surface p-1 text-sm" role="tablist">
        {Object.entries(METRICS).map(([k, label]) => (
          <Link key={k} href={qs({ metric: k })} role="tab" aria-selected={metric === k} className={cx('flex-1 rounded-lg px-3 py-2 text-center font-medium', metric === k ? 'bg-brand-soft text-brand' : 'text-muted')}>
            {label}
          </Link>
        ))}
      </div>

      {series.length === 0 ? (
        <Empty title="No readings in this period">Sensors upload every 5 minutes once they&apos;re on WiFi.</Empty>
      ) : (
        <Card>
          <HistoryChart series={chart} unit={unit} tz={house.timezone} refLine={metric === 'co2' ? 1000 : undefined} />
          <form className="mt-4 border-t border-line pt-3">
            <input type="hidden" name="range" value={range} />
            <input type="hidden" name="metric" value={metric} />
            {range === 'custom' && (
              <>
                <input type="hidden" name="from" value={fromYmd} />
                <input type="hidden" name="to" value={toYmd} />
              </>
            )}
            <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Rooms on chart</legend>
              {series.map((s) => (
                <label key={s.key} className="flex items-center gap-1.5">
                  <input type="checkbox" name="rooms" value={s.key} defaultChecked={!picked || picked.has(s.key)} className="size-4 accent-[var(--brand)]" />
                  {s.name}
                </label>
              ))}
              <button className={buttonClass('secondary', 'sm')}>Update</button>
            </fieldset>
          </form>
        </Card>
      )}

      {stats.length > 0 && (
        <Card title="CO2 in this period">
          <ul className="divide-y divide-line text-sm">
            {stats.map((s) => (
              <li key={s.name} className="flex justify-between py-2 tabular">
                <span>{s.name}</span>
                <span className="text-muted">
                  avg <b className="text-ink">{s.avg ?? '—'}</b> · peak <b className="text-ink">{s.max ?? '—'}</b> ppm
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
