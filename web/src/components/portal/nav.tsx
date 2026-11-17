'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cx } from '@/components/ui'

const ICONS: Record<string, React.ReactNode> = {
  home: <path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  history: <path d="M3 17l5-6 4 4 4-7 5 9M3 21h18" />,
  devices: <path d="M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm5 14h.01M9 7h6" />,
  alerts: <path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4zm4 4a2 2 0 0 0 4 0" />,
  more: <path d="M4 6h16M4 12h16M4 18h16" />,
}

export type NavItem = { href: string; label: string; icon?: keyof typeof ICONS; desktopOnly?: boolean }

function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ICONS[name]}
    </svg>
  )
}

const isActive = (path: string, href: string, root: string) => (href === root ? path === root : path.startsWith(href))

export function TopNav({ items, root }: { items: NavItem[]; root: string }) {
  const path = usePathname()
  return (
    <nav className="hidden gap-1 md:flex md:flex-wrap" aria-label="Main">
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          className={cx('rounded-lg px-3 py-2 text-sm font-medium', isActive(path, i.href, root) ? 'bg-brand-soft text-brand' : 'text-muted hover:text-ink')}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  )
}

/** Phone tab bar: the four main screens plus "More". */
export function BottomNav({ items, root }: { items: NavItem[]; root: string }) {
  const path = usePathname()
  return (
    <nav className="no-print fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label="Main">
      <div className="mx-auto flex max-w-lg">
        {items.map((i) => (
          <Link
            key={i.href}
            href={i.href}
            className={cx('flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium', isActive(path, i.href, root) ? 'text-brand' : 'text-muted')}
          >
            <Icon name={i.icon ?? 'more'} />
            {i.label}
          </Link>
        ))}
      </div>
    </nav>
  )
}
