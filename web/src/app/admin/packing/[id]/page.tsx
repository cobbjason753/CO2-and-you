import { notFound } from 'next/navigation'
import { q, one } from '@/lib/db'
import { Card, PageHeader, Field, Input, Select, Badge, Notice } from '@/components/ui'
import { ActionForm } from '@/components/forms'
import { ScanBox } from '@/components/admin/scan-box'
import { scan, unscan, setOrderHouse, ship, cancelOrder } from '../../actions'

export const metadata = { title: 'Pack order' }

export default async function PackOrder({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  const o = await one<any>(`SELECT o.*, u.email AS owner_email, u.name AS owner_name FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE o.id = $1`, [id])
  if (!o) notFound()
  const units = await q<any>('SELECT device_id, scanned_at FROM order_units WHERE order_id = $1 ORDER BY scanned_at', [id])
  const houses = await q<any>(`SELECT h.id, h.name FROM house_members m JOIN houses h ON h.id = m.house_id WHERE m.user_id = $1 AND m.role = 'owner'`, [o.user_id])
  const complete = units.length === o.device_qty
  const s = o.ship_to ?? {}
  const open = o.status === 'paid'

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Order #${o.number}`}
        sub={<>{o.customer_name || o.email} · {o.device_qty} sensor{o.device_qty === 1 ? '' : 's'} · <Badge tone={open ? 'fair' : 'good'}>{o.status}</Badge>{o.is_gift && <> <Badge tone="brand">gift for {o.gift_email}</Badge></>}</>}
      />

      {open && !o.house_id && (
        <Card title="Which house?">
          <p className="mb-2 text-sm text-muted">{o.owner_email} has more than one house. They&apos;re being asked in the portal; you can also choose here.</p>
          <ActionForm action={setOrderHouse} submit="Set house" inline>
            <input type="hidden" name="order" value={id} />
            <Select name="house" className="w-auto">
              {houses.map((h: any) => <option key={h.id} value={h.id}>{h.name} ({h.id})</option>)}
            </Select>
          </ActionForm>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`Units ${units.length} of ${o.device_qty}`}>
          {open && o.house_id && !complete && <ScanBox action={scan} order={id} />}
          {complete && open && <Notice tone="ok">All units scanned. Print the label and mark shipped.</Notice>}
          <ul className="mt-3 divide-y divide-line">
            {units.map((u: any) => (
              <li key={u.device_id} className="flex items-center justify-between py-2">
                <span className="font-mono text-sm">{u.device_id}</span>
                {open && (
                  <ActionForm action={unscan} submit="Remove" kind="ghost" size="sm">
                    <input type="hidden" name="order" value={id} />
                    <input type="hidden" name="device" value={u.device_id} />
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Ship">
          {complete || !open ? (<div className="print-area rounded-lg border border-dashed border-line bg-white p-4 text-sm text-black">
            <p className="text-xs uppercase">Ship to</p>
            <p className="font-semibold">{s.name || (o.is_gift ? o.gift_name : o.customer_name) || o.email}</p>
            <p>{s.line1}</p>
            {s.line2 && <p>{s.line2}</p>}
            <p>{[s.city, s.state, s.postal_code].filter(Boolean).join(', ')}</p>
            <p className="mt-3 text-xs">Order #{o.number} · {o.device_qty} × CO2 &amp; You sensor{units.length ? ` · ${units.map((u: any) => u.device_id.slice(-6)).join(', ')}` : ''}</p>
          </div>) : (<p className="rounded-lg border border-dashed border-line p-4 text-sm text-muted">The shipping label unlocks when all {o.device_qty} units are scanned.</p>)}
          <p className="mt-2 text-xs text-muted">
            Packing slip / address label. Carrier labels with postage need a shipping account (e.g. Shippo or EasyPost, both have free test modes) — not connected yet.
          </p>
          {open && (
            <ActionForm action={ship} submit={complete ? 'Mark shipped & email customer' : `Scan ${o.device_qty - units.length} more to ship`} className="mt-3">
              <input type="hidden" name="order" value={id} />
              <Field label="Tracking number (optional)"><Input name="tracking" autoComplete="off" /></Field>
            </ActionForm>
          )}
          {o.status === 'shipped' && <p className="mt-3 text-sm">Shipped {new Date(o.shipped_at).toLocaleString('en-US')} {o.tracking && `· ${o.tracking}`}</p>}
        </Card>
      </div>

      {open && (
        <details className="text-sm">
          <summary className="cursor-pointer text-danger">Cancel order</summary>
          <div className="mt-2">
            <ActionForm action={cancelOrder} submit="Cancel order" kind="danger" size="sm" confirm="Cancel this order? Scanned units go back to stock.">
              <input type="hidden" name="order" value={id} />
            </ActionForm>
          </div>
        </details>
      )}
      <p className="text-xs text-muted">Owner account: {o.owner_name || ''} {o.owner_email} · House {o.house_id ?? '—'} · Source {o.source}{o.external_id ? ` (${o.external_id})` : ''}</p>
    </div>
  )
}
