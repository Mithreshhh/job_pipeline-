import { NextResponse } from 'next/server'
import {
  SESSION_COOKIE,
  checkPassword,
  clearAttempts,
  clientIp,
  createSessionToken,
  recordFailure,
  sessionCookieOptions,
  tooManyAttempts,
} from '@/lib/auth'

/**
 * The session: POST to create one, GET to end it.
 *
 * GET for sign-out rather than DELETE because a link is the natural control
 * for it and fetch-with-a-method would mean shipping client JS for one button.
 * The worst a forged sign-out can do is log the one operator out.
 */

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const ip = clientIp(request.headers)
  const origin = new URL(request.url).origin

  if (tooManyAttempts(ip)) {
    return NextResponse.redirect(`${origin}/login?error=throttled`, 303)
  }

  const form = await request.formData()
  if (!checkPassword(form.get('password'))) {
    recordFailure(ip)
    return NextResponse.redirect(`${origin}/login?error=1`, 303)
  }

  clearAttempts(ip)
  // 303 so the browser follows with a GET — a 302 after a POST can be
  // re-submitted by a refresh.
  const response = NextResponse.redirect(`${origin}/`, 303)
  response.cookies.set(SESSION_COOKIE, createSessionToken(), sessionCookieOptions)
  return response
}

export async function GET(request: Request) {
  const origin = new URL(request.url).origin
  const response = NextResponse.redirect(`${origin}/login`, 303)
  response.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions, maxAge: 0 })
  return response
}
