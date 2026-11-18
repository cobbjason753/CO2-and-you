import { requireHouse } from '@/lib/houses'
import { q } from '@/lib/db'
import { Card, PageHeader, Field, Input, Select, Badge, Notice } from '@/components/ui'
import { ActionForm } from '@/components/forms'
import { saveHouse, invite, removeMember, setMemberRole, addHouse } from '../actions'

export const metadata = { title: 'Household' }

export default async function HouseholdPage() {
  const { house, houses, user } = await requireHouse()
  const isOwner = house.role === 'owner'
  const members = await q<{ id: string; email: string; name: string; role: string; active: boolean }>(
    `SELECT u.id, u.email, u.name, m.role, u.password_hash IS NOT NULL AS active
       FROM house_members m JOIN users u ON u.id = m.user_id WHERE m.house_id = $1 ORDER BY m.role, u.email`,
    [house.id],
  )
  const pending = await q<{ email: string; expires_at: Date }>(
    `SELECT email, expires_at FROM tokens WHERE kind = 'invite' AND used_at IS NULL AND expires_at > now() AND data->>'house_id' = $1 ORDER BY created_at DESC`,
    [house.id],
  )
  const zones = Intl.supportedValuesOf('timeZone').filter((z) => /^(America|Europe|Pacific|Australia|Asia|Africa|Atlantic)\//.test(z))

  return (
    <div className="space-y-4">
      <PageHeader title="Household" sub={`House ID ${house.id}`} />

      <Card title="This house">
        <ActionForm action={saveHouse} submit="Save">
          <fieldset disabled={!isOwner} className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <Input name="name" defaultValue={house.name} maxLength={40} required />
            </Field>
            <Field label="Time zone" hint="Used for charts, exports and the weekly report.">
              <Select name="timezone" defaultValue={house.timezone}>
                {zones.map((z) => (
                  <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>
                ))}
              </Select>
            </Field>
          </fieldset>
        </ActionForm>
      </Card>

      <Card title="Members">
        <ul className="divide-y divide-line">
          {members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {m.name || m.email} {m.id === user.id && <span className="text-xs text-muted">(you)</span>}
                </p>
                <p className="truncate text-xs text-muted">{m.email}{!m.active && ' · hasn’t set a password yet'}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={m.role === 'owner' ? 'brand' : 'neutral'}>{m.role === 'owner' ? 'Owner' : 'Viewer'}</Badge>
                {isOwner && m.id !== user.id && (
                  <>
                    <ActionForm action={setMemberRole} submit={m.role === 'owner' ? 'Make viewer' : 'Make owner'} kind="secondary" size="sm">
                      <input type="hidden" name="user" value={m.id} />
                      <input type="hidden" name="role" value={m.role === 'owner' ? 'viewer' : 'owner'} />
                    </ActionForm>
                    <ActionForm action={removeMember} submit="Remove" kind="danger" size="sm" confirm={`Remove ${m.email} from ${house.name}?`}>
                      <input type="hidden" name="user" value={m.id} />
                    </ActionForm>
                  </>
                )}
                {m.id === user.id && !isOwner && (
                  <ActionForm action={removeMember} submit="Leave" kind="danger" size="sm" confirm={`Leave ${house.name}?`}>
                    <input type="hidden" name="user" value={m.id} />
                  </ActionForm>
                )}
              </div>
            </li>
          ))}
        </ul>
        {pending.length > 0 && (
          <p className="mt-2 text-xs text-muted">Invites waiting: {pending.map((p) => p.email).join(', ')}</p>
        )}
      </Card>

      {isOwner && (
        <Card title="Invite someone">
          <p className="mb-3 text-sm text-muted">Viewers can see rooms, history, alerts and reports. They can&apos;t rename or remove sensors, change alerts, or see billing.</p>
          <ActionForm action={invite} submit="Send invite" inline resetOnOk>
            <div className="min-w-0 flex-1">
              <Field label="Email">
                <Input name="email" type="email" required />
              </Field>
            </div>
          </ActionForm>
        </Card>
      )}

      <Card title="Your houses">
        <ul className="mb-3 space-y-1 text-sm">
          {houses.map((h) => (
            <li key={h.id} className="flex justify-between">
              <span>{h.name}{h.id === house.id && <span className="text-muted"> · showing now</span>}</span>
              <span className="text-muted">{h.role}</span>
            </li>
          ))}
        </ul>
        {houses.length > 1 && <p className="mb-3 text-xs text-muted">Switch houses with the menu at the top of the page.</p>}
        {houses.some((h) => h.role === 'owner') && (
          <details>
            <summary className="cursor-pointer text-sm font-medium text-brand">Add another house</summary>
            <ActionForm action={addHouse} submit="Add house" inline className="mt-2">
              <div className="min-w-0 flex-1">
                <Field label="Name">
                  <Input name="name" placeholder="e.g. Lake cabin" maxLength={40} required />
                </Field>
              </div>
            </ActionForm>
          </details>
        )}
      </Card>
      {!isOwner && <Notice>You&apos;re a viewer in {house.name}.</Notice>}
    </div>
  )
}
