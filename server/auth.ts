import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from './env'

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined

/**
 * Cloudflare Access sits in front of the whole site; this re-verifies its JWT so the API stays closed even if
 * Access is misconfigured. Fails closed: without ACCESS_* vars the API refuses unless DEV_NO_AUTH=1 (local only).
 */
export const requireAccess: MiddlewareHandler<AppEnv> = async (c, next) => {
  const env = c.env
  if (env.DEV_NO_AUTH === '1') {
    c.set('email', 'dev@local')
    return next()
  }
  if (!env.ACCESS_AUD || !env.ACCESS_TEAM_DOMAIN) {
    return c.json({ error: 'Server auth is not configured (ACCESS_AUD / ACCESS_TEAM_DOMAIN).' }, 503)
  }
  const token = c.req.header('cf-access-jwt-assertion')
  if (!token) return c.json({ error: 'Not signed in.' }, 401)
  try {
    const issuer = `https://${env.ACCESS_TEAM_DOMAIN}`
    jwks ??= createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`))
    const { payload } = await jwtVerify(token, jwks, { issuer, audience: env.ACCESS_AUD })
    c.set('email', String(payload.email ?? ''))
  } catch {
    return c.json({ error: 'Invalid session.' }, 401)
  }
  return next()
}
