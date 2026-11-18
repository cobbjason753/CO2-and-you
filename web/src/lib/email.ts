import { q, one, type Db } from './db'
import { env, BRAND } from './env'

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export type EmailBlock = { p?: string; button?: { label: string; url: string }; html?: string; small?: string }

/** Plain, readable layout that works in every mail client. */
export function renderEmail(title: string, blocks: EmailBlock[]) {
  const htmlBlocks = blocks
    .map((b) => {
      if (b.p) return `<p style="margin:0 0 16px;line-height:1.5">${esc(b.p)}</p>`
      if (b.button)
        return `<p style="margin:24px 0"><a href="${esc(b.button.url)}" style="background:#0f766e;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">${esc(b.button.label)}</a></p>`
      if (b.small) return `<p style="margin:0 0 12px;color:#64748b;font-size:13px;line-height:1.5">${esc(b.small)}</p>`
      return b.html ?? ''
    })
    .join('\n')
  const html = `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
<div style="max-width:560px;margin:0 auto;padding:24px">
<div style="font-weight:700;font-size:18px;color:#0f766e;margin-bottom:16px">${esc(BRAND)}</div>
<div style="background:#fff;border-radius:12px;padding:28px">
<h1 style="font-size:20px;margin:0 0 16px">${esc(title)}</h1>
${htmlBlocks}
</div>
<p style="color:#94a3b8;font-size:12px;margin-top:16px">${esc(BRAND)} · cobsci.com</p>
</div></body></html>`
  const text = [title, '', ...blocks.map((b) => b.p ?? (b.button ? `${b.button.label}: ${b.button.url}` : b.small ?? '')).filter(Boolean)].join('\n\n')
  return { html, text }
}

/**
 * Every email is written to the outbox first (so staff can see what went out),
 * then sent through Resend if RESEND_API_KEY is set.
 */
export async function sendEmail(
  to: string,
  subject: string,
  title: string,
  blocks: EmailBlock[],
  kind = '',
  c?: Db,
): Promise<number> {
  const { html, text } = renderEmail(title, blocks)
  const row = await one<{ id: number }>(
    'INSERT INTO email_outbox (to_email, subject, html, text_body, kind) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [to, subject, html, text, kind],
    c,
  )
  const id = row!.id
  // Inside a transaction we only queue; deliverOutbox() picks it up after commit.
  if (!c) await deliver(id)
  return id
}

async function deliver(id: number) {
  const key = env.resendKey()
  if (!key) return
  const m = await one('SELECT * FROM email_outbox WHERE id = $1 AND sent_at IS NULL', [id])
  if (!m) return
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.emailFrom(), to: [m.to_email], subject: m.subject, html: m.html, text: m.text_body }),
    })
    const body = await res.json().catch(() => ({}))
    if (res.ok) await q('UPDATE email_outbox SET sent_at = now(), provider_id = $2, error = NULL WHERE id = $1', [id, body.id ?? null])
    else await q('UPDATE email_outbox SET error = $2 WHERE id = $1', [id, JSON.stringify(body).slice(0, 500)])
  } catch (e) {
    await q('UPDATE email_outbox SET error = $2 WHERE id = $1', [id, String(e).slice(0, 500)])
  }
}

/** Sends anything queued in a transaction or that failed earlier (retries for 24 h). */
export async function deliverOutbox(limit = 50) {
  if (!env.resendKey()) return 0
  const rows = await q<{ id: number }>(
    `SELECT id FROM email_outbox WHERE sent_at IS NULL AND created_at > now() - interval '24 hours' ORDER BY id LIMIT $1`,
    [limit],
  )
  for (const r of rows) await deliver(r.id)
  return rows.length
}
