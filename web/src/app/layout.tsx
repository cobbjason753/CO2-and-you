import type { Metadata, Viewport } from 'next'
import './globals.css'
import { ServiceWorker } from '@/components/service-worker'

export const metadata: Metadata = {
  title: { default: 'CobSci', template: '%s · CobSci' },
  description: 'Indoor air quality, room by room, from your CO2 & You sensors.',
  applicationName: 'CobSci',
  appleWebApp: { capable: true, title: 'CobSci', statusBarStyle: 'default' },
  icons: {
    icon: [{ url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' }],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
  formatDetection: { telephone: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f6f8' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1220' },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        {children}
        <ServiceWorker />
      </body>
    </html>
  )
}
