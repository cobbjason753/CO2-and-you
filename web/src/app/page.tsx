import { redirect } from 'next/navigation'
import { getAuth } from '@/lib/auth'

// The marketing site will live here; for now the root sends people to the portal.
export default async function Home() {
  const auth = await getAuth()
  if (!auth) redirect('/login')
  redirect(auth.user.role === 'customer' ? '/app' : '/admin')
}
