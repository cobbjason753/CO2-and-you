import { ActionForm } from '@/components/forms'
import { Field, Input } from '@/components/ui'
import { acceptInvite, tokenStatus } from '../../actions'

export const metadata = { title: 'Join a household' }

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const t = await tokenStatus(token, ['invite'])
  if (!t)
    return (
      <>
        <h1 className="mb-2 text-xl font-bold">This invite has expired</h1>
        <p className="text-sm text-muted">Ask the person who invited you to send a new one from their Household page.</p>
      </>
    )
  return (
    <>
      <h1 className="mb-1 text-xl font-bold">Join {t.houseName}</h1>
      <p className="mb-5 text-sm text-muted">
        You&apos;ve been invited to view air quality for <b>{t.houseName}</b> as <b>{t.email}</b>.
      </p>
      <ActionForm action={acceptInvite} submit="Join" className="space-y-4 [&_button]:w-full">
        <input type="hidden" name="token" value={token} />
        <input type="email" name="username" value={t.email} autoComplete="username" readOnly hidden />
        {t.hasAccount ? (
          <Field label="Your password" hint="You already have an account with this email.">
            <Input name="password" type="password" autoComplete="current-password" required />
          </Field>
        ) : (
          <>
            <Field label="Your name">
              <Input name="name" autoComplete="name" />
            </Field>
            <Field label="Choose a password" hint="At least 10 characters.">
              <Input name="password" type="password" autoComplete="new-password" minLength={10} required />
            </Field>
          </>
        )}
      </ActionForm>
    </>
  )
}
