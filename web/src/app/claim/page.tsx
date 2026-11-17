import { redirect } from 'next/navigation'
import { getAuth } from '@/lib/auth'

/** Target of the QR code on the device label: https://<app>/claim?code=XXXX-XXXX-XXXX */
export default async function ClaimRedirect({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams
  const target = `/app/devices?code=${encodeURIComponent((code ?? '').slice(0, 20))}#claim`
  if (!(await getAuth())) redirect(`/login?next=${encodeURIComponent(target)}`)
  redirect(target)
}
