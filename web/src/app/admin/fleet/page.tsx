import Link from 'next/link'
import { fleetHealth } from '@/lib/metrics'
import { timeAgo } from '@/lib/units'
import { Card, PageHeader, Table } from '@/components/ui'

export const metadata = { title: 'Fleet health' }

function DevTable({ rows, extra }: { rows: any[]; extra?: (d: any) => React.ReactNode }) {
  if (!rows.length) return <p className="text-sm text-muted">None 🎉</p>
  return (
    <Table head={['DEVICE_ID', 'House', 'Room', 'FW', 'RSSI', 'Last seen', '']}>
      {rows.map((d) => (
        <tr key={d.id}>
          <td><Link href={`/admin/devices/${d.id}`} className="font-mono text-xs text-brand">{d.id}</Link></td>
          <td className="font-mono text-xs">{d.house_id ?? '—'}</td>
          <td>{d.room ?? '—'}</td>
          <td>{d.fw_version ?? '—'}</td>
          <td>{d.last_rssi ?? '—'}</td>
          <td>{timeAgo(d.last_seen_at)}</td>
          <td className="text-xs">{extra?.(d)}</td>
        </tr>
      ))}
    </Table>
  )
}

export default async function FleetPage() {
  const f = await fleetHealth()
  return (
    <div className="space-y-4">
      <PageHeader title="Fleet health" sub={`Latest general firmware: ${f.latest ? `v${f.latest}` : 'none released'}`} />
      <Card title={`Offline > 1 hour (${f.offline.length})`} className="scroll-mt-24"><div id="offline" /><DevTable rows={f.offline} /></Card>
      <Card title={`Failing uploads, last 24 h (${f.failing.length})`} className="scroll-mt-24"><div id="failing" /><DevTable rows={f.failing} extra={(d) => `${d.ingest_errors}× ${d.last_error}`} /></Card>
      <Card title={`Outdated firmware (${f.outdated.length})`}><DevTable rows={f.outdated} /></Card>
      <Card title={`Weak signal, below -80 dBm (${f.weak.length})`}><DevTable rows={f.weak} /></Card>
      <Card title={`Unclaimed but reporting (${f.unclaimed.length})`}><p className="mb-2 text-xs text-muted">Gifts, retail units or packing mistakes. Their readings aren&apos;t stored until claimed.</p><DevTable rows={f.unclaimed} /></Card>
      <Card title={`Unknown devices (${f.unknown.length})`} className="scroll-mt-24">
        <div id="unknown" />
        <Table head={['DEVICE_ID', 'FW', 'Attempts', 'Last IP', 'Last seen', '']}>
          {f.unknown.map((u: any) => (
            <tr key={u.device_id}>
              <td className="font-mono text-xs">{u.device_id}</td><td>{u.fw_version ?? '—'}</td><td>{u.attempts}</td><td className="text-xs">{u.last_ip}</td><td>{timeAgo(u.last_seen_at)}</td>
              <td><Link href={`/admin/provisioning?ids=${u.device_id}`} className="text-brand">Register</Link></td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  )
}
