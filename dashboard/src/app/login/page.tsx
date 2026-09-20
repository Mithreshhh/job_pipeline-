import { redirect } from 'next/navigation'
import { isAuthenticated, usingDefaultPassword } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  if (await isAuthenticated()) redirect('/')

  const { error } = await searchParams
  const message =
    error === 'throttled'
      ? 'Too many attempts. Wait a few minutes and try again.'
      : error
        ? 'That password is not right.'
        : null

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-12">
      <h1 className="font-display text-xl font-bold tracking-tight">
        Jobs Pipeline
      </h1>
      <p className="mt-1.5 text-[13px] text-ink-2">
        Internal dashboard for the job scraping pipeline.
      </p>

      <form
        action="/api/session"
        method="post"
        className="mt-6 flex flex-col gap-2.5"
      >
        <label htmlFor="password" className="sr-only">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoFocus
          autoComplete="current-password"
          placeholder="Password"
          className="rounded-md border border-line-2 bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-3"
        />
        <button
          type="submit"
          className="rounded-md bg-accent px-3 py-2.5 text-sm font-medium text-white hover:opacity-90"
        >
          Sign in
        </button>
      </form>

      {message ? (
        <p
          role="alert"
          className="mt-3 rounded-md border border-alarm bg-alarm-wash px-3 py-2 text-[12.5px] text-ink-2"
        >
          {message}
        </p>
      ) : null}

      {usingDefaultPassword() ? (
        <p className="mt-5 text-[12px] leading-relaxed text-ink-3">
          No <code className="font-mono">DASHBOARD_PASSWORD</code> is set, so
          the built-in development one is in force. Set it before this has a
          public URL.
        </p>
      ) : null}
    </main>
  )
}
