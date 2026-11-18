import { PasswordTokenForm } from '../../set-password/form'

export const metadata = { title: 'Reset password' }

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <PasswordTokenForm token={token} welcome={false} />
}
