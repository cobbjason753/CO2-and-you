import type { MetadataRoute } from 'next'

// Makes the portal installable ("Add to Home Screen" / "Install app").
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/app',
    name: 'CobSci',
    short_name: 'CobSci',
    description: 'Indoor air quality, room by room, from your CO2 & You sensors.',
    start_url: '/app?source=app',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f4f6f8',
    theme_color: '#0f766e',
    categories: ['health', 'lifestyle', 'utilities'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'History', url: '/app/history', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Alerts', url: '/app/alerts', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
    ],
  }
}
