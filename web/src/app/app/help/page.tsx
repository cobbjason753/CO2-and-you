import { houseContext } from '@/lib/houses'
import { Card, PageHeader, Field, Input, Textarea } from '@/components/ui'
import { ActionForm } from '@/components/forms'
import { contactSupport } from '../actions'

export const metadata = { title: 'Help' }

const LEVELS = [
  { range: '400–800 ppm', tone: 'bg-good-soft text-good', label: 'Good', text: 'Close to outdoor air (about 420 ppm). Nothing to do.' },
  { range: '800–1000 ppm', tone: 'bg-fair-soft text-fair', label: 'Fair', text: 'Air is getting stale. Fine for a while; consider a little fresh air.' },
  { range: '1000–1400 ppm', tone: 'bg-poor-soft text-poor', label: 'Poor', text: 'Many people notice drowsiness and poorer concentration. Open a window or door, or run ventilation.' },
  { range: '1400+ ppm', tone: 'bg-poor-soft text-poor', label: 'Poor', text: 'Ventilate now. Common in closed bedrooms overnight and crowded rooms.' },
]

export default async function HelpPage() {
  const { house } = await houseContext()
  return (
    <div className="space-y-4">
      <PageHeader title="Help" />

      <Card title="What the CO2 numbers mean" className="scroll-mt-20">
        <div id="co2" />
        <p className="mb-3 text-sm text-muted">
          CO2 (carbon dioxide) is what we breathe out. Indoors it builds up when a room has people in it and not enough fresh air, so it&apos;s a good stand-in for how
          stale the air is.
        </p>
        <ul className="space-y-2">
          {LEVELS.map((l) => (
            <li key={l.range} className="flex gap-3 text-sm">
              <span className={`w-28 shrink-0 rounded-lg px-2 py-1 text-center font-semibold ${l.tone}`}>{l.range}</span>
              <span>{l.text}</span>
            </li>
          ))}
        </ul>
        <h3 className="mt-4 font-semibold">Practical fixes</h3>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
          <li>Crack a bedroom window or leave the door open at night — the biggest win for most homes.</li>
          <li>Run the bathroom or kitchen extractor fan, or set your HVAC fan to &quot;on&quot; rather than &quot;auto&quot;.</li>
          <li>Open windows on opposite sides of the house for 5–10 minutes to swap the air quickly.</li>
          <li>Air purifiers remove particles but not CO2; fresh air is the only fix.</li>
        </ul>
      </Card>

      <Card title="Setting up a sensor" className="scroll-mt-20">
        <div id="setup" />
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>Plug it in where people spend time, about head height, away from windows, vents and your breath.</li>
          <li>The screen shows a QR code. Scan it with your phone camera to join the sensor&apos;s setup WiFi (or join the network shown on screen with the password shown).</li>
          <li>A setup page opens. Pick your home WiFi, enter its password and tap Save. 2.4 GHz networks only.</li>
          <li>Within 5 minutes the sensor appears on your Home page as &quot;Unnamed device&quot;. Give it a room name there or under Devices — the name also shows on the sensor&apos;s screen.</li>
        </ol>
        <p className="mt-2 text-sm text-muted">Changed your WiFi? Hold the button on the back for 5 seconds to reopen setup.</p>
      </Card>

      <Card title="Calibration" className="scroll-mt-20">
        <div id="calibration" />
        <p className="text-sm">
          The sensor recalibrates itself automatically by assuming it sees fresh air (about 420 ppm) at some point each week. For best accuracy, make sure the room gets
          a good airing at least once a week — open a window for 15 minutes. Readings in the first few days after setup can be a little high while it settles. If a
          sensor reads far above its neighbours for more than a week, contact us.
        </p>
      </Card>

      <Card title="Your privacy" className="scroll-mt-20">
        <div id="privacy" />
        <p className="text-sm">
          We collect CO2, temperature and humidity every 5 minutes, plus basic device health (firmware version, WiFi signal). These patterns can show when people are
          home, asleep or away, so only members of your household can see them, our staff only look when helping you, and we never sell your data. You can download
          or delete everything from your Account page.
        </p>
      </Card>

      <Card title="Contact support">
        <p className="mb-3 text-sm text-muted">
          {house ? `We'll automatically include your house (${house.name}) and the status of its sensors, so you don't need to look anything up.` : 'Tell us what you need.'}
        </p>
        {house && (
          <ActionForm action={contactSupport} submit="Send" resetOnOk>
            <Field label="Subject">
              <Input name="subject" maxLength={120} required />
            </Field>
            <Field label="Message">
              <Textarea name="body" rows={5} maxLength={5000} required />
            </Field>
          </ActionForm>
        )}
      </Card>
    </div>
  )
}
