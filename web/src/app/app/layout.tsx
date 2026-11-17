import Link from 'next/link'
import { houseContext } from '@/lib/houses'
import { Logo } from '@/components/logo'
import { TopNav, BottomNav, type NavItem } from '@/components/portal/nav'
import { HouseSwitcher } from '@/components/portal/house-switcher'
import { switchHouse } from './actions'
import { logout } from '../(auth)/actions'

export const dynamic = 'force-dynamic'

const DESKTOP: NavItem[] = [
  { href: '/app', label: 'Home' },
  { href: '/app/history', label: 'History' },
  { href: '/app/devices', label: 'Devices' },
  { href: '/app/alerts', label: 'Alerts' },
  { href: '/app/reports', label: 'Reports' },
  { href: '/app/household', label: 'Household' },
  { href: '/app/account', label: 'Account' },
  { href: '/app/help', label: 'Help' },
]

const PHONE: NavItem[] = [
  { href: '/app', label: 'Home', icon: 'home' },
  { href: '/app/history', label: 'History', icon: 'history' },
  { href: '/app/devices', label: 'Devices', icon: 'devices' },
  { href: '/app/alerts', label: 'Alerts', icon: 'alerts' },
  { href: '/app/more', label: 'More', icon: 'more' },
]

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const { user, houses, house } = await houseContext()
  return (
    <div className="pb-24 md:pb-10">
      <header className="no-print sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2.5">
          <Link href="/app" className="flex items-center gap-1.5 font-bold text-brand" aria-label="CO2 & You home">
            <Logo size={26} />
            <span className="hidden sm:inline">CO2 &amp; You</span>
          </Link>
          <div className="min-w-0 flex-1 md:flex-none">{house && <HouseSwitcher houses={houses} current={house.id} action={switchHouse} />}</div>
          <div className="flex-1 max-md:hidden">
            <TopNav items={DESKTOP} root="/app" />
          </div>
          {user.role !== 'customer' && (
            <Link href="/admin" className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold">
              Admin
            </Link>
          )}
          <form action={logout} className="max-md:hidden">
            <button className="text-sm text-muted hover:text-ink">Sign out</button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-5">{children}</main>
      <BottomNav items={PHONE} root="/app" />
    </div>
  )
}
