import Link from 'next/link'
import { ActionForm } from '@/components/forms'
import { Field, Input } from '@/components/ui'
import { forgot } from '../actions'

export const metadata = { title: 'Reset password' }

export default function ForgotPage() {
  return (
    <>
      <h1 className="mb-1 text-xl font-bold">Reset your password</h1>
      <p className="mb-5 text-sm text-muted">We&apos;ll email you a link. If you never set a password, this works too.</p>
      <ActionForm action={forgot} submit="Send link" className="space-y-4 [&_button]:w-full">
        <Field label="Email">
          <Input name="email" type="email" autoComplete="email" required autoFocus />
        </Field>
      </ActionForm>
      <p className="mt-5 text-center text-sm">
        <Link href="/login" className="font-medium text-brand">Back to sign in</Link>
      </p>
    </>
  )
}
