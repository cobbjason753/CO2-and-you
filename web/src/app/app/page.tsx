import Link from 'next/link'
import { houseContext } from '@/lib/houses'
import { q } from '@/lib/db'
import { houseSeries } from '@/lib/readings'
import { subscriptionForHouse } from '@/lib/billing'
import { co2Band, fmtTemp, timeAgo, isOnline } from '@/lib/units'
import { Card, BandBadge, Badge, Empty, Notice, LinkButton, Field, Input, Select, bandText, cx } from '@/components/ui'
import { ActionForm } from '@/components/forms'
import { Sparkline } from '@/components/portal/sparkline'
import { nameDevice, chooseOrderHouse } from './actions'

export const metadata = { title: 'Home' }

type Dev = {
  id: string
  room_id: string | null
  room: string | null
  last_seen_at: Date | null
  last_co2: number | null
  last_temp_c: number | null
  last_humidity: number | null
  last_reading_at: Date | null
}

export default async function Dashboard() {
  const { user, house, houses } = await houseContext()

  const pendingOrders = await q<{ id: string; number: number; device_qty: number }>(
    `SELECT id, number, device_qty FROM orders WHERE user_id = $1 AND status = 'paid' AND house_id IS NULL`,
    [user.id],
  )
  const owned = houses.filter((h) => h.role === 'owner')
  const orderPrompt = pendingOrders.map((o) => (
    <Notice key={o.id} tone="warn">
      <p className="mb-2 font-medium">
        Which house should order #{o.number} ({o.device_qty} sensor{o.device_qty === 1 ? '' : 's'}) go to?
      </p>
      <ActionForm action={chooseOrderHouse} submit="Save" inline size="sm">
        <input type="hidden" name="order" value={o.id} />
        <Select name="house" className="w-auto">
          {owned.map((h) => (
            <option key={h.id} value={h.id}>{h.name}</option>
          ))}
        </Select>
      </ActionForm>
    </Notice>
  ))

  if (!house)
    return (
      <div className="space-y-4">
        {orderPrompt}
        <Empty title="No house yet">
          Your sensors appear here as soon as your order ships. Got a sensor as a gift? Ask the sender to forward the welcome email, or contact support.
        </Empty>
      </div>
    )

  const devices = await q<Dev>(
    `SELECT d.id, d.room_id, r.name AS room, d.last_seen_at, d.last_co2, d.last_temp_c, d.last_humidity, d.last_reading_at
       FROM devices d LEFT JOIN rooms r ON r.id = d.room_id
      WHERE d.house_id = $1 ORDER BY r.name NULLS FIRST, d.id`,
    [house.id],
  )
  const now = Date.now()
  const { series } = await houseSeries(house.id, new Date(now - 86400_000), new Date(now + 60_000))
  const spark = new Map(series.map((s) => [s.key, s.points.map((p) => ({ t: p.t, v: p.co2 }))]))
  const openAlerts = await q<{ device_id: string; kind: string }>(
    `SELECT device_id, kind FROM alert_events WHERE house_id = $1 AND resolved_at IS NULL`,
    [house.id],
  )
  const sub = await subscriptionForHouse(house.id)
  const lapsed = sub && !['active', 'trialing'].includes(sub.status)
  const isOwner = house.role === 'owner'

  const reporting = devices.filter((d) => d.last_co2 != null)
  const worst = reporting.reduce<Dev | null>((w, d) => (!w || (d.last_co2 ?? 0) > (w.last_co2 ?? 0) ? d : w), null)
  const unnamed = devices.filter((d) => !d.room_id)

  return (
    <div className="space-y-4">
      {orderPrompt}
      {lapsed && (
        <Notice tone="warn">
          Your subscription is <b>{sub!.status.replace('_', ' ')}</b>. Sensors keep reporting for now.{' '}
          <Link href="/app/account#billing" className="font-semibold underline">Update billing</Link>
        </Notice>
      )}

      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{house.name}</h1>
          <p className="text-sm text-muted">
            {devices.length} sensor{devices.length === 1 ? '' : 's'}
            {worst?.last_co2 != null && (
              <>
                {' · '}highest now: <span className={bandText[co2Band(worst.last_co2)!]}>{worst.last_co2} ppm</span> in {worst.room ?? 'an unnamed room'}
              </>
            )}
          </p>
        </div>
        <LinkButton href="/app/history" kind="secondary" size="sm">History</LinkButton>
      </div>

      {devices.length === 0 && (
        <Empty title="No sensors in this house yet">
          {isOwner ? (
            <>
              Sensors you order show up here once they ship. Have one already?{' '}
              <Link href="/app/devices#claim" className="font-semibold text-brand">Add it with its claim code</Link>.
            </>
          ) : (
            'The house owner can add sensors.'
          )}
        </Empty>
      )}

      {unnamed.length > 0 && isOwner && (
        <Card title="Name your new sensor" className="border-brand/40">
          <p className="mb-3 text-sm text-muted">Tell us which room each sensor is in. You can change it any time under Devices.</p>
          <div className="space-y-3">
            {unnamed.map((d) => (
              <ActionForm key={d.id} action={nameDevice} submit="Save" inline size="sm">
                <input type="hidden" name="device" value={d.id} />
                <div className="min-w-0 flex-1">
                  <Field label={`Sensor …${d.id.slice(-4)}${d.last_co2 != null ? ` · ${d.last_co2} ppm now` : ' · waiting for first reading'}`}>
                    <Input name="name" placeholder="e.g. Kitchen" list="room-suggestions" required maxLength={40} />
                  </Field>
                </div>
              </ActionForm>
            ))}
            <datalist id="room-suggestions">
              {['Living room', 'Kitchen', 'Bedroom', 'Kids room', 'Office', 'Basement', 'Nursery', 'Dining room'].map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {devices.map((d) => {
          const band = co2Band(d.last_co2)
          const online = isOnline(d.last_seen_at)
          const alert = openAlerts.find((a) => a.device_id === d.id)
          return (
            <Card key={d.id} className={cx(band === 'poor' && 'border-poor/50')}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="truncate font-semibold">{d.room ?? 'Unnamed device'}</h2>
                  <p className="text-xs text-muted">
                    {online ? `Updated ${timeAgo(d.last_reading_at ?? d.last_seen_at)}` : d.last_seen_at ? `Offline · last seen ${timeAgo(d.last_seen_at)}` : 'Waiting for first connection'}
                  </p>
                </div>
                {online ? <BandBadge ppm={d.last_co2} /> : <Badge>Offline</Badge>}
              </div>
              <div className="mt-3 flex items-baseline gap-1.5">
                <span className={cx('tabular text-4xl font-bold', band && online ? bandText[band] : 'text-muted')}>{d.last_co2 ?? '—'}</span>
                <span className="text-sm text-muted">ppm CO2</span>
              </div>
              <div className="mt-1 flex gap-4 text-sm text-muted tabular">
                <span>{fmtTemp(d.last_temp_c, user.temp_unit)}</span>
                <span>{d.last_humidity != null ? `${d.last_humidity.toFixed(0)}% humidity` : '—'}</span>
              </div>
              <div className="mt-3">
                <Sparkline points={spark.get(d.room_id ?? `device:${d.id}`) ?? []} />
              </div>
              {alert && (
                <p className="mt-2 text-xs font-semibold text-poor">{alert.kind === 'co2' ? 'Above your alert level' : 'Offline alert sent'}</p>
              )}
            </Card>
          )
        })}
      </div>

      {reporting.length > 0 && (
        <p className="text-xs text-muted">
          Good under 800 ppm · Fair 800–999 · Poor 1000+. <Link href="/app/help#co2" className="text-brand">What do these mean?</Link>
        </p>
      )}
    </div>
  )
}
