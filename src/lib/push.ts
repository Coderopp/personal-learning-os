import { api } from './api'

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
/** iOS/iPadOS only deliver web push to apps installed on the home screen. */
export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true

export function registerServiceWorker() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(e => console.warn('service worker', e))
}

const deviceLabel = () => {
  const ua = navigator.userAgent
  const device = isIOS() ? (/iPad|MacIntel/.test(ua + navigator.platform) ? 'iPad' : 'iPhone') : /Android/.test(ua) ? (/Mobile/.test(ua) ? 'Android phone' : 'Android tablet') : /Windows/.test(ua) ? 'Windows PC' : /Mac/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux PC' : 'Device'
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'browser'
  return `${device} · ${browser}`
}

const keyBytes = (b64u: string) => Uint8Array.from(atob(b64u.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64u.length + 3) % 4)), c => c.charCodeAt(0))

export async function currentSubscription() {
  if (!pushSupported()) return null
  const reg = await navigator.serviceWorker.getRegistration()
  return (await reg?.pushManager.getSubscription()) ?? null
}

export async function enableReminders() {
  if (!pushSupported()) throw new Error('This browser does not support notifications.')
  if (isIOS() && !isStandalone()) throw new Error('On iPad/iPhone, add Learning OS to your Home Screen first (Share → Add to Home Screen), then turn reminders on from the installed app.')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notifications are blocked for this site. Allow them in the browser\'s site settings.')
  const { key, configured } = await api<{ key: string | null; configured: boolean }>('/push/key')
  if (!key || !configured) throw new Error('Reminders are not configured on the server yet (VAPID keys).')
  const reg = await navigator.serviceWorker.ready
  const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) })
  await api('/push/subscribe', { body: { subscription: sub.toJSON(), label: deviceLabel() } })
  return sub
}

export async function disableReminders() {
  const sub = await currentSubscription()
  if (!sub) return
  await api('/push/unsubscribe', { body: { endpoint: sub.endpoint } })
  await sub.unsubscribe()
}
