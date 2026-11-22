'use client'

import Link from 'next/link'
import { useEffect, useState, useTransition } from 'react'
import { buttonClass, cx } from '@/components/ui'
import type { FormState } from '@/components/forms'

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true
}
function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

/** Captures the browser's install prompt (Chrome/Android/Edge) so we can show our own button. */
function useInstall() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(false)
  const [ios, setIos] = useState(false)
  useEffect(() => {
    setInstalled(isStandalone())
    setIos(isIOS())
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setPrompt(e as InstallPromptEvent)
    }
    const onInstalled = () => setInstalled(true)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])
  const install = async () => {
    if (!prompt) return
    await prompt.prompt()
    await prompt.userChoice
    setPrompt(null)
  }
  return { prompt, installed, ios, install }
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" className="inline -mt-1" aria-label="Share">
      <path d="M12 3v12M7 8l5-5 5 5M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function AppSetup({
  vapidKey,
  enablePush,
  disablePush,
  testPush,
}: {
  vapidKey: string
  enablePush: (sub: any) => Promise<FormState>
  disablePush: (endpoint: string) => Promise<FormState>
  testPush: () => Promise<FormState>
}) {
  const { prompt, installed, ios, install } = useInstall()
  const [push, setPush] = useState<'loading' | 'unsupported' | 'needs-install' | 'blocked' | 'off' | 'on'>('loading')
  const [msg, setMsg] = useState<FormState>(null)
  const [pending, start] = useTransition()

  useEffect(() => {
    ;(async () => {
      const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
      if (!supported) return setPush(isIOS() && !isStandalone() ? 'needs-install' : 'unsupported')
      if (Notification.permission === 'denied') return setPush('blocked')
      const reg = await navigator.serviceWorker.getRegistration('/')
      const sub = await reg?.pushManager.getSubscription()
      setPush(sub ? 'on' : 'off')
    })().catch(() => setPush('unsupported'))
  }, [])

  const turnOn = () =>
    start(async () => {
      setMsg(null)
      try {
        const permission = await Notification.requestPermission()
        if (permission !== 'granted') {
          setPush(permission === 'denied' ? 'blocked' : 'off')
          return
        }
        const reg = (await navigator.serviceWorker.getRegistration('/')) ?? (await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }))
        await navigator.serviceWorker.ready
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey) })
        const res = await enablePush(JSON.parse(JSON.stringify(sub)))
        setMsg(res)
        setPush(res?.error ? 'off' : 'on')
      } catch {
        setMsg({ error: 'Couldn’t turn on notifications in this browser.' })
      }
    })

  const turnOff = () =>
    start(async () => {
      setMsg(null)
      const reg = await navigator.serviceWorker.getRegistration('/')
      const sub = await reg?.pushManager.getSubscription()
      if (sub) {
        await disablePush(sub.endpoint)
        await sub.unsubscribe()
      }
      setPush('off')
      setMsg({ ok: 'Notifications are off for this device. You still get alert emails.' })
    })

  const test = () => start(async () => setMsg(await testPush()))

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Install the app</h3>
        {installed ? (
          <p className="mt-1 text-sm text-good">Installed — you&apos;re using the CobSci app.</p>
        ) : prompt ? (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button type="button" onClick={install} className={buttonClass('primary', 'sm')}>
              Install CobSci
            </button>
            <span className="text-xs text-muted">Adds CobSci to your home screen. No app store needed.</span>
          </div>
        ) : ios ? (
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm">
            <li>Open this page in <b>Safari</b>.</li>
            <li>
              Tap <b>Share</b> <ShareIcon /> at the bottom of the screen.
            </li>
            <li>
              Choose <b>Add to Home Screen</b>, then <b>Add</b>.
            </li>
          </ol>
        ) : (
          <p className="mt-1 text-sm text-muted">
            On your phone, open app.cobsci.com and choose <b>Install app</b> or <b>Add to Home screen</b> from the browser menu.
          </p>
        )}
      </div>

      {vapidKey && (
        <div className="border-t border-line pt-4">
          <h3 className="text-sm font-semibold">Notifications on this device</h3>
          <p className="mt-1 text-xs text-muted">High CO2 and sensor-offline alerts, as well as the email.</p>
          <div className="mt-2">
            {push === 'loading' && <p className="text-sm text-muted">Checking…</p>}
            {push === 'unsupported' && <p className="text-sm text-muted">This browser can&apos;t show notifications.</p>}
            {push === 'needs-install' && <p className="text-sm">On iPhone, install the app first (above), then open it from your home screen and turn notifications on here.</p>}
            {push === 'blocked' && (
              <p className="text-sm">Notifications are blocked for CobSci. Allow them in your phone or browser settings, then come back here.</p>
            )}
            {(push === 'off' || push === 'on') && (
              <div className="flex flex-wrap items-center gap-2">
                {push === 'off' ? (
                  <button type="button" disabled={pending} onClick={turnOn} className={buttonClass('primary', 'sm')}>
                    {pending ? 'Working…' : 'Turn on notifications'}
                  </button>
                ) : (
                  <>
                    <span className="text-sm font-medium text-good">On</span>
                    <button type="button" disabled={pending} onClick={test} className={buttonClass('secondary', 'sm')}>
                      Send a test
                    </button>
                    <button type="button" disabled={pending} onClick={turnOff} className={buttonClass('ghost', 'sm')}>
                      Turn off
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      {msg?.error && <p role="alert" className="text-sm font-medium text-danger">{msg.error}</p>}
      {msg?.ok && <p role="status" className="text-sm text-good">{msg.ok}</p>}
    </div>
  )
}

/** Small "Get the app" prompt for phones that haven't installed it. Dismissal is remembered on this device. */
export function InstallBanner() {
  const [show, setShow] = useState(false)
  useEffect(() => {
    try {
      if (isStandalone() || !window.matchMedia('(pointer: coarse)').matches) return
      if (localStorage.getItem('cobsci-install-dismissed')) return
    } catch {
      return
    }
    setShow(true)
  }, [])
  if (!show) return null
  const dismiss = () => {
    try {
      localStorage.setItem('cobsci-install-dismissed', '1')
    } catch {}
    setShow(false)
  }
  return (
    <div className={cx('flex items-center gap-3 rounded-2xl border border-brand/30 bg-brand-soft/50 px-4 py-3')}>
      <img src="/icons/icon-192.png" alt="" width={36} height={36} className="rounded-lg" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold">Get the CobSci app</p>
        <p className="text-xs text-muted">Home-screen app with alert notifications.</p>
      </div>
      <Link href="/app/account#app" className={buttonClass('primary', 'sm')}>
        Set up
      </Link>
      <button type="button" onClick={dismiss} aria-label="Dismiss" className="px-1 text-lg leading-none text-muted">
        ×
      </button>
    </div>
  )
}
