import { one } from '@/lib/db'

export const dynamic = 'force-dynamic'

/** Serves an uploaded firmware build. Builds hosted elsewhere (GitHub Releases) are linked directly. */
export async function GET(_req: Request, ctx: { params: Promise<{ version: string }> }) {
  const { version } = await ctx.params
  const v = parseInt(version, 10)
  const row = await one<{ bin_data: Buffer | null; sha256: string }>(
    `SELECT bin_data, sha256 FROM firmware_releases WHERE version = $1 AND stage <> 'retired'`,
    [Number.isFinite(v) ? v : -1],
  )
  if (!row?.bin_data) return new Response('not found', { status: 404 })
  return new Response(new Uint8Array(row.bin_data), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(row.bin_data.length),
      'Content-Disposition': `attachment; filename="firmware-v${v}.bin"`,
      'X-Firmware-SHA256': row.sha256,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}
