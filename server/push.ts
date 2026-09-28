import type { Env } from './env'
import { all, nowIso, run } from './db'

// Web Push without a third-party service: VAPID (RFC 8292) auth + aes128gcm payload encryption (RFC 8291),
// all with WebCrypto so it runs inside the Worker.

const enc = new TextEncoder()
const b64u = {
  encode: (buf: ArrayBuffer | Uint8Array) => {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
    let s = ''
    for (const b of bytes) s += String.fromCharCode(b)
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  },
  decode: (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0)),
}
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8))
}

/** aes128gcm-encrypt `payload` for one subscription (single record). */
export async function encryptPayload(payload: string, p256dh: string, auth: string) {
  const uaPublic = b64u.decode(p256dh)
  const authSecret = b64u.decode(auth)
  const asKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey) as ArrayBuffer)
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  // WebCrypto's field is `public`; workers-types spells it `$public`, so cast to the spec shape.
  const ecdh = { name: 'ECDH', public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm
  const shared = new Uint8Array(await crypto.subtle.deriveBits(ecdh, asKeys.privateKey, 256))

  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12)

  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const plaintext = concat(enc.encode(payload), new Uint8Array([2])) // 0x02 = last record
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plaintext))

  const rs = new Uint8Array(4)
  new DataView(rs.buffer).setUint32(0, 4096)
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ciphertext)
}

/** ES256-signed VAPID JWT for the push service's origin. */
export async function vapidJwt(endpoint: string, publicKey: string, privateD: string, subject: string) {
  const pub = b64u.decode(publicKey)
  const jwk = { kty: 'EC', crv: 'P-256', d: privateD, x: b64u.encode(pub.slice(1, 33)), y: b64u.encode(pub.slice(33, 65)), ext: true }
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const header = b64u.encode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = b64u.encode(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject,
  })))
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`))
  return `${header}.${claims}.${b64u.encode(sig)}`
}

export interface Subscription { endpoint: string; p256dh: string; auth: string }
export interface Notice { title: string; body: string; url: string; tag?: string }

/** Send one notification. Returns 'gone' when the browser unsubscribed (404/410) so the row can be removed. */
export async function sendPush(env: Env, sub: Subscription, notice: Notice): Promise<'ok' | 'gone' | 'failed'> {
  if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY) return 'failed'
  const jwt = await vapidJwt(sub.endpoint, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY, env.VAPID_SUBJECT ?? 'https://github.com/Coderopp/personal-learning-os')
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
      'content-encoding': 'aes128gcm',
      'content-type': 'application/octet-stream',
      ttl: String(6 * 3600), // an evening nudge is useless tomorrow
      urgency: 'normal',
    },
    body: await encryptPayload(JSON.stringify(notice), sub.p256dh, sub.auth),
  })
  if (res.status === 404 || res.status === 410) return 'gone'
  if (!res.ok) { console.error('push failed', res.status, (await res.text()).slice(0, 200)); return 'failed' }
  return 'ok'
}

/** Send to every enabled device; prune subscriptions the browser has dropped. */
export async function broadcast(env: Env, notice: Notice) {
  const subs = await all<Subscription>(env, 'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE enabled = 1')
  const results = await Promise.all(subs.map(async s => {
    const r = await sendPush(env, s, notice).catch(() => 'failed' as const)
    if (r === 'gone') await run(env, 'DELETE FROM push_subscriptions WHERE endpoint = ?', s.endpoint)
    if (r === 'ok') await run(env, 'UPDATE push_subscriptions SET last_sent_at = ? WHERE endpoint = ?', nowIso(), s.endpoint)
    return r
  }))
  return { sent: results.filter(r => r === 'ok').length, devices: subs.length }
}
