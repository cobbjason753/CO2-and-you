import Link from 'next/link'
import { notFound } from 'next/navigation'
import { q, one } from '@/lib/db'
import { timeAgo, isOnline } from '@/lib/units'
import { Card, PageHeader, Table, Badge } from '@/components/ui'
import { ActionForm } from '@/components/forms'
import { resendWelcome } from '../../actions'

export const metadata = { title: 'Customer' }

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  const u = await one<any>('SELECT * FROM users WHERE id = $1', [id])
  if (!u) notFound()
  const houses = await q<any>(`SELECT h.*, m.role FROM house_members m JOIN houses h ON h.id = m.house_id WHERE m.user_id = $1`, [id])
  const houseIds = houses.map((h) => h.id)
  const devices = await q<any>(
    `SELECT d.*, r.name AS room FROM devices d LEFT JOIN rooms r ON r.id = d.room_id WHERE d.house_id = ANY($1) ORDER BY d.house_id, r.name`,
    [houseIds],
  )
  const members = await q<any>(`SELECT m.house_id, u.email, m.role FROM house_members m JOIN users u ON u.id = m.user_id WHERE m.house_id = ANY($1) AND m.user_id <> $2`, [houseIds, id])
  const subs = await q<any>('SELECT * FROM subscriptions WHERE user_id = $1 ORDER BY updated_at DESC', [id])
  const orders = await q<any>('SELECT * FROM orders WHERE user_id = $1 OR lower(email) = lower($2) ORDER BY created_at DESC', [id, u.email])
  const alerts = await q<any>(
    `SELECT e.*, r.name AS room FROM alert_events e LEFT JOIN rooms r ON r.id = e.room_id WHERE e.house_id = ANY($1) ORDER BY started_at DESC LIMIT 15`,
    [houseIds],
  )
  const support = await q<any>('SELECT id, subject, status, created_at FROM support_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10', [id])

  return (
    <div className="space-y-4">
      <PageHeader
        title={u.name || u.email}
        sub={<>{u.email} · {u.role} · joined {new Date(u.created_at).toLocaleDateString('en-US')} · last login {timeAgo(u.last_login_at)} · 2FA {u.totp_enabled ? 'on' : 'off'}{!u.password_hash && <> · <Badge tone="fair">hasn&apos;t set password</Badge></>}</>}
        action={
          <ActionForm action={resendWelcome} submit={u.password_hash ? 'Send password reset link' : 'Resend welcome link'} kind="secondary" size="sm">
            <input type="hidden" name="user" value={u.id} />
          </ActionForm>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Houses">
          {houses.map((h) => (
            <div key={h.id} className="mb-2 text-sm">
              <b>{h.name}</b> <span className="font-mono text-xs">{h.id}</span> · {h.role} · {h.timezone}
              <div className="text-xs text-muted">Other members: {members.filter((m) => m.house_id === h.id).map((m) => `${m.email} (${m.role})`).join(', ') || 'none'}</div>
            </div>
          ))}
          {!houses.length && <p className="text-sm text-muted">No houses.</p>}
        </Card>
        <Card title="Subscription">
          {subs.map((s) => (
            <p key={s.id} className="text-sm">
              <Badge tone={['active', 'trialing'].includes(s.status) ? 'good' : 'fair'}>{s.status}</Badge> {s.plan} · <span className="font-mono text-xs">{s.id}</span>
              {s.current_period_end && <> · until {new Date(s.current_period_end).toLocaleDateString('en-US')}</>}
            </p>
          ))}
          {!subs.length && <p className="text-sm text-muted">None.</p>}
          {u.stripe_customer_id && <p className="mt-2 text-xs text-muted">Stripe customer {u.stripe_customer_id}</p>}
        </Card>
      </div>
      <Card title="Devices">
        <Table head={['DEVICE_ID', 'House', 'Room', 'Status', 'FW', 'Last seen', 'CO2']}>
          {devices.map((d) => (
            <tr key={d.id}>
              <td><Link href={`/admin/devices/${d.id}`} className="font-mono text-xs text-brand">{d.id}</Link></td>
              <td className="font-mono text-xs">{d.house_id}</td>
              <td>{d.room ?? <span className="text-muted">unnamed</span>}</td>
              <td>{isOnline(d.last_seen_at) ? <Badge tone="good">online</Badge> : <Badge>offline</Badge>}</td>
              <td>{d.fw_version ?? '—'}</td>
              <td>{timeAgo(d.last_seen_at)}</td>
              <td>{d.last_co2 ?? '—'}</td>
            </tr>
          ))}
        </Table>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Orders">
          <ul className="divide-y divide-line text-sm">
            {orders.map((o) => (
              <li key={o.id} className="flex justify-between py-2">
                <Link href={`/admin/packing/${o.id}`} className="text-brand">#{o.number}</Link>
                <span>{o.device_qty} sensors · {o.status} · {new Date(o.created_at).toLocaleDateString('en-US')}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Recent alerts">
          <ul className="divide-y divide-line text-sm">
            {alerts.map((a) => (
              <li key={a.id} className="flex justify-between py-2">
                <span>{a.room ?? a.device_id} · {a.kind}{a.value ? ` ${Math.round(a.value)}` : ''}</span>
                <span className="text-xs text-muted">{new Date(a.started_at).toLocaleString('en-US')} {a.resolved_at ? '· resolved' : '· open'}</span>
              </li>
            ))}
            {!alerts.length && <li className="py-2 text-muted">None.</li>}
          </ul>
        </Card>
      </div>
      {support.length > 0 && (
        <Card title="Support requests">
          <ul className="text-sm">
            {support.map((s) => <li key={s.id}>#{s.id} {s.subject} · {s.status} · {new Date(s.created_at).toLocaleDateString('en-US')}</li>)}
          </ul>
        </Card>
      )}
    </div>
  )
}
