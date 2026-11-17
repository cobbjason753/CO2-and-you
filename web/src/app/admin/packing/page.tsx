import Link from 'next/link'
import { q } from '@/lib/db'
import { Card, PageHeader, Table, Badge, Empty, LinkButton } from '@/components/ui'

export const metadata = { title: 'Packing' }

export default async function PackingPage() {
  const orders = await q<any>(
    `SELECT o.*, (SELECT count(*)::int FROM order_units u WHERE u.order_id = o.id) AS scanned
       FROM orders o WHERE o.status = 'paid' ORDER BY o.created_at`,
  )
  const shipped = await q<any>(`SELECT id, number, email, device_qty, shipped_at, tracking FROM orders WHERE status = 'shipped' ORDER BY shipped_at DESC LIMIT 15`)
  return (
    <div className="space-y-5">
      <PageHeader title="Packing station" sub="Paid orders waiting to ship, oldest first." action={<LinkButton href="/admin/packing/new" kind="secondary" size="sm">New manual order</LinkButton>} />
      {orders.length === 0 ? (
        <Empty title="Nothing to pack" />
      ) : (
        <Card>
          <Table head={['Order', 'Customer', 'Sensors', 'Scanned', 'House', 'Placed']}>
            {orders.map((o) => (
              <tr key={o.id}>
                <td><Link href={`/admin/packing/${o.id}`} className="font-semibold text-brand">#{o.number}</Link>{o.is_gift && <> <Badge tone="brand">gift</Badge></>}</td>
                <td>{o.customer_name || o.email}<div className="text-xs text-muted">{o.email}</div></td>
                <td>{o.device_qty}</td>
                <td>{o.scanned === o.device_qty ? <Badge tone="good">{o.scanned}/{o.device_qty}</Badge> : <Badge tone="fair">{o.scanned}/{o.device_qty}</Badge>}</td>
                <td>{o.house_id ? <span className="font-mono text-xs">{o.house_id}</span> : <Badge tone="poor">choose</Badge>}</td>
                <td className="text-xs">{new Date(o.created_at).toLocaleString('en-US')}</td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
      <Card title="Recently shipped">
        <Table head={['Order', 'Customer', 'Sensors', 'Shipped', 'Tracking']}>
          {shipped.map((o) => (
            <tr key={o.id}>
              <td><Link href={`/admin/packing/${o.id}`} className="text-brand">#{o.number}</Link></td>
              <td>{o.email}</td>
              <td>{o.device_qty}</td>
              <td className="text-xs">{new Date(o.shipped_at).toLocaleString('en-US')}</td>
              <td className="font-mono text-xs">{o.tracking ?? '—'}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  )
}
