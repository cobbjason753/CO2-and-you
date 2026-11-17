import Link from 'next/link'
import { requireStaff } from '@/lib/auth'
import { Logo } from '@/components/logo'
import { TopNav, type NavItem } from '@/components/portal/nav'
import { logout } from '../(auth)/actions'

export const dynamic = 'force-dynamic'

const NAV: NavItem[] = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/provisioning', label: 'Provisioning' },
  { href: '/admin/packing', label: 'Packing' },
  { href: '/admin/customers', label: 'Customers' },
  { href: '/admin/fleet', label: 'Fleet' },
  { href: '/admin/firmware', label: 'Firmware' },
  { href: '/admin/metrics', label: 'Metrics' },
  { href: '/admin/support', label: 'Support' },
  { href: '/admin/audit', label: 'Audit' },
  { href: '/admin/emails', label: 'Emails' },
]

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireStaff()
  const nav = user.role === 'admin' ? [...NAV, { href: '/admin/staff', label: 'Staff' }] : NAV
  return (
    <div className="pb-10">
      <header className="no-print sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5">
          <Link href="/admin" className="flex items-center gap-1.5 font-bold text-brand">
            <Logo size={24} /> Admin
          </Link>
          <div className="min-w-0 flex-1 overflow-x-auto">
            <TopNav items={nav} root="/admin" />
          </div>
          <Link href="/app" className="text-sm text-muted hover:text-ink">Portal</Link>
          <form action={logout}>
            <button className="text-sm text-muted hover:text-ink">Sign out</button>
          </form>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-4 pb-2 md:hidden" aria-label="Admin">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className="whitespace-nowrap rounded-lg border border-line px-2.5 py-1 text-xs font-medium">
              {n.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-5">{children}</main>
    </div>
  )
}
