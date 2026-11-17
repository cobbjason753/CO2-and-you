import Link from 'next/link'
import { q } from '@/lib/db'
import { Card, PageHeader, Field, Input, Textarea, Table, Badge } from '@/components/ui'
import { ActionForm } from '@/components/forms'
import { addRelease, setReleaseStage, setPilotGroup } from '../actions'

export const metadata = { title: 'Firmware' }

const NEXT: Record<string, { stage: string; label: string }[]> = {
  draft: [{ stage: 'pilot', label: 'Start pilot' }],
  pilot: [{ stage: 'general', label: 'Release to everyone' }, { stage: 'draft', label: 'Stop pilot' }],
  general: [{ stage: 'retired', label: 'Retire' }],
  retired: [{ stage: 'draft', label: 'Restore as draft' }],
}

export default async function FirmwarePage() {
  const releases = await q<any>(
    `SELECT f.version, f.url, f.size_bytes, f.sha256, f.stage, f.notes, f.created_at, (f.bin_data IS NOT NULL) AS uploaded,
            (SELECT count(*)::int FROM devices d WHERE d.fw_version = f.version) AS running
       FROM firmware_releases f ORDER BY version DESC`,
  )
  const pilots = await q<{ id: string }>('SELECT id FROM devices WHERE pilot ORDER BY id')
  const versions = await q<{ fw_version: number | null; n: number }>(`SELECT fw_version, count(*)::int AS n FROM devices WHERE status = 'assigned' GROUP BY 1 ORDER BY 1 DESC NULLS LAST`)
  return (
    <div className="space-y-4">
      <PageHeader title="Firmware releases" sub="Devices ask on every upload. Pilot devices get the newest pilot or general build; everyone else gets the newest general build." />
      <Card title="Releases">
        <Table head={['Version', 'Stage', 'Running', 'Build', 'Notes', 'Rollout']}>
          {releases.map((r) => (
            <tr key={r.version}>
              <td className="font-semibold">v{r.version}</td>
              <td><Badge tone={r.stage === 'general' ? 'good' : r.stage === 'pilot' ? 'fair' : 'neutral'}>{r.stage}</Badge></td>
              <td>{r.running}</td>
              <td className="text-xs">
                {r.uploaded ? <Link href={`/api/device/firmware/${r.version}`} className="text-brand">uploaded</Link> : <a href={r.url} className="text-brand">link</a>}
                {r.size_bytes && ` · ${(r.size_bytes / 1024).toFixed(0)} KB`}
                <div className="font-mono text-[10px] text-muted" title={r.sha256}>{r.sha256.slice(0, 16)}…</div>
              </td>
              <td className="max-w-56 text-xs">{r.notes}</td>
              <td>
                <div className="flex flex-wrap gap-1">
                  {NEXT[r.stage].map((n) => (
                    <ActionForm key={n.stage} action={setReleaseStage} submit={n.label} kind={n.stage === 'general' ? 'primary' : 'secondary'} size="sm" confirm={`${n.label}: v${r.version}?`}>
                      <input type="hidden" name="version" value={r.version} />
                      <input type="hidden" name="stage" value={n.stage} />
                    </ActionForm>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </Table>
        <p className="mt-3 text-xs text-muted">
          Devices on the platform: {versions.map((v) => `v${v.fw_version ?? '?'} × ${v.n}`).join(' · ') || 'none'}. A build that can&apos;t upload within 20 minutes of installing rolls itself back.
        </p>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Add a build">
          <ActionForm action={addRelease} submit="Add as draft" resetOnOk>
            <Field label="Version" hint="The number from the git tag: v9 → 9. The build must be compiled with that FW_VERSION.">
              <Input name="version" type="number" min={1} required />
            </Field>
            <Field label="Upload .bin" hint="Dsp_v1_Cloud.ino.bin from the build output, under 4 MB.">
              <input name="file" type="file" accept=".bin,application/octet-stream" className="block text-sm" />
            </Field>
            <Field label="…or link to it" hint="e.g. the GitHub Release asset the release workflow publishes.">
              <Input name="url" type="url" placeholder="https://github.com/…/firmware-v9.bin" />
            </Field>
            <Field label="Notes"><Textarea name="notes" rows={2} /></Field>
          </ActionForm>
        </Card>
        <Card title={`Pilot group (${pilots.length})`}>
          <ActionForm action={setPilotGroup} submit="Save pilot group">
            <Field label="DEVICE_IDs" hint="Usually your own units plus a few friendly customers. One per line.">
              <Textarea name="devices" rows={6} defaultValue={pilots.map((p) => p.id).join('\n')} className="font-mono text-sm" />
            </Field>
          </ActionForm>
        </Card>
      </div>
    </div>
  )
}
