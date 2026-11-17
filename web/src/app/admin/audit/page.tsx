import Link from 'next/link'
import { q } from '@/lib/db'
import { Card, PageHeader, Input, Table, buttonClass } from '@/components/ui'

export const metadata = { title: 'Audit log' }

const link = (t: string, id: string) => (t === 'device' ? `/admin/devices/${id}` : t === 'user' ? `/admin/customers/${id}` : t === 'order' ? `/admin/packing/${id}` : null)

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const term = ((await searchParams).q ?? '').trim()
  const rows = await q<any>(
    `SELECT * FROM audit_log WHERE $1 = '' OR action ILIKE '%' || $1 || '%' OR target_id ILIKE '%' || $1 || '%' OR actor_email ILIKE '%' || $1 || '%'
      ORDER BY at DESC LIMIT 200`,
    [term],
  )
  return (
    <div className="space-y-4">
      <PageHeader title="Audit log" sub="Every staff action and sensitive customer change." />
      <form className="flex gap-2"><Input name="q" defaultValue={term} placeholder="Filter by action, target or person" /><button className={buttonClass('secondary')}>Filter</button></form>
      <Card>
        <Table head={['When', 'Who', 'Action', 'Target', 'Details', 'IP']}>
          {rows.map((r) => {
            const href = r.target_type && link(r.target_type, r.target_id)
            return (
              <tr key={r.id} className="align-top">
                <td className="whitespace-nowrap text-xs">{new Date(r.at).toLocaleString('en-US')}</td>
                <td className="text-xs">{r.actor_email ?? 'system'}</td>
                <td className="font-medium">{r.action}</td>
                <td className="font-mono text-xs">{href ? <Link className="text-brand" href={href}>{r.target_id}</Link> : r.target_id}</td>
                <td className="max-w-72 break-all font-mono text-[11px] text-muted">{JSON.stringify(r.details)}</td>
                <td className="text-xs">{r.ip}</td>
              </tr>
            )
          })}
        </Table>
      </Card>
    </div>
  )
}
