import Link from 'next/link'
import { requireUser } from '@/lib/auth'
import { logout } from '../../(auth)/actions'

export const metadata = { title: 'More' }

const LINKS = [
  { href: '/app/reports', label: 'Weekly reports', sub: 'Summary email for each house' },
  { href: '/app/household', label: 'Household', sub: 'Members, invites, houses' },
  { href: '/app/account', label: 'Account', sub: 'Profile, password, billing, your data' },
  { href: '/app/help', label: 'Help', sub: 'CO2 explained, setup, calibration, contact us' },
]

export default async function MorePage() {
  const { user } = await requireUser()
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold">More</h1>
      <p className="text-sm text-muted">{user.email}</p>
      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
        {LINKS.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="flex items-center justify-between px-4 py-3.5 hover:bg-surface-2">
              <span>
                <span className="block font-medium">{l.label}</span>
                <span className="block text-xs text-muted">{l.sub}</span>
              </span>
              <span aria-hidden className="text-muted">›</span>
            </Link>
          </li>
        ))}
      </ul>
      <form action={logout}>
        <button className="w-full rounded-2xl border border-line bg-surface px-4 py-3 text-left font-medium text-danger">Sign out</button>
      </form>
    </div>
  )
}
