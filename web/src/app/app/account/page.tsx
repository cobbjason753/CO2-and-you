import Link from 'next/link'
import { requireUser } from '@/lib/auth'
import { subscriptionForUser } from '@/lib/billing'
import { Card, PageHeader, Field, Input, Select, Badge, Notice, LinkButton, buttonClass } from '@/components/ui'
import { ActionForm } from '@/components/forms'
import { AppSetup } from '@/components/portal/app-setup'
import { vapidPublicKey } from '@/lib/push'
import { saveProfile, changePassword, openBilling, deleteAccount, enablePush, disablePush, testPush } from '../actions'

export const metadata = { title: 'Account' }

const dateFmt = (d: Date) => new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(d)

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ billing?: string }> }) {
  const sp = await searchParams
  const { user } = await requireUser()
  const sub = await subscriptionForUser(user.id)
  return (
    <div className="space-y-4">
      <PageHeader title="Account" sub={user.email} />

      <Card title="Profile">
        <ActionForm action={saveProfile} submit="Save">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <Input name="name" defaultValue={user.name} autoComplete="name" maxLength={80} />
            </Field>
            <Field label="Temperature">
              <Select name="temp_unit" defaultValue={user.temp_unit}>
                <option value="F">Fahrenheit (°F)</option>
                <option value="C">Celsius (°C)</option>
              </Select>
            </Field>
          </div>
          <p className="text-xs text-muted">To change your email address, contact support.</p>
        </ActionForm>
      </Card>

      <Card title="Password">
        <ActionForm action={changePassword} submit="Change password" resetOnOk>
          <input type="email" name="username" value={user.email} autoComplete="username" readOnly hidden />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Current password">
              <Input name="current" type="password" autoComplete="current-password" required />
            </Field>
            <Field label="New password" hint="At least 10 characters.">
              <Input name="password" type="password" autoComplete="new-password" minLength={10} required />
            </Field>
          </div>
        </ActionForm>
      </Card>

      <Card title="App & notifications" className="scroll-mt-20">
        <div id="app" />
        <AppSetup vapidKey={vapidPublicKey()} enablePush={enablePush} disablePush={disablePush} testPush={testPush} />
      </Card>

      <Card title="Two-step verification" action={user.totp_enabled ? <Badge tone="good">On</Badge> : <Badge>Off</Badge>}>
        <p className="mb-3 text-sm text-muted">Ask for a code from an authenticator app when you sign in.</p>
        <LinkButton href="/app/account/security" kind="secondary" size="sm">{user.totp_enabled ? 'Manage' : 'Turn on'}</LinkButton>
      </Card>

      <Card title="Subscription and billing" className="scroll-mt-20">
        <div id="billing" />
        {sub ? (
          <p className="mb-3 text-sm">
            <Badge tone={['active', 'trialing'].includes(sub.status) ? 'good' : 'fair'}>{sub.status.replace('_', ' ')}</Badge>{' '}
            <span className="ml-1 capitalize">{sub.plan} plan</span>
            {sub.current_period_end && <span className="text-muted"> · renews {dateFmt(sub.current_period_end)}</span>}
          </p>
        ) : (
          <p className="mb-3 text-sm text-muted">No subscription on this account. If someone else in your household pays, it&apos;s on their account.</p>
        )}
        {sp.billing === 'unavailable' && <div className="mb-3"><Notice tone="warn">Online billing isn&apos;t connected for this account yet. Contact support to change your plan or card.</Notice></div>}
        <form action={openBilling}>
          <button className={buttonClass('secondary', 'sm')}>Manage billing, card and invoices</button>
        </form>
      </Card>

      <Card title="Your data">
        <p className="mb-3 text-sm text-muted">
          Download everything we hold about you: your profile, houses you belong to, devices, alert history and every reading, as a ZIP of CSV and JSON files.
        </p>
        <a href="/app/account/export" className={buttonClass('secondary', 'sm')} download>Download my data</a>
        <p className="mt-3 text-xs text-muted">
          CO2 patterns can show when people are home or asleep. We never sell your data. See our <Link href="/app/help#privacy" className="text-brand">privacy summary</Link>.
        </p>
      </Card>

      {user.role === 'customer' && (
        <Card title="Delete account" className="border-danger/30">
          <details>
            <summary className="cursor-pointer text-sm font-medium text-danger">I want to delete my account</summary>
            <div className="mt-3 space-y-3 text-sm text-muted">
              <p>
                This signs you out and deletes your account. Houses where you are the only owner are deleted with all their readings, and their sensors are released so
                someone else can claim them. Houses with another owner are kept. Cancel your subscription in billing first. This can&apos;t be undone.
              </p>
              <ActionForm action={deleteAccount} submit="Delete my account" kind="danger">
                <input type="email" name="username" value={user.email} autoComplete="username" readOnly hidden />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Password">
                    <Input name="password" type="password" autoComplete="current-password" required />
                  </Field>
                  <Field label="Type DELETE to confirm">
                    <Input name="confirm" required autoComplete="off" />
                  </Field>
                </div>
              </ActionForm>
            </div>
          </details>
        </Card>
      )}
    </div>
  )
}
