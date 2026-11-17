import Link from 'next/link'
import { redirect } from 'next/navigation'
import { q, one } from '@/lib/db'
import { normalizeDeviceId } from '@/lib/devices'
import { Card, PageHeader, Input, Table, buttonClass } from '@/components/ui'

export const metadata = { title: 'Customers' }

/** Search by email, order number, HOUSE_ID or DEVICE_ID. Exact device / house hits jump straight there. */
export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const term = ((await searchParams).q ?? '').trim()
  let users: any[] = []
  if (term) {
    const dev = await one<{ id: string; house_id: string | null }>('SELECT id, house_id FROM devices WHERE id = $1', [normalizeDeviceId(term)])
    if (dev) redirect(`/admin/devices/${dev.id}`)
    const num = /^#?\d+$/.test(term) ? parseInt(term.replace('#', ''), 10) : -1
    users = await q(
      `SELECT DISTINCT u.id, u.email, u.name, u.role, u.created_at,
              (SELECT string_agg(h.name || ' (' || h.id || ')', ', ') FROM house_members m JOIN houses h ON h.id = m.house_id WHERE m.user_id = u.id) AS houses
         FROM users u
         LEFT JOIN house_members m ON m.user_id = u.id
         LEFT JOIN orders o ON o.user_id = u.id OR lower(o.email) = lower(u.email)
        WHERE u.email ILIKE '%' || $1 || '%' OR u.name ILIKE '%' || $1 || '%' OR upper(m.house_id) = upper($1) OR o.number = $2 OR o.external_id = $1
        ORDER BY u.created_at DESC LIMIT 50`,
      [term, num],
    )
    if (users.length === 1) redirect(`/admin/customers/${users[0].id}`)
  } else {
    users = await q(`SELECT u.id, u.email, u.name, u.role, u.created_at,
      (SELECT string_agg(h.name || ' (' || h.id || ')', ', ') FROM house_members m JOIN houses h ON h.id = m.house_id WHERE m.user_id = u.id) AS houses
      FROM users u ORDER BY created_at DESC LIMIT 25`)
  }
  return (
    <div className="space-y-4">
      <PageHeader title="Customer lookup" />
      <form className="flex gap-2">
        <Input name="q" defaultValue={term} placeholder="Email, name, order #, HOUSE_ID or DEVICE_ID" autoFocus />
        <button className={buttonClass('primary')}>Search</button>
      </form>
      <Card title={term ? `Results for “${term}”` : 'Newest accounts'}>
        <Table head={['Email', 'Name', 'Role', 'Houses', 'Created']}>
          {users.map((u) => (
            <tr key={u.id}>
              <td><Link href={`/admin/customers/${u.id}`} className="text-brand">{u.email}</Link></td>
              <td>{u.name}</td>
              <td>{u.role}</td>
              <td className="text-xs">{u.houses ?? '—'}</td>
              <td className="text-xs">{new Date(u.created_at).toLocaleDateString('en-US')}</td>
            </tr>
          ))}
        </Table>
        {users.length === 0 && <p className="py-4 text-sm text-muted">No matches.</p>}
      </Card>
    </div>
  )
}
