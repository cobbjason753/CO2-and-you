import Link from 'next/link'
import { ActionForm } from '@/components/forms'
import { Field, Input } from '@/components/ui'
import { setPassword, tokenStatus } from '../actions'

export async function PasswordTokenForm({ token, welcome }: { token: string; welcome: boolean }) {
  const t = await tokenStatus(token, ['set_password', 'reset_password'])
  if (!t)
    return (
      <>
        <h1 className="mb-2 text-xl font-bold">This link has expired</h1>
        <p className="text-sm text-muted">Links work once. Ask for a fresh one and we&apos;ll email it straight away.</p>
        <Link href="/forgot" className="mt-4 inline-block font-medium text-brand">Send a new link</Link>
      </>
    )
  return (
    <>
      <h1 className="mb-1 text-xl font-bold">{welcome ? 'Welcome to CO2 & You' : 'Choose a new password'}</h1>
      <p className="mb-5 text-sm text-muted">Signing in as <b>{t.email}</b></p>
      <ActionForm action={setPassword} submit={welcome ? 'Create account' : 'Save password'} className="space-y-4 [&_button]:w-full">
        <input type="hidden" name="token" value={token} />
        <input type="email" name="username" value={t.email} autoComplete="username" readOnly hidden />
        {welcome && (
          <Field label="Your name">
            <Input name="name" defaultValue={t.name} autoComplete="name" />
          </Field>
        )}
        <Field label="Password" hint="At least 10 characters.">
          <Input name="password" type="password" autoComplete="new-password" minLength={10} required />
        </Field>
        <Field label="Confirm password">
          <Input name="confirm" type="password" autoComplete="new-password" minLength={10} required />
        </Field>
      </ActionForm>
    </>
  )
}
