import { requireUser } from '@/lib/auth'
import { Card, PageHeader, Field, Input, Notice } from '@/components/ui'
import { ActionForm } from '@/components/forms'
import { start2fa, confirm2fa, disable2fa } from '../../actions'

export const metadata = { title: 'Two-step verification' }

export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ staff?: string }> }) {
  const sp = await searchParams
  const { user } = await requireUser()
  if (user.totp_enabled)
    return (
      <div className="space-y-4">
        <PageHeader title="Two-step verification" />
        <Notice tone="ok">Two-step verification is on. You&apos;ll be asked for a code from your authenticator app when you sign in.</Notice>
        {user.role === 'customer' && (
          <Card title="Turn off">
            <ActionForm action={disable2fa} submit="Turn off two-step verification" kind="danger">
              <input type="email" name="username" value={user.email} autoComplete="username" readOnly hidden />
              <Field label="Password">
                <Input name="password" type="password" autoComplete="current-password" required />
              </Field>
            </ActionForm>
          </Card>
        )}
      </div>
    )
  const setup = await start2fa()
  return (
    <div className="space-y-4">
      <PageHeader title="Turn on two-step verification" />
      {sp.staff && <Notice tone="warn">Staff accounts need two-step verification before using the admin area.</Notice>}
      <Card>
        <ol className="list-decimal space-y-4 pl-5 text-sm">
          <li>
            Open an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy…) and scan this code.
            <div className="mt-3 w-44 rounded-xl bg-white p-2" dangerouslySetInnerHTML={{ __html: setup.svg }} />
            <p className="mt-2 text-xs text-muted">
              Can&apos;t scan? Enter this key: <code className="break-all font-mono">{setup.secret.match(/.{1,4}/g)?.join(' ')}</code>
            </p>
          </li>
          <li>
            Enter the 6-digit code the app shows.
            <ActionForm action={confirm2fa} submit="Turn on" className="mt-2 max-w-xs space-y-3">
              <Input name="code" inputMode="numeric" autoComplete="one-time-code" required aria-label="6-digit code" className="text-center text-xl tracking-[0.3em]" />
            </ActionForm>
          </li>
        </ol>
      </Card>
    </div>
  )
}
