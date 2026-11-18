import { requireHouse } from '@/lib/houses'
import { q } from '@/lib/db'
import { timeAgo, isOnline, signalBars } from '@/lib/units'
import { Card, PageHeader, Field, Input, Select, Badge, SignalBars, Notice, Empty } from '@/components/ui'
import { ActionForm } from '@/components/forms'
import { ToggleSwitch } from '@/components/portal/toggle'
import { nameDevice, moveDevice, removeDevice, claim, renameRoom, deleteRoom, setDisplay } from '../actions'

export const metadata = { title: 'Devices' }

export default async function DevicesPage({ searchParams }: { searchParams: Promise<{ code?: string; claimed?: string }> }) {
  const sp = await searchParams
  const { house } = await requireHouse()
  const isOwner = house.role === 'owner'
  const devices = await q<any>(
    `SELECT d.id, d.room_id, r.name AS room, d.fw_version, d.last_rssi, d.last_seen_at, d.assigned_at, d.display_on
       FROM devices d LEFT JOIN rooms r ON r.id = d.room_id
      WHERE d.house_id = $1 ORDER BY r.name NULLS FIRST, d.id`,
    [house.id],
  )
  const rooms = await q<{ id: string; name: string; n: number }>(
    `SELECT r.id, r.name, count(d.id)::int AS n FROM rooms r LEFT JOIN devices d ON d.room_id = r.id
      WHERE r.house_id = $1 GROUP BY r.id ORDER BY r.name`,
    [house.id],
  )

  return (
    <div className="space-y-4">
      <PageHeader title="Devices" sub={`Sensors in ${house.name}`} />
      {sp.claimed && <Notice tone="ok">Sensor added. Give it a room name below.</Notice>}
      {!isOwner && <Notice>You&apos;re a viewer in this house, so you can see devices but not change them.</Notice>}

      {devices.length === 0 && <Empty title="No sensors yet">Add one below with the claim code on its label.</Empty>}

      <div className="space-y-3">
        {devices.map((d) => {
          const online = isOnline(d.last_seen_at)
          return (
            <Card key={d.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold">{d.room ?? 'Unnamed device'}</h2>
                  <p className="font-mono text-xs text-muted">{d.id}</p>
                </div>
                {online ? <Badge tone="good">Online</Badge> : <Badge>{d.last_seen_at ? 'Offline' : 'Not connected yet'}</Badge>}
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                <div>
                  <dt className="text-xs text-muted">Signal</dt>
                  <dd className="flex items-center gap-1.5">
                    <SignalBars bars={signalBars(d.last_rssi)} /> <span className="text-xs text-muted">{d.last_rssi != null ? `${d.last_rssi} dBm` : '—'}</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Firmware</dt>
                  <dd>{d.fw_version != null ? `v${d.fw_version}` : '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Last seen</dt>
                  <dd>{timeAgo(d.last_seen_at)}</dd>
                </div>
              </dl>

              <div className="mt-3 rounded-xl bg-surface-2 px-3 py-2.5">
                <ToggleSwitch
                  action={setDisplay}
                  fields={{ device: d.id }}
                  checked={d.display_on !== false}
                  label="Screen & light"
                  hint={(d.fw_version ?? 0) >= 8 ? 'Turn off for bedrooms. Readings and alerts carry on.' : 'Takes effect once this sensor has firmware v8 (it updates automatically).'}
                  disabled={!isOwner}
                />
              </div>

              {isOwner && (
                <div className="mt-4 space-y-3 border-t border-line pt-4">
                  <ActionForm action={nameDevice} submit={d.room ? 'Rename' : 'Save name'} size="sm" inline>
                    <input type="hidden" name="device" value={d.id} />
                    <div className="min-w-0 flex-1">
                      <Field label={d.room ? 'Name' : 'Name this location'}>
                        <Input name="name" defaultValue={d.room ?? ''} placeholder="e.g. Kitchen" maxLength={40} required />
                      </Field>
                    </div>
                  </ActionForm>
                  <p className="text-xs text-muted">The name shows here, in alerts and reports, and on the sensor&apos;s own screen.</p>
                  <details>
                    <summary className="cursor-pointer text-sm font-medium text-brand">Move or remove</summary>
                    <div className="mt-3 grid gap-4 md:grid-cols-2">
                      <ActionForm action={moveDevice} submit="Move" size="sm">
                        <input type="hidden" name="device" value={d.id} />
                        <Field label="Move to another room" hint="Past readings stay with the room they were taken in.">
                          <Select name="room" defaultValue={d.room_id ?? '__new'}>
                            {rooms.map((r) => (
                              <option key={r.id} value={r.id}>{r.name}</option>
                            ))}
                            <option value="__new">New room…</option>
                          </Select>
                        </Field>
                        <Input name="new_room" placeholder="New room name (if New room…)" maxLength={40} aria-label="New room name" />
                      </ActionForm>
                      <div className="space-y-2 text-sm text-muted">
                        <p className="font-medium text-ink">Remove from this house</p>
                        <p>For a sensor you&apos;re giving away or returning. Its readings so far stay in your history, and whoever has its claim code can add it to their house.</p>
                        <ActionForm action={removeDevice} submit="Remove sensor" kind="danger" size="sm" confirm="Remove this sensor from your house?">
                          <input type="hidden" name="device" value={d.id} />
                        </ActionForm>
                      </div>
                    </div>
                  </details>
                </div>
              )}
            </Card>
          )
        })}
      </div>

      {isOwner && (
        <Card title="Add a sensor" className="scroll-mt-20" >
          <div id="claim" />
          <p className="mb-3 text-sm text-muted">
            Sensors you order are added for you. For a gift or one bought in a shop, enter the claim code from the label on the bottom (or scan its QR code with your phone camera).
          </p>
          <ActionForm action={claim} submit="Add sensor">
            <Field label="Claim code">
              <Input name="code" defaultValue={sp.code ?? ''} placeholder="XXXX-XXXX-XXXX" autoCapitalize="characters" autoComplete="off" required className="font-mono tracking-wider" />
            </Field>
            <Field label="Room (optional)">
              <Input name="room" placeholder="e.g. Bedroom" maxLength={40} />
            </Field>
          </ActionForm>
        </Card>
      )}

      {isOwner && rooms.length > 0 && (
        <Card title="Rooms">
          <ul className="divide-y divide-line">
            {rooms.map((r) => (
              <li key={r.id} className="flex flex-wrap items-end gap-3 py-3">
                <ActionForm action={renameRoom} submit="Rename" inline size="sm" className="flex-1">
                  <input type="hidden" name="room" value={r.id} />
                  <div className="min-w-0 flex-1">
                    <Input name="name" defaultValue={r.name} aria-label="Room name" maxLength={40} />
                  </div>
                </ActionForm>
                <span className="pb-2 text-xs text-muted">{r.n} sensor{r.n === 1 ? '' : 's'}</span>
                {r.n === 0 && (
                  <ActionForm action={deleteRoom} submit="Delete" kind="danger" size="sm" confirm={`Delete ${r.name}? Its history will show as Unnamed.`}>
                    <input type="hidden" name="room" value={r.id} />
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
