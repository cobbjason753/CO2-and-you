import Link from 'next/link'
import { q } from '@/lib/db'
import { Card, PageHeader, Field, Input, Select, Table, Badge } from '@/components/ui'
import { ProvisionForm } from '@/components/admin/provision-form'
import { timeAgo } from '@/lib/units'
import { provision } from '../actions'

export const metadata = { title: 'Provisioning' }

export default async function ProvisioningPage({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  const sp = await searchParams
  const recent = await q<any>(`SELECT id, status, test_result, fw_provisioned, secret_set_at, last_seen_at, created_at FROM devices ORDER BY created_at DESC LIMIT 25`)
  const unknown = await q<any>(`SELECT * FROM unknown_devices ORDER BY last_seen_at DESC LIMIT 20`)
  return (
    <div className="space-y-5">
      <PageHeader title="Provisioning" sub="Register flashed and tested boards, then print their serial labels." />
      <Card title="Register boards">
        <ProvisionForm action={provision} defaultDevices={(sp.ids ?? '').split(',').filter(Boolean).join('\n')}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Firmware version flashed">
              <Input name="fw" type="number" min={1} placeholder="e.g. 8" />
            </Field>
            <Field label="Factory test result" hint="Default for lines that don't say.">
              <Select name="test_result" defaultValue="pass">
                <option value="pass">Pass</option>
                <option value="fail">Fail</option>
              </Select>
            </Field>
            <Field label="Batch notes">
              <Input name="notes" placeholder="e.g. JLCPCB batch 2026-11" />
            </Field>
          </div>
          <p className="text-xs text-muted">
            One board per line. The DEVICE_ID is printed on the serial console at boot (<code>Device ID: esp32-…</code>). Paste the device secret from the
            <code> PROVISION</code> line to pin it now; otherwise the board sets it the first time it connects.
          </p>
        </ProvisionForm>
      </Card>

      {unknown.length > 0 && (
        <Card title="Unknown devices trying to connect">
          <p className="mb-2 text-sm text-muted">Boards running the new firmware that aren&apos;t registered yet — e.g. existing prototypes. Register them to let them in.</p>
          <Table head={['DEVICE_ID', 'Firmware', 'Old location name', 'Attempts', 'Last seen', '']}>
            {unknown.map((u) => (
              <tr key={u.device_id}>
                <td className="font-mono text-xs">{u.device_id}</td>
                <td>{u.fw_version ?? '—'}</td>
                <td>{u.legacy_location ?? '—'}</td>
                <td>{u.attempts}</td>
                <td>{timeAgo(u.last_seen_at)}</td>
                <td><Link className="text-brand" href={`/admin/provisioning?ids=${u.device_id}`}>Register</Link></td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <Card title="Recently registered">
        <Table head={['DEVICE_ID', 'Status', 'Test', 'FW', 'Secret', 'Last seen']}>
          {recent.map((d) => (
            <tr key={d.id}>
              <td><Link href={`/admin/devices/${d.id}`} className="font-mono text-xs text-brand">{d.id}</Link></td>
              <td><Badge>{d.status}</Badge></td>
              <td>{d.test_result === 'pass' ? <Badge tone="good">pass</Badge> : <Badge tone="poor">fail</Badge>}</td>
              <td>{d.fw_provisioned ?? '—'}</td>
              <td>{d.secret_set_at ? 'set' : 'on first connect'}</td>
              <td>{timeAgo(d.last_seen_at)}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  )
}
