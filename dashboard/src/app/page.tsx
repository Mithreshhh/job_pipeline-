import { redirect } from 'next/navigation'
import Filters from '@/components/Filters'
import JobList from '@/components/JobList'
import { Bar, Eyebrow, Panel, Tile, TileRow } from '@/components/ui'
import { isAuthenticated, usingDefaultPassword } from '@/lib/auth'
import {
  getCategoryMix,
  getPulse,
  listJobs,
  parseQuery,
  type Pulse,
} from '@/lib/jobs'
import { mongoConfigured } from '@/lib/mongo'
import { roleCategoryLabel } from '@/lib/taxonomy'

// Every load asks the database: the whole point is seeing this morning's run,
// so a cached page would be worse than a slow one.
export const dynamic = 'force-dynamic'

type SearchParams = Record<string, string | string[] | undefined>

const nf = (n: number) => n.toLocaleString('en-IN')
const pct = (n: number, of: number) =>
  of === 0 ? '—' : `${((n * 100) / of).toFixed(1)}%`

/**
 * The line that answers "did last night's run work?" before any number does.
 *
 * A run older than 26 hours means the cron did not fire — 24 plus a margin for
 * a slow queue, so a run that merely started late doesn't cry wolf.
 */
function RunStatus({ pulse }: { pulse: Pulse }) {
  const stale = pulse.hoursSinceRun === null || pulse.hoursSinceRun > 26
  const missing = pulse.missingSources

  return (
    <div className="flex flex-col gap-2">
      <div
        className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg border px-4 py-3 ${
          stale
            ? 'border-alarm bg-alarm-wash'
            : 'border-line bg-surface'
        }`}
      >
        <span
          className={`font-display text-sm font-semibold ${stale ? 'text-alarm' : 'text-ink'}`}
        >
          {pulse.lastRunAt
            ? stale
              ? 'No run in the last day'
              : 'Last run looks healthy'
            : 'No run recorded yet'}
        </span>
        <span className="font-mono text-[12px] text-ink-2">
          {pulse.lastRunAt
            ? `${pulse.lastRunAt.toISOString().slice(0, 16).replace('T', ' ')} UTC · ${
                pulse.hoursSinceRun !== null
                  ? `${pulse.hoursSinceRun.toFixed(1)}h ago`
                  : ''
              }`
            : 'the pipeline has never written to this database'}
        </span>
        {pulse.lastRunAt ? (
          <span className="tabular font-mono text-[12px] text-ink-3">
            confirmed {nf(pulse.seenInLastRun)} · added {nf(pulse.newInLastRun)}
          </span>
        ) : null}
      </div>

      {missing.length > 0 ? (
        <div className="rounded-lg border border-line border-l-[3px] border-l-signal bg-surface px-4 py-3 text-[12.5px] leading-relaxed text-ink-2">
          <b className="font-semibold text-ink">
            {missing.length === 1 ? 'One source' : `${missing.length} sources`}{' '}
            returned nothing:
          </b>{' '}
          {missing.map((s) => s.label).join(', ')}. A source that always reports
          and suddenly doesn&apos;t is usually rate-limited or blocked rather
          than empty — worth checking the run log before assuming the jobs
          simply weren&apos;t there.
        </div>
      ) : null}
    </div>
  )
}

function Setup({ message }: { message: string }) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="font-display text-xl font-bold">Jobs dashboard</h1>
      <p className="mt-3 text-sm text-ink-2">{message}</p>
      <pre className="mt-4 overflow-x-auto rounded-lg border border-line bg-surface p-4 font-mono text-xs text-ink-2">
        MONGODB_URI=mongodb+srv://jobs_reader:...@cluster0.xxxxx.mongodb.net/jobboard{'\n'}
        MONGODB_DB=jobboard{'\n'}
        DASHBOARD_PASSWORD=something-long
      </pre>
    </main>
  )
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  if (!(await isAuthenticated())) redirect('/login')

  if (!mongoConfigured()) {
    return (
      <Setup message="MONGODB_URI is not set, so there is nothing to read. Set these and redeploy:" />
    )
  }

  const params = await searchParams
  const query = parseQuery(params)

  let pulse: Pulse
  let mix: Awaited<ReturnType<typeof getCategoryMix>>
  let list: Awaited<ReturnType<typeof listJobs>>

  try {
    ;[pulse, mix, list] = await Promise.all([
      getPulse(),
      getCategoryMix(),
      listJobs(query),
    ])
  } catch (err) {
    return (
      <Setup
        message={`Could not reach the database: ${
          err instanceof Error ? err.message : 'unknown error'
        }. If this is a timeout, the usual cause is the host's IP not being on the Atlas access list.`}
      />
    )
  }

  const maxCat = Math.max(...mix.map((m) => m.count), 1)
  const maxSrc = Math.max(...pulse.sources.map((s) => s.count), 1)

  const pageLink = (n: number) => {
    const next = new URLSearchParams()
    Object.entries(params).forEach(([k, v]) => {
      if (k === 'page' || v === undefined) return
      ;(Array.isArray(v) ? v : [v]).forEach((item) => next.append(k, item))
    })
    next.set('page', String(n))
    return `/?${next.toString()}`
  }

  return (
    <>
      <header className="sticky top-0 z-20 border-b border-line bg-ground">
        <div className="mx-auto flex max-w-[1140px] flex-wrap items-baseline justify-between gap-3 px-4 py-3.5">
          <div className="flex flex-wrap items-baseline gap-2.5">
            <h1 className="font-display text-[17px] font-bold tracking-tight">
              Jobs Pipeline
            </h1>
            <span className="font-mono text-[11.5px] text-ink-3">
              {nf(pulse.active)} live of {nf(pulse.total)} stored
            </span>
          </div>
          <a
            href="/api/session"
            className="font-mono text-[11.5px] text-ink-3 hover:text-ink"
          >
            sign out
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-[1140px] px-4 pb-16">
        {usingDefaultPassword() ? (
          <p className="mt-4 rounded-lg border border-alarm bg-alarm-wash px-4 py-2.5 text-[12.5px] text-ink-2">
            Still on the built-in password. Set{' '}
            <code className="font-mono">DASHBOARD_PASSWORD</code> before this
            has a public URL.
          </p>
        ) : null}

        <section className="mt-6">
          <Eyebrow>This morning</Eyebrow>
          <RunStatus pulse={pulse} />
        </section>

        <section className="mt-7">
          <Eyebrow>The live board</Eyebrow>
          <TileRow>
            <Tile
              label="Live"
              value={nf(pulse.active)}
              note={`${nf(pulse.retired)} retired and hidden`}
            />
            <Tile
              label="In India"
              value={pct(pulse.india, pulse.active)}
              note={`${nf(pulse.india)} postings`}
              tone="signal"
            />
            <Tile
              label="Remote"
              value={pct(pulse.remote, pulse.active)}
              note={`${nf(pulse.remote)} open to remote`}
            />
            <Tile
              label="AI roles"
              value={pct(pulse.ai, pulse.active)}
              note={`${nf(pulse.ai)} tech and non-tech`}
              tone="accent"
            />
            <Tile
              label="AI in India"
              value={nf(pulse.aiIndia)}
              note="what an India-only student sees"
              tone={pulse.aiIndia < 100 ? 'alarm' : 'plain'}
            />
          </TileRow>
        </section>

        <section className="mt-7">
          <Eyebrow>Mix</Eyebrow>
          <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-line bg-line lg:grid-cols-2">
            <div className="bg-surface px-4 py-4">
              <h2 className="font-display text-[12.5px] font-semibold">
                By category
              </h2>
              <p className="mt-0.5 mb-3 text-[11.5px] text-ink-3">
                Bar is the total; the second figure is how many sit in India.
              </p>
              {mix.map((m) => (
                <Bar
                  key={m.key}
                  label={roleCategoryLabel(m.key)}
                  count={m.count}
                  max={maxCat}
                  suffix={` · ${nf(m.india)} IN`}
                />
              ))}
            </div>
            <div className="bg-surface px-4 py-4">
              <h2 className="font-display text-[12.5px] font-semibold">
                By source, last run
              </h2>
              <p className="mt-0.5 mb-3 text-[11.5px] text-ink-3">
                What each board contributed the last time the pipeline ran.
              </p>
              {[...pulse.sources]
                .sort((a, b) => b.count - a.count)
                .map((s) => (
                  <Bar
                    key={s.value}
                    label={s.label}
                    count={s.count}
                    max={maxSrc}
                    tone="signal"
                  />
                ))}
            </div>
          </div>
        </section>

        <section className="mt-7">
          <Eyebrow>Browse</Eyebrow>
          <Filters total={list.total} />
          <div className="mt-3.5">
            <JobList jobs={list.rows} />
          </div>

          {list.pages > 1 ? (
            <div className="mt-4 flex items-center justify-center gap-2">
              {list.page > 1 ? (
                <a
                  href={pageLink(list.page - 1)}
                  className="rounded-md border border-line-2 bg-surface px-3 py-2 font-mono text-xs text-ink-2 hover:border-ink-3 hover:text-ink"
                >
                  Prev
                </a>
              ) : null}
              <span className="tabular px-2 font-mono text-xs text-ink-3">
                {list.page} / {list.pages}
              </span>
              {list.page < list.pages ? (
                <a
                  href={pageLink(list.page + 1)}
                  className="rounded-md border border-line-2 bg-surface px-3 py-2 font-mono text-xs text-ink-2 hover:border-ink-3 hover:text-ink"
                >
                  Next
                </a>
              ) : null}
            </div>
          ) : null}
        </section>

        <Panel className="mt-7 px-4 py-3">
          <p className="text-[12.5px] leading-relaxed text-ink-2">
            Data is written by <b className="text-ink">skeo-job-pipeline</b>,
            which runs at 06:00 IST daily. This dashboard only reads — nothing
            here can change a listing.
          </p>
        </Panel>
      </main>
    </>
  )
}
