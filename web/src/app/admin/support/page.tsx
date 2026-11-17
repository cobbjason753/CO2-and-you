import Link from 'next/link'
import { q } from '@/lib/db'
import { Card, PageHeader, Badge, Empty } from '@/components/ui'
import { ActionForm } from '@/components/forms'
import { closeSupport } from '../actions'

export const metadata = { title: 'Support' }

export default async function SupportPage() {
  const rows = await q<any>(`SELECT * FROM support_requests ORDER BY (status = 'open') DESC, created_at DESC LIMIT 100`)
  return (
    <div className="space-y-4">
      <PageHeader title="Support requests" sub="Also emailed to the support address. Reply by email; mark closed here." />
      {rows.length === 0 && <Empty title="No requests" />}
      {rows.map((r) => (
        <Card key={r.id} title={<>#{r.id} {r.subject} <Badge tone={r.status === 'open' ? 'fair' : 'neutral'}>{r.status}</Badge></>}
          action={<ActionForm action={closeSupport} submit={r.status === 'open' ? 'Close' : 'Reopen'} kind="secondary" size="sm"><input type="hidden" name="id" value={r.id} /></ActionForm>}>
          <p className="text-xs text-muted">{r.user_id ? <Link className="text-brand" href={`/admin/customers/${r.user_id}`}>{r.email}</Link> : r.email} · {new Date(r.created_at).toLocaleString('en-US')} · house {r.house_id}</p>
          <p className="mt-2 whitespace-pre-wrap text-sm">{r.body}</p>
          <details className="mt-2 text-xs"><summary className="cursor-pointer text-muted">Attached house &amp; device info</summary><pre className="mt-1 overflow-x-auto rounded bg-surface-2 p-2">{JSON.stringify(r.context, null, 2)}</pre></details>
        </Card>
      ))}
    </div>
  )
}
