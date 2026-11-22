import { requireHouse } from '@/lib/houses'
import { q } from '@/lib/db'
import { Card, PageHeader, Field, Input, Select, Badge, Empty, Notice } from '@/components/ui'
import { ActionForm } from '@/components/forms'
import { saveAlerts, saveRoomAlert } from '../actions'

export const metadata = { title: 'Alerts' }

const fmt = (d: Date, tz: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d)

export default async function AlertsPage() {
  const { house } = await requireHouse()
  const isOwner = house.role === 'owner'
  const rules = await q<{ kind: string; room_id: string | null; threshold: number; enabled: boolean; room: string | null }>(
    `SELECT a.kind, a.room_id, a.threshold, a.enabled, r.name AS room FROM alert_rules a LEFT JOIN rooms r ON r.id = a.room_id WHERE a.house_id = $1`,
    [house.id],
  )
  const co2 = rules.find((r) => r.kind === 'co2' && !r.room_id)
  const offline = rules.find((r) => r.kind === 'offline' && !r.room_id)
  const rooms = await q<{ id: string; name: string }>('SELECT id, name FROM rooms WHERE house_id = $1 ORDER BY name', [house.id])
  const overrides = new Map(rules.filter((r) => r.room_id && r.kind === 'co2').map((r) => [r.room_id!, r.threshold]))
  const events = await q<any>(
    `SELECT e.*, coalesce(r.name, 'Unnamed device') AS room FROM alert_events e LEFT JOIN rooms r ON r.id = e.room_id
      WHERE e.house_id = $1 ORDER BY e.started_at DESC LIMIT 30`,
    [house.id],
  )

  return (
    <div className="space-y-4">
      <PageHeader title="Alerts" sub={<>We email everyone in the household, and send a notification to phones with the app installed and notifications on (<a href="/app/account#app" className="text-brand">set up</a>).</>} />
      {!isOwner && <Notice>Only house owners can change alert settings.</Notice>}

      <Card title="House settings">
        <ActionForm action={saveAlerts} submit="Save alerts">
          <fieldset disabled={!isOwner} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="flex items-center gap-2 font-medium">
                  <input type="checkbox" name="co2_on" defaultChecked={co2?.enabled ?? true} className="size-4 accent-[var(--brand)]" /> High CO2
                </label>
                <Field label="Alert when CO2 reaches (ppm)" hint="1000–1400 suits most homes. Outdoor air is about 420.">
                  <Input name="co2" type="number" min={600} max={5000} step={50} defaultValue={co2?.threshold ?? 1200} required />
                </Field>
              </div>
              <div className="space-y-2">
                <label className="flex items-center gap-2 font-medium">
                  <input type="checkbox" name="offline_on" defaultChecked={offline?.enabled ?? true} className="size-4 accent-[var(--brand)]" /> Sensor offline
                </label>
                <Field label="Alert when a sensor is silent for (hours)">
                  <Input name="offline" type="number" min={1} max={72} defaultValue={offline?.threshold ?? 6} required />
                </Field>
              </div>
            </div>
          </fieldset>
        </ActionForm>
      </Card>

      {rooms.length > 0 && (
        <Card title="Room-by-room CO2 level">
          <p className="mb-3 text-sm text-muted">Optional. Leave blank to use the house setting ({co2?.threshold ?? 1200} ppm). Bedrooms often warrant a lower level.</p>
          <ul className="divide-y divide-line">
            {rooms.map((r) => (
              <li key={r.id} className="py-2">
                <ActionForm action={saveRoomAlert} submit="Save" inline size="sm">
                  <input type="hidden" name="room" value={r.id} />
                  <span className="w-32 shrink-0 self-center font-medium">{r.name}</span>
                  <div className="w-40">
                    <Input name="co2" type="number" min={600} max={5000} step={50} defaultValue={overrides.get(r.id) ?? ''} placeholder={`${co2?.threshold ?? 1200} (house)`} disabled={!isOwner} aria-label={`${r.name} CO2 alert level`} />
                  </div>
                </ActionForm>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Recent alerts">
        {events.length === 0 ? (
          <Empty title="No alerts yet" />
        ) : (
          <ul className="divide-y divide-line text-sm">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span>
                  <b>{e.room}</b> — {e.kind === 'co2' ? `CO2 reached ${Math.round(e.value)} ppm (level ${e.threshold})` : `offline for ${e.threshold}+ hours`}
                </span>
                <span className="flex items-center gap-2 text-xs text-muted">
                  {fmt(e.started_at, house.timezone)}
                  {e.resolved_at ? <Badge tone="good">Resolved</Badge> : <Badge tone="poor">Ongoing</Badge>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
