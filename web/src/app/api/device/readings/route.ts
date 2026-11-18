import { handleReadings } from '@/lib/ingest'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim()
  const raw = await req.text()
  if (raw.length > 64_000) return Response.json({ error: 'too_large' }, { status: 413 })
  const r = await handleReadings(
    raw,
    { deviceId: req.headers.get('x-device-id'), ts: req.headers.get('x-timestamp'), sig: req.headers.get('x-signature') },
    ip,
  )
  return Response.json(r.body, { status: r.status })
}
