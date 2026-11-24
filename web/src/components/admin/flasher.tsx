'use client'

import { useEffect, useRef, useState } from 'react'
import { buttonClass, cx } from '@/components/ui'
import { LabelSheet } from '@/components/admin/provision-form'
import { parseBootLog, type BootInfo } from '@/lib/boot-log'
import type { FlashResult } from '@/app/admin/actions'

type Step = 'idle' | 'connecting' | 'downloading' | 'erasing' | 'writing' | 'restarting' | 'reading' | 'registering' | 'done' | 'error'

const STEP_TEXT: Record<Step, string> = {
  idle: '',
  connecting: 'Connecting to the board…',
  downloading: 'Downloading the factory image…',
  erasing: 'Erasing the board (about 20–40 seconds)…',
  writing: 'Writing firmware…',
  restarting: 'Restarting the board…',
  reading: 'Reading the board’s ID, key and sensors…',
  registering: 'Registering…',
  done: 'Done',
  error: 'Stopped',
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Same physical board after it restarts: native-USB boards disappear and come back as a new port object. */
async function findPort(vid?: number, pid?: number): Promise<SerialPort | null> {
  const ports = await navigator.serial.getPorts()
  return ports.find((p) => {
    const i = p.getInfo()
    return i.usbVendorId === vid && i.usbProductId === pid
  }) ?? null
}

export function Flasher({
  versions,
  register,
}: {
  versions: { version: number; stage: string }[]
  register: (input: { deviceId: string; secret: string; fw: number | null; sensorFound: boolean; screenFound: boolean; notes?: string }) => Promise<FlashResult>
}) {
  const [supported, setSupported] = useState<boolean | null>(null)
  const [version, setVersion] = useState<number | null>(versions[0]?.version ?? null)
  const [notes, setNotes] = useState('')
  const [step, setStep] = useState<Step>('idle')
  const [progress, setProgress] = useState(0)
  const [log, setLog] = useState('')
  const [boot, setBoot] = useState<BootInfo | null>(null)
  const [hint, setHint] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState<FlashResult | null>(null)
  const [count, setCount] = useState(0)
  const logRef = useRef<HTMLPreElement>(null)

  useEffect(() => setSupported(typeof navigator !== 'undefined' && 'serial' in navigator), [])
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [log])

  const append = (s: string) => setLog((l) => (l + s).slice(-20000))

  /** Listens to the board's serial output until the boot info is complete (or time runs out). */
  async function readBoot(first: SerialPort, vid?: number, pid?: number): Promise<BootInfo> {
    let text = ''
    let port: SerialPort | null = first
    const started = Date.now()
    const deadline = started + 45_000
    let hinted = false
    let resetDone = false
    while (Date.now() < deadline) {
      if (!port) {
        await sleep(250)
        port = await findPort(vid, pid)
        continue
      }
      try {
        if (!port.readable) await port.open({ baudRate: 115200 })
        if (!resetDone) {
          // Reset into the new firmware while we're already listening, so no start-up lines are missed.
          resetDone = true
          await port.setSignals({ dataTerminalReady: false, requestToSend: true })
          await sleep(120)
          await port.setSignals({ dataTerminalReady: false, requestToSend: false })
        }
        const reader = port.readable!.getReader()
        const decoder = new TextDecoder()
        try {
          let pending = reader.read()
          while (Date.now() < deadline) {
            // Wait for data without cancelling the read (cancelling can drop bytes).
            const r = await Promise.race([pending, sleep(1500).then(() => null)])
            if (r === null) {
              if (!hinted && Date.now() - started > 12_000) {
                hinted = true
                setHint('Not hearing from the board yet. Press its RST (reset) button once.')
              }
              continue
            }
            if (r.done) break
            if (r.value) {
              const chunk = decoder.decode(r.value, { stream: true })
              text += chunk
              append(chunk)
              const info = parseBootLog(text)
              setBoot(info)
              if (info.complete) return info
            }
            pending = reader.read()
          }
        } finally {
          await reader.cancel().catch(() => {})
          reader.releaseLock()
        }
      } catch {
        // Native-USB boards disconnect when they restart; wait for the port to come back.
        try {
          await port?.close()
        } catch {}
        port = null
      }
    }
    const info = parseBootLog(text)
    if (!info.complete) throw new Error('Didn’t get the board’s ID and key from its start-up log. Press RST on the board and use “Read again”.')
    return info
  }

  async function flash() {
    setError('')
    setResult(null)
    setBoot(null)
    setLog('')
    setHint('')
    setProgress(0)
    let port: SerialPort
    try {
      port = await navigator.serial.requestPort()
    } catch {
      return // user closed the picker
    }
    const { usbVendorId: vid, usbProductId: pid } = port.getInfo()
    const { ESPLoader, Transport } = await import('esptool-js')
    let transport: InstanceType<typeof Transport> | null = null
    try {
      setStep('downloading')
      const res = await fetch(`/api/admin/factory-image?v=${version}`)
      if (!res.ok) throw new Error(await res.text())
      const image = new Uint8Array(await res.arrayBuffer())

      setStep('connecting')
      transport = new Transport(port, false)
      const terminal = { clean: () => {}, writeLine: (d: string) => append(d + '\n'), write: (d: string) => append(d) }
      const loader = new ESPLoader({ transport, baudrate: 921600, terminal })
      const chip = await loader.main()
      if (!/ESP32-S3/i.test(chip)) throw new Error(`This board is a ${chip}, not an ESP32-S3.`)

      setStep('erasing')
      await loader.writeFlash({
        fileArray: [{ data: image, address: 0 }],
        flashMode: 'keep',
        flashFreq: 'keep',
        flashSize: 'keep',
        eraseAll: true, // wipes the old key, settings and any other partition layout
        compress: true,
        reportProgress: (_i, written, total) => {
          setStep('writing')
          setProgress(Math.round((written / total) * 100))
        },
      })
      await transport.disconnect()
      transport = null

      setStep('restarting')
      await sleep(300)
      setStep('reading')
      const info = await readBoot(port, vid, pid)
      try {
        await port.close()
      } catch {}

      setStep('registering')
      const r = await register({ deviceId: info.deviceId!, secret: info.secret!, fw: info.fw, sensorFound: info.sensorFound, screenFound: info.screenFound, notes })
      setResult(r)
      if (!r.ok) throw new Error(r.error)
      setCount((n) => n + 1)
      setStep('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStep('error')
      try {
        await transport?.disconnect()
      } catch {}
      try {
        await port.close()
      } catch {}
    }
  }

  /** If the start-up log was missed: listen again (after pressing RST). */
  async function readAgain() {
    setError('')
    setHint('Press the board’s RST button now.')
    const ports = await navigator.serial.getPorts()
    const port = ports[0] ?? (await navigator.serial.requestPort().catch(() => null))
    if (!port) return
    const { usbVendorId: vid, usbProductId: pid } = port.getInfo()
    try {
      setStep('reading')
      const info = await readBoot(port, vid, pid)
      try {
        await port.close()
      } catch {}
      setStep('registering')
      const r = await register({ deviceId: info.deviceId!, secret: info.secret!, fw: info.fw, sensorFound: info.sensorFound, screenFound: info.screenFound, notes })
      setResult(r)
      if (!r.ok) throw new Error(r.error)
      setCount((n) => n + 1)
      setStep('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStep('error')
    }
  }

  if (supported === false)
    return (
      <p className="rounded-xl border border-fair/40 bg-fair-soft px-4 py-3 text-sm">
        Flashing needs <b>Chrome or Edge on a computer</b> (Windows, Mac, Linux or ChromeOS). Safari, Firefox and phones can&apos;t talk to USB devices.
      </p>
    )
  if (!versions.length)
    return <p className="text-sm text-muted">No firmware release yet. Add one in Admin › Firmware first.</p>

  const busy = !['idle', 'done', 'error'].includes(step)
  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block font-medium">Firmware</span>
          <select value={version ?? ''} onChange={(e) => setVersion(Number(e.target.value))} disabled={busy} className="rounded-xl border border-line bg-surface px-3 py-2.5">
            {versions.map((v) => (
              <option key={v.version} value={v.version}>
                v{v.version} ({v.stage})
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-48 flex-1 text-sm">
          <span className="mb-1 block font-medium">Batch notes (optional)</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} disabled={busy} placeholder="e.g. JLCPCB batch 2026-12" className="block w-full rounded-xl border border-line bg-surface px-3 py-2.5" />
        </label>
        <button type="button" onClick={flash} disabled={busy || !version} className={buttonClass('primary')}>
          {step === 'done' ? 'Flash next board' : 'Flash a board'}
        </button>
      </div>

      {step !== 'idle' && (
        <div className="no-print rounded-xl border border-line bg-surface-2 p-4">
          <p className={cx('text-sm font-semibold', step === 'error' ? 'text-danger' : step === 'done' ? 'text-good' : '')}>{STEP_TEXT[step]}</p>
          {step === 'writing' && (
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-line">
              <div className="h-full bg-brand transition-all" style={{ width: `${progress}%` }} />
            </div>
          )}
          {hint && step === 'reading' && <p className="mt-2 text-sm text-fair">{hint}</p>}
          {boot && (
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
              <dt className="text-muted">DEVICE_ID</dt>
              <dd className="font-mono text-xs">{boot.deviceId ?? '…'}</dd>
              <dt className="text-muted">Key</dt>
              <dd>{boot.secret ? 'received' : '…'}</dd>
              <dt className="text-muted">CO2 sensor (0x62)</dt>
              <dd className={boot.scanDone ? (boot.sensorFound ? 'text-good' : 'font-semibold text-danger') : ''}>{boot.scanDone ? (boot.sensorFound ? '✓ found' : '✕ not found') : '…'}</dd>
              <dt className="text-muted">Screen (0x3C)</dt>
              <dd className={boot.screen !== null ? (boot.screenFound ? 'text-good' : 'font-semibold text-danger') : ''}>{boot.screen !== null ? (boot.screenFound ? '✓ found' : '✕ not found') : '…'}</dd>
            </dl>
          )}
          {error && <p className="mt-2 text-sm font-medium text-danger">{error}</p>}
          {step === 'error' && (
            <button type="button" onClick={readAgain} className={cx(buttonClass('secondary', 'sm'), 'mt-2')}>
              Read again (after pressing RST)
            </button>
          )}
          {result?.ok && (
            <p className={cx('mt-2 text-sm', result.testResult === 'pass' ? 'text-good' : 'font-semibold text-danger')}>
              <b>{result.deviceId}</b> — {result.message}
            </p>
          )}
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-muted">Show the board&apos;s log</summary>
            <pre ref={logRef} className="mt-2 max-h-64 overflow-auto rounded-lg bg-ink p-3 text-[11px] leading-snug text-surface">{log || '…'}</pre>
          </details>
        </div>
      )}

      {result?.ok && result.label && <LabelSheet labels={[result.label]} />}
      {count > 0 && <p className="no-print text-xs text-muted">{count} board{count === 1 ? '' : 's'} flashed this session.</p>}
    </div>
  )
}
