import Link from 'next/link'
import { notFound } from 'next/navigation'
import { q, one } from '@/lib/db'
import { normalizeDeviceId } from '@/lib/devices'
import { otaOfferFor } from '@/lib/firmware'
import { timeAgo, isOnline, fmtTemp } from '@/lib/units'
import { Card, PageHeader, Field, Input, Select, Badge, Table, Textarea } from '@/components/ui'
import { ActionForm } from '@/components/forms'
import { ReissueForm } from '@/components/admin/provision-form'
import { deviceAction, reissueLabel } from '../../actions'

export const metadata = { title: 'Device' }

export default async function DevicePage({ params }: { params: Promise<{ id: string }> }) {
  const id = normalizeDeviceId(decodeURIComponent((await params).id))
  const d = await one<any>(
    `SELECT d.*, r.name AS room, h.name AS house_name FROM devices d LEFT JOIN rooms r ON r.id = d.room_id LEFT JOIN houses h ON h.id = d.house_id WHERE d.id = $1`,
    [id],
  )
  if (!d) notFound()
  const owners = d.house_id
    ? await q<any>(`SELECT u.id, u.email FROM house_members m JOIN users u ON u.id = m.user_id WHERE m.house_id = $1 AND m.role = 'owner'`, [d.house_id])
    : []
  const history = await q<any>('SELECT * FROM device_assignments WHERE device_id = $1 ORDER BY started_at DESC', [id])
  const releases = await q<any>(`SELECT version, stage FROM firmware_releases WHERE stage <> 'retired' ORDER BY version DESC`)
  const audits = await q<any>(`SELECT at, actor_email, action, details FROM audit_log WHERE target_type = 'device' AND target_id = $1 ORDER BY at DESC LIMIT 20`, [id])
  const offer = await otaOfferFor(d)
  const recent = await q<any>('SELECT time, co2, temp_c, humidity FROM readings WHERE device_id = $1 ORDER BY time DESC LIMIT 6', [id])
  const hidden = <input type="hidden" name="device" value={id} />

  return (
    <div className="space-y-4">
      <PageHeader
        title={<span className="font-mono">{id}</span>}
        sub={
          <>
            <Badge tone={d.status === 'assigned' ? 'good' : d.status === 'in_stock' ? 'brand' : 'poor'}>{d.status}</Badge>{' '}
            {isOnline(d.last_seen_at) ? <Badge tone="good">online</Badge> : <Badge>last seen {timeAgo(d.last_seen_at)}</Badge>}{' '}
            {d.pilot && <Badge tone="fair">pilot group</Badge>} test {d.test_result} · claim code …{d.claim_code_hint}
            {d.claim_used_at && ' (used)'}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Where it is">
          {d.house_id ? (
            <div className="space-y-1 text-sm">
              <p>House <b>{d.house_name}</b> <span className="font-mono text-xs">{d.house_id}</span></p>
              <p>Room: {d.room ?? <span className="text-muted">unnamed</span>}</p>
              <p>Owner: {owners.map((o) => <Link key={o.id} href={`/admin/customers/${o.id}`} className="text-brand">{o.email} </Link>)}</p>
              <p className="text-xs text-muted">Assigned {d.assigned_at ? new Date(d.assigned_at).toLocaleString('en-US') : ''}</p>
            </div>
          ) : (
            <p className="text-sm text-muted">Not in any house.</p>
          )}
        </Card>
        <Card title="Health">
          <dl className="grid grid-cols-2 gap-1 text-sm">
            <dt className="text-muted">Firmware</dt><dd>v{d.fw_version ?? '?'} (flashed v{d.fw_provisioned ?? '?'})</dd>
            <dt className="text-muted">Signal</dt><dd>{d.last_rssi ?? '—'} dBm</dd>
            <dt className="text-muted">Screen &amp; light</dt><dd>{d.display_on === false ? 'off (customer setting)' : 'on'}</dd>
            <dt className="text-muted">Latest</dt><dd>{d.last_co2 ?? '—'} ppm · {fmtTemp(d.last_temp_c, 'F')}</dd>
            <dt className="text-muted">CO2 sensor</dt><dd>{d.sensor_state ?? 'not reported (firmware before v10)'}{d.last_reading_at && ` · last reading ${timeAgo(d.last_reading_at)}`}</dd>
            <dt className="text-muted">Device note</dt><dd>{d.device_note ? `${d.device_note} (${timeAgo(d.device_note_at)})` : '—'}</dd>
            <dt className="text-muted">Upload errors</dt><dd>{d.ingest_errors}{d.last_error && ` (${d.last_error}, ${timeAgo(d.last_error_at)})`}</dd>
            <dt className="text-muted">Secret</dt><dd>{d.secret_set_at ? `set ${new Date(d.secret_set_at).toLocaleDateString('en-US')}` : 'not yet enrolled'}</dd>
            <dt className="text-muted">OTA offer</dt><dd>{offer ? `v${offer.version}` : 'none (up to date)'}{d.target_fw && ` · forced v${d.target_fw}`}</dd>
          </dl>
        </Card>
        <Card title="Latest readings">
          <ul className="text-xs tabular">
            {recent.map((r) => <li key={r.time.toISOString()}>{new Date(r.time).toLocaleString('en-US')} · {r.co2} ppm · {r.temp_c.toFixed(1)}°C · {r.humidity.toFixed(0)}%</li>)}
            {!recent.length && <li className="text-muted">None stored (unassigned devices aren&apos;t stored).</li>}
          </ul>
        </Card>
      </div>

      <Card title="Actions">
        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Ownership</h3>
            {d.house_id && (
              <ActionForm action={deviceAction} submit="Unassign (back to stock)" kind="secondary" size="sm" confirm="Unassign from this house? Readings stay with the house.">
                {hidden}<input type="hidden" name="action" value="unassign" />
              </ActionForm>
            )}
            <ActionForm action={deviceAction} submit="Reassign" size="sm" inline>
              {hidden}<input type="hidden" name="action" value="reassign" />
              <div className="w-48"><Input name="house" placeholder="HOUSE_ID" required aria-label="HOUSE_ID" className="font-mono" /></div>
            </ActionForm>
            <div className="flex flex-wrap gap-2">
              <ActionForm action={deviceAction} submit="Mark returned" kind="secondary" size="sm" confirm="Mark returned? It will be unassigned and blocked.">
                {hidden}<input type="hidden" name="action" value="returned" />
              </ActionForm>
              <ActionForm action={deviceAction} submit="Mark defective" kind="danger" size="sm" confirm="Mark defective? It will be unassigned and blocked.">
                {hidden}<input type="hidden" name="action" value="defective" />
              </ActionForm>
              {['returned', 'defective', 'revoked'].includes(d.status) && (
                <ActionForm action={deviceAction} submit="Restock" kind="secondary" size="sm">
                  {hidden}<input type="hidden" name="action" value="restock" />
                </ActionForm>
              )}
            </div>
            <ReissueForm action={reissueLabel} device={id} />
          </div>
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Firmware</h3>
            <ActionForm action={deviceAction} submit="Force update" size="sm" inline>
              {hidden}<input type="hidden" name="action" value="force_fw" />
              <Select name="version" defaultValue={d.target_fw ?? ''} className="w-auto" aria-label="Version">
                <option value="">— clear forced version —</option>
                {releases.map((r) => <option key={r.version} value={r.version}>v{r.version} ({r.stage})</option>)}
              </Select>
            </ActionForm>
            <ActionForm action={deviceAction} submit={d.pilot ? 'Remove from pilot group' : 'Add to pilot group'} kind="secondary" size="sm">
              {hidden}<input type="hidden" name="action" value="pilot" />
            </ActionForm>
            <h3 className="pt-2 text-sm font-semibold">Credential</h3>
            <div className="flex flex-wrap gap-2">
              <ActionForm action={deviceAction} submit="Reset secret (re-enroll)" kind="secondary" size="sm" confirm="Clear the secret? The next device that enrolls with this ID sets a new one.">
                {hidden}<input type="hidden" name="action" value="reset_secret" />
              </ActionForm>
              <ActionForm action={deviceAction} submit="Revoke" kind="danger" size="sm" confirm="Revoke this device? It's unassigned and blocked from uploading.">
                {hidden}<input type="hidden" name="action" value="revoke" />
              </ActionForm>
            </div>
          </div>
        </div>
        <ActionForm action={deviceAction} submit="Save notes" kind="secondary" size="sm" className="mt-5">
          {hidden}<input type="hidden" name="action" value="notes" />
          <Field label="Staff notes"><Textarea name="notes" defaultValue={d.notes} rows={2} /></Field>
        </ActionForm>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Ownership history">
          <Table head={['House', 'From', 'To', 'How']}>
            {history.map((h) => (
              <tr key={h.id}><td className="font-mono text-xs">{h.house_id}</td><td className="text-xs">{new Date(h.started_at).toLocaleString('en-US')}</td><td className="text-xs">{h.ended_at ? new Date(h.ended_at).toLocaleString('en-US') : 'now'}</td><td>{h.how}</td></tr>
            ))}
          </Table>
        </Card>
        <Card title="Audit">
          <ul className="divide-y divide-line text-xs">
            {audits.map((a, i) => <li key={i} className="py-1.5"><b>{a.action}</b> by {a.actor_email ?? 'system'} · {new Date(a.at).toLocaleString('en-US')}</li>)}
          </ul>
        </Card>
      </div>
    </div>
  )
}
