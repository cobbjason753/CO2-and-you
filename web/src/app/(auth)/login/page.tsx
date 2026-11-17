import Link from 'next/link'
import { ActionForm } from '@/components/forms'
import { Field, Input } from '@/components/ui'
import { login } from '../actions'

export const metadata = { title: 'Sign in' }

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams
  return (
    <>
      <h1 className="mb-1 text-xl font-bold">Sign in</h1>
      <p className="mb-5 text-sm text-muted">See your rooms, alerts and history.</p>
      <ActionForm action={login} submit="Sign in" className="space-y-4 [&_button]:w-full">
        <input type="hidden" name="next" value={next ?? ''} />
        <Field label="Email">
          <Input name="email" type="email" autoComplete="email" required autoFocus />
        </Field>
        <Field label="Password">
          <Input name="password" type="password" autoComplete="current-password" required />
        </Field>
      </ActionForm>
      <p className="mt-5 text-center text-sm">
        <Link href="/forgot" className="font-medium text-brand">
          Forgot password?
        </Link>
      </p>
      <p className="mt-4 text-center text-xs text-muted">New here? Your account is created when you order. Check your welcome email for the link to set a password.</p>
    </>
  )
}
