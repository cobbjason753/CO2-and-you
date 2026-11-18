import { q } from '@/lib/db'
import { env } from '@/lib/env'
import { Card, PageHeader, Badge, Notice } from '@/components/ui'

export const metadata = { title: 'Emails' }

export default async function EmailsPage() {
  const rows = await q<any>('SELECT id, to_email, subject, kind, created_at, sent_at, error, text_body FROM email_outbox ORDER BY id DESC LIMIT 100')
  return (
    <div className="space-y-4">
      <PageHeader title="Email outbox" sub="Everything the platform emails, newest first." />
      {!env.resendKey() && <Notice tone="warn">No email provider is configured (RESEND_API_KEY), so nothing is actually sent. Links in these emails can be copied from here for testing.</Notice>}
      <Card>
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.id} className="py-2.5">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-sm">
                  <span><b>{r.subject}</b> → {r.to_email} <Badge>{r.kind}</Badge></span>
                  <span className="text-xs text-muted">{new Date(r.created_at).toLocaleString('en-US')} {r.sent_at ? <Badge tone="good">sent</Badge> : r.error ? <Badge tone="poor">failed</Badge> : <Badge>not sent</Badge>}</span>
                </summary>
                <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-xs">{r.text_body}</pre>
                {r.error && <p className="text-xs text-danger">{r.error}</p>}
              </details>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
