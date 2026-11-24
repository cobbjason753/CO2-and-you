import { requireHouse } from '@/lib/houses'
import { weeklySummary } from '@/lib/reports'
import { fmtTemp } from '@/lib/units'
import { Card, PageHeader, Table, Empty } from '@/components/ui'
import { ActionForm } from '@/components/forms'
import { setWeeklyReport, sendReportNow, setDailyReport, sendDailyReportNow } from '../actions'
import { buttonClass } from '@/components/ui'

export const metadata = { title: 'Reports' }

export default async function ReportsPage() {
  const { house, user } = await requireHouse()
  const rows = await weeklySummary(house.id, new Date())
  return (
    <div className="space-y-4">
      <PageHeader title="Weekly report" sub="A daily email each morning with what to do, a CO2 chart and every room's numbers, plus a weekly summary on Mondays." />
      <Card title="Daily report">
        <p className="mb-3 text-sm text-muted">
          Sent every morning after 7 am ({house.timezone.replace(/_/g, ' ')} time) for each of your houses: what to do, CO2 over the last 24 hours, and each room compared with its past week.
        </p>
        <ActionForm action={setDailyReport} submit="Save" inline size="sm">
          <label className="flex items-center gap-2 self-center">
            <input type="checkbox" name="on" defaultChecked={user.daily_report} className="size-4 accent-[var(--brand)]" /> Email me the daily report
          </label>
        </ActionForm>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <a href="/app/reports/daily" target="_blank" rel="noopener" className={buttonClass('secondary', 'sm')}>
            View today&apos;s report
          </a>
          <ActionForm action={sendDailyReportNow} submit="Email it to me now" kind="ghost" size="sm" />
        </div>
      </Card>

      <Card title="Email me the weekly report">
        <ActionForm action={setWeeklyReport} submit="Save" inline size="sm">
          <label className="flex items-center gap-2 self-center">
            <input type="checkbox" name="on" defaultChecked={user.weekly_report} className="size-4 accent-[var(--brand)]" /> Send to {user.email}
          </label>
        </ActionForm>
      </Card>
      <Card title={`Last 7 days · ${house.name}`} action={<ActionForm action={sendReportNow} submit="Email me this now" kind="secondary" size="sm" />}>
        {rows.length === 0 ? (
          <Empty title="No readings in the last 7 days" />
        ) : (
          <Table head={['Room', 'Average CO2', 'Peak', 'Hours ≥ 1000 ppm', 'Avg temp', 'Avg humidity']}>
            {rows.map((r) => (
              <tr key={r.name} className="tabular">
                <td className="font-medium">{r.name}</td>
                <td>{r.avg} ppm</td>
                <td>{r.max} ppm</td>
                <td>{r.hoursAbove1000}</td>
                <td>{fmtTemp(r.avgTempC, user.temp_unit)}</td>
                <td>{r.avgHum.toFixed(0)}%</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  )
}
