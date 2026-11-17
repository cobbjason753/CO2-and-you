import { handleEnroll } from '@/lib/ingest'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim()
  const raw = await req.text()
  if (raw.length > 4096) return Response.json({ error: 'too_large' }, { status: 413 })
  const r = await handleEnroll(raw, ip)
  return Response.json(r.body, { status: r.status })
}
