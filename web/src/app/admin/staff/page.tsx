import { q } from '@/lib/db'
import { requireStaff } from '@/lib/auth'
import { Card, PageHeader, Field, Input, Select, Table } from '@/components/ui'
import { ActionForm } from '@/components/forms'
import { setRole } from '../actions'

export const metadata = { title: 'Staff' }

export default async function StaffPage() {
  await requireStaff({ adminOnly: true })
  const staff = await q<any>(`SELECT email, name, role, totp_enabled, last_login_at FROM users WHERE role <> 'customer' ORDER BY role, email`)
  return (
    <div className="space-y-4">
      <PageHeader title="Staff" sub="Staff can use the admin area; admins can also manage staff. Two-step verification is required." />
      <Card>
        <Table head={['Email', 'Name', 'Role', '2FA', 'Last login']}>
          {staff.map((s) => <tr key={s.email}><td>{s.email}</td><td>{s.name}</td><td>{s.role}</td><td>{s.totp_enabled ? 'on' : 'not set up'}</td><td className="text-xs">{s.last_login_at ? new Date(s.last_login_at).toLocaleString('en-US') : 'never'}</td></tr>)}
        </Table>
      </Card>
      <Card title="Change someone's role">
        <ActionForm action={setRole} submit="Save" inline>
          <div className="min-w-60 flex-1"><Field label="Email"><Input name="email" type="email" required /></Field></div>
          <Field label="Role"><Select name="role"><option value="staff">Staff</option><option value="admin">Admin</option><option value="customer">Customer (remove access)</option></Select></Field>
        </ActionForm>
      </Card>
    </div>
  )
}
