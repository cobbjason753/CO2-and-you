import Link from 'next/link'
import { q } from '@/lib/db'
import { businessMetrics, fleetHealth } from '@/lib/metrics'
import { Card, PageHeader } from '@/components/ui'

export const metadata = { title: 'Admin' }

function Tile({ label, value, href, warn }: { label: string; value: React.ReactNode; href?: string; warn?: boolean }) {
  const body = (
    <div className={`rounded-2xl border bg-surface p-4 ${warn ? 'border-fair/60' : 'border-line'}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-3xl font-bold tabular">{value}</p>
    </div>
  )
  return href ? <Link href={href}>{body}</Link> : body
}

export default async function AdminHome() {
  const [m, f] = await Promise.all([businessMetrics(), fleetHealth()])
  const recent = await q<any>(`SELECT at, actor_email, action, target_type, target_id FROM audit_log ORDER BY at DESC LIMIT 12`)
  return (
    <div className="space-y-5">
      <PageHeader title="Overview" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Orders to ship" value={m.to_ship} href="/admin/packing" warn={m.to_ship > 0} />
        <Tile label="Units in stock" value={m.in_stock} href="/admin/provisioning" />
        <Tile label="Active subscriptions" value={m.active_subs} href="/admin/metrics" />
        <Tile label="Reporting (24 h)" value={`${m.reporting_24h}/${m.assigned}`} href="/admin/fleet" />
        <Tile label="Offline devices" value={f.offline.length} href="/admin/fleet#offline" warn={f.offline.length > 0} />
        <Tile label="Failing uploads" value={f.failing.length} href="/admin/fleet#failing" warn={f.failing.length > 0} />
        <Tile label="Unknown devices" value={f.unknown.length} href="/admin/fleet#unknown" warn={f.unknown.length > 0} />
        <Tile label="Open support" value={m.open_support} href="/admin/support" warn={m.open_support > 0} />
      </div>
      <Card title="Recent activity" action={<Link href="/admin/audit" className="text-sm text-brand">Audit log</Link>}>
        <ul className="divide-y divide-line text-sm">
          {recent.map((r, i) => (
            <li key={i} className="flex flex-wrap justify-between gap-2 py-2">
              <span>
                <b>{r.action}</b> {r.target_id && <span className="font-mono text-xs text-muted">{r.target_type}:{r.target_id}</span>}
              </span>
              <span className="text-xs text-muted">{r.actor_email ?? 'system'} · {new Date(r.at).toLocaleString('en-US')}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
