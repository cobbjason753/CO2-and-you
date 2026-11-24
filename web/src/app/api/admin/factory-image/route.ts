import { requireStaff } from '@/lib/auth'
import { one } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * Staff only: the factory image (bootloader + partition table + app) for a release, fetched from
 * its GitHub Release and passed to the browser flasher (GitHub's download links don't allow
 * browser requests from other sites).
 */
export async function GET(req: Request) {
  await requireStaff()
  const v = parseInt(new URL(req.url).searchParams.get('v') ?? '', 10)
  const rel = await one<{ url: string | null }>(`SELECT url FROM firmware_releases WHERE version = $1 AND stage <> 'retired'`, [Number.isFinite(v) ? v : -1])
  if (!rel?.url || !/\/firmware-v\d+\.bin$/.test(rel.url)) return new Response('No factory image for this release', { status: 404 })
  const factoryUrl = rel.url.replace(/\.bin$/, '-factory.bin')
  const res = await fetch(factoryUrl, { redirect: 'follow' })
  if (!res.ok) return new Response('This release has no factory image (releases before the factory-image change). Publish a new release.', { status: 404 })
  const buf = Buffer.from(await res.arrayBuffer())
  // Sanity checks: starts with an ESP image header (0xE9) and has the app at 0x10000.
  if (buf.length < 0x10000 + 1024 || buf[0] !== 0xe9 || buf[0x10000] !== 0xe9) return new Response('Factory image looks wrong', { status: 502 })
  return new Response(new Uint8Array(buf), {
    headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(buf.length), 'Cache-Control': 'private, max-age=3600', 'X-Firmware-Version': String(v) },
  })
}
