import { PasswordTokenForm } from '../form'

export const metadata = { title: 'Set your password' }

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <PasswordTokenForm token={token} welcome />
}
