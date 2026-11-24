import Link from 'next/link'
import { q } from '@/lib/db'
import { Card, PageHeader } from '@/components/ui'
import { Flasher } from '@/components/admin/flasher'
import { registerFlashedBoard } from '../../actions'

export const metadata = { title: 'Flash & register' }

export default async function FlashPage() {
  // Releases built by the GitHub workflow (linked by URL) have a factory image from v11 on.
  const versions = await q<{ version: number; stage: string }>(
    `SELECT version, stage FROM firmware_releases WHERE url IS NOT NULL AND stage IN ('general','pilot') ORDER BY (stage = 'general') DESC, version DESC`,
  )
  return (
    <div className="space-y-4">
      <PageHeader
        title="Flash & register"
        sub="Set up a new board in about a minute: wipe it, install the firmware with the right 16 MB layout, test its sensor and screen, register it and print its label."
        action={<Link href="/admin/provisioning" className="text-sm text-brand">Back to Provisioning</Link>}
      />
      <Card className="no-print">
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>Use <b>Chrome or Edge</b> on a computer. Plug the board in with a USB <b>data</b> cable.</li>
          <li>Click <b>Flash a board</b> and pick the board&apos;s port (usually “USB JTAG/serial debug unit”, or CP210x / CH340 on boards with a separate USB chip).</li>
          <li>Wait for “Done”. The board is wiped, flashed, restarted and checked: its <b>CO2 sensor</b> must give a real measurement (firmware v12 and later) and its <b>screen</b> must be found to pass.</li>
          <li>Print the label, stick it on the board and box, unplug, next board.</li>
        </ol>
        <p className="mt-3 text-xs text-muted">
          If it says it can&apos;t connect, hold the board&apos;s <b>BOOT</b> button, press and release <b>RST</b>, release BOOT, and try again. Re-flashing a board that&apos;s
          already registered (for example to fix its partition layout) keeps it in its house; it just gets a new key.
        </p>
      </Card>
      <Card>
        <Flasher versions={versions} register={registerFlashedBoard} />
      </Card>
    </div>
  )
}
