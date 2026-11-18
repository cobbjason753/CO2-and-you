import Link from 'next/link'
import { Logo } from '@/components/logo'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <Link href="/" className="mb-6 flex items-center gap-2 text-lg font-bold text-brand">
        <Logo /> CO2 &amp; You
      </Link>
      <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm">{children}</div>
    </main>
  )
}

