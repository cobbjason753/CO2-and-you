import { redirect } from 'next/navigation'
import { getAuth } from '@/lib/auth'
import { ActionForm } from '@/components/forms'
import { Field, Input } from '@/components/ui'
import { verify2fa, logout } from '../../actions'

export const metadata = { title: 'Two-step verification' }

export default async function TwoFactorPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const auth = await getAuth()
  if (!auth) redirect('/login')
  if (auth.session.mfa_ok) redirect('/app')
  const { next } = await searchParams
  return (
    <>
      <h1 className="mb-1 text-xl font-bold">Enter your code</h1>
      <p className="mb-5 text-sm text-muted">Open your authenticator app and enter the 6-digit code for CO2 &amp; You.</p>
      <ActionForm action={verify2fa} submit="Verify" className="space-y-4 [&_button]:w-full">
        <input type="hidden" name="next" value={next ?? ''} />
        <Field label="Code">
          <Input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required autoFocus className="text-center text-2xl tracking-[0.4em]" />
        </Field>
      </ActionForm>
      <form action={logout} className="mt-4 text-center">
        <button className="text-sm text-muted underline">Use a different account</button>
      </form>
    </>
  )
}
