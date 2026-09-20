import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'

/**
 * Who is allowed in, and how that answer survives a page load.
 *
 * Same shape as skeo_web's admin gate: one shared password rather than user
 * accounts, because there is one operator and a real identity system would be
 * a bigger thing than the dashboard it guards. The session is a signed cookie,
 * so nothing has to be stored server-side to keep someone logged in.
 *
 * The data behind the gate is public job listings, so this is about keeping an
 * internal tool off the open web rather than protecting secrets.
 *
 * Server-only.
 */

export const SESSION_COOKIE = 'jobs_dash'

/** Eight hours: a working day, and short enough that a shared laptop forgets. */
const SESSION_MS = 8 * 60 * 60 * 1000

/** Set DASHBOARD_PASSWORD before this goes anywhere real. */
const DEV_PASSWORD = 'jobs-dashboard'

export const dashboardPassword = () =>
  process.env.DASHBOARD_PASSWORD || DEV_PASSWORD

/** True while the dashboard is still on the built-in password. */
export const usingDefaultPassword = () => !process.env.DASHBOARD_PASSWORD

/**
 * The signing key. Falling back to a key derived from the password means a
 * password change invalidates every outstanding session, which is the
 * behaviour you want anyway.
 */
function secret(): string {
  return (
    process.env.DASHBOARD_SESSION_SECRET ||
    `jobs-dashboard::${dashboardPassword()}`
  )
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('hex')
}

/** Length-safe, content-safe comparison — no early return on the first bad byte. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) {
    // Still burn a comparison so a wrong length is not measurably faster.
    timingSafeEqual(left, left)
    return false
  }
  return timingSafeEqual(left, right)
}

export function checkPassword(candidate: unknown): boolean {
  if (typeof candidate !== 'string' || candidate.length === 0) return false
  return safeEqual(candidate, dashboardPassword())
}

/** `expiry.nonce.signature` — everything needed to verify it is in the string. */
export function createSessionToken(now = Date.now()): string {
  const expires = now + SESSION_MS
  const nonce = randomBytes(8).toString('hex')
  const payload = `${expires}.${nonce}`
  return `${payload}.${sign(payload)}`
}

export function verifySessionToken(
  token: string | undefined,
  now = Date.now(),
): boolean {
  if (!token) return false
  const parts = token.split('.')
  if (parts.length !== 3) return false
  const [expires, nonce, signature] = parts
  if (!safeEqual(signature, sign(`${expires}.${nonce}`))) return false
  const expiresAt = Number(expires)
  return Number.isFinite(expiresAt) && expiresAt > now
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: Math.floor(SESSION_MS / 1000),
}

/** Reads the cookie on a server component or route handler. */
export async function isAuthenticated(): Promise<boolean> {
  const store = await cookies()
  return verifySessionToken(store.get(SESSION_COOKIE)?.value)
}

/* ------------------------------------------------------------------ *
 * Login throttling
 *
 * In memory, per IP. It resets on redeploy, which is fine: it exists to
 * make guessing the password slow, not to be an audit trail.
 * ------------------------------------------------------------------ */

const ATTEMPT_LIMIT = 8
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000

const attempts = new Map<string, { count: number; first: number }>()

export function tooManyAttempts(ip: string, now = Date.now()): boolean {
  const entry = attempts.get(ip)
  if (!entry) return false
  if (now - entry.first > ATTEMPT_WINDOW_MS) {
    attempts.delete(ip)
    return false
  }
  return entry.count >= ATTEMPT_LIMIT
}

export function recordFailure(ip: string, now = Date.now()): void {
  const entry = attempts.get(ip)
  if (!entry || now - entry.first > ATTEMPT_WINDOW_MS) {
    attempts.set(ip, { count: 1, first: now })
    return
  }
  entry.count++
}

export function clearAttempts(ip: string): void {
  attempts.delete(ip)
}

/** Best effort behind a proxy; falls back to a single shared bucket. */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return headers.get('x-real-ip') || 'local'
}
