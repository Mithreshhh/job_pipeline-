import type { Filter } from 'mongodb'
import { mongoDb } from './mongo'
import {
  AI_CATEGORIES,
  EXPERIENCE_LEVEL_VALUES,
  ROLE_CATEGORY_VALUES,
  SOURCES,
  SOURCE_VALUES,
  WORK_TYPE_VALUES,
} from './taxonomy'

/**
 * Every read this dashboard makes.
 *
 * The query shape is a port of `db/readJobs.js` in skeo-job-pipeline, which is
 * the reference implementation — same whitelisting, same active-only default,
 * same clamped pagination — so the dashboard and the LMS boards can never
 * disagree about what "live listings" means.
 *
 * Server-only.
 */

export type Job = {
  _id: unknown
  title: string | null
  company: string | null
  location: string | null
  country: string | null
  isRemote: boolean
  url: string
  source: string | null
  sources?: string[]
  roleCategory: string | null
  /** The syllabus terms this listing matched, which is what `relevance` is scored from. */
  matchedSkills?: string[]
  relevance?: number
  workType: string
  experienceLevel: string
  postedAt: Date | null
  fetchedAt: Date | null
  lastSeenAt: Date | null
  isActive: boolean
}

const COLLECTION = 'jobs'

export const DEFAULT_LIMIT = 50
export const MAX_LIMIT = 200

/**
 * The board's rolling window: a job shows for its first FRESH_DAYS days and
 * then falls off the back, so day 11 drops what arrived on day 1 while day
 * 11's own jobs come in.
 *
 * Applied at read time rather than written into a flag by the nightly run,
 * so it is exact to the second and changing it takes effect immediately.
 * Mirrors FRESH_DAYS in the pipeline's db/readJobs.js — change both.
 */
export const FRESH_DAYS = 10

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * "Posted within the window, or — for the handful of listings whose source
 * gave no date — first seen within it." 99.9% of stored jobs carry a real
 * postedAt, so the fallback is the exception, not the path.
 */
export function freshnessFilter(days = FRESH_DAYS, now = Date.now()) {
  const cutoff = new Date(now - days * DAY_MS)

  return {
    $or: [
      { postedAt: { $gte: cutoff } },
      { postedAt: null, fetchedAt: { $gte: cutoff } },
    ],
  }
}

async function jobs() {
  const db = await mongoDb()
  return db.collection<Job>(COLLECTION)
}

/* ------------------------------------------------------------------ *
 * Filters
 * ------------------------------------------------------------------ */

export type JobQuery = {
  q?: string
  category?: string[]
  workType?: string[]
  experience?: string[]
  source?: string[]
  place?: string[]
  includeRetired?: boolean
  /** Widen or waive the rolling window. 0 shows everything ever stored. */
  freshDays?: number
  page?: number
}

/**
 * Keeps only the values the taxonomy recognises.
 *
 * These arrive off a query string, and an unchecked one lets a visitor send
 * `?workType[$ne]=x` — an object, not a string — and hand the driver an
 * operator instead of a value. Whitelisting closes that, and has the side
 * benefit that a typo narrows nothing rather than silently returning no rows.
 */
function clean(input: unknown, allowed: readonly string[]): string[] {
  const raw = Array.isArray(input) ? input : [input]
  const flat = raw
    .filter((v): v is string => typeof v === 'string')
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter(Boolean)
  return [...new Set(flat.filter((v) => allowed.includes(v)))]
}

/** Reads a page's searchParams into a query this module understands. */
export function parseQuery(
  params: Record<string, string | string[] | undefined>,
): JobQuery {
  const page = Number.parseInt(String(params.page ?? ''), 10)
  // `?window=all` is the admin view: everything stored, not just the board.
  const freshDays = params.window === 'all' ? 0 : FRESH_DAYS
  return {
    freshDays,
    q: typeof params.q === 'string' ? params.q.trim().slice(0, 120) : '',
    category: clean(params.category, ROLE_CATEGORY_VALUES),
    workType: clean(params.workType, WORK_TYPE_VALUES),
    experience: clean(params.experience, EXPERIENCE_LEVEL_VALUES),
    source: clean(params.source, SOURCE_VALUES),
    place: clean(params.place, ['India', 'International', 'Remote']),
    includeRetired: params.retired === '1',
    page: Number.isFinite(page) && page > 0 ? page : 1,
  }
}

export function buildFilter(query: JobQuery): Filter<Job> {
  const filter: Filter<Job> = {}
  const and: Filter<Job>[] = []

  // Forced on unless something deliberately opts out, so no caller has to
  // remember it and a forgotten filter can't surface dead links.
  if (!query.includeRetired) filter.isActive = true

  const freshDays = query.freshDays === undefined ? FRESH_DAYS : query.freshDays
  if (Number.isFinite(freshDays) && freshDays > 0) {
    and.push(freshnessFilter(freshDays) as Filter<Job>)
  }

  if (query.category?.length) filter.roleCategory = { $in: query.category }
  if (query.workType?.length) filter.workType = { $in: query.workType }
  if (query.experience?.length) filter.experienceLevel = { $in: query.experience }
  if (query.source?.length) filter.source = { $in: query.source }

  if (query.place?.length) {
    const or: Filter<Job>[] = []
    if (query.place.includes('India')) or.push({ country: 'India' })
    if (query.place.includes('International')) or.push({ country: { $ne: 'India' } })
    if (query.place.includes('Remote')) or.push({ isRemote: true })
    if (or.length) and.push({ $or: or })
  }

  if (query.q) filter.$text = { $search: query.q }

  // Everything optional goes under one $and. The window and the place filter
  // are both $or clauses, and assigning them to filter.$or in turn would
  // mean the second silently replaced the first.
  if (and.length) filter.$and = and

  return filter
}

export async function listJobs(query: JobQuery) {
  const filter = buildFilter(query)
  const page = query.page ?? 1
  const skip = (page - 1) * DEFAULT_LIMIT
  const col = await jobs()

  // Most relevant first, newest breaking ties — `relevance` is scored once
  // by the pipeline when a job is stored. A search term overrides it: the
  // reader has said what they want, and ranking AI roles above their own
  // query would be the board arguing with them.
  const sort: Record<string, unknown> = query.q
    ? { score: { $meta: 'textScore' }, postedAt: -1 }
    : { relevance: -1, postedAt: -1 }

  const cursor = query.q
    ? col.find(filter, { projection: { score: { $meta: 'textScore' } } })
    : col.find(filter)

  const [rows, total] = await Promise.all([
    cursor.sort(sort as never).skip(skip).limit(DEFAULT_LIMIT).toArray(),
    col.countDocuments(filter),
  ])

  return {
    rows,
    total,
    page,
    pages: Math.max(1, Math.ceil(total / DEFAULT_LIMIT)),
  }
}

/* ------------------------------------------------------------------ *
 * The daily check
 * ------------------------------------------------------------------ */

export type SourceHealth = {
  value: string
  label: string
  expected: boolean
  count: number
  reported: boolean
}

export type Pulse = {
  lastRunAt: Date | null
  hoursSinceRun: number | null
  /** Rows the most recent run confirmed were still live. */
  seenInLastRun: number
  /** Rows the most recent run saw for the first time. */
  newInLastRun: number
  /** Everything ever stored, including what has fallen out of the window. */
  total: number
  /** Not withdrawn by the employer. */
  active: number
  retired: number
  /** What the board actually shows: live and inside the rolling window. */
  onBoard: number
  india: number
  remote: number
  ai: number
  aiIndia: number
  sources: SourceHealth[]
  missingSources: SourceHealth[]
}

/**
 * Everything the top of the dashboard needs to answer "did last night's run
 * work, and is the data still worth showing".
 *
 * Every row a run touches is stamped with that run's single start timestamp,
 * so the newest `lastSeenAt` in the collection identifies the last run and
 * counting rows carrying it says how much that run confirmed. A row whose
 * `fetchedAt` falls after that timestamp was inserted during the run, which
 * makes it new — `fetchedAt` is written once, on insert, and never updated.
 */
export async function getPulse(): Promise<Pulse> {
  const col = await jobs()

  const newest = await col
    .find({}, { projection: { lastSeenAt: 1 } })
    .sort({ lastSeenAt: -1 })
    .limit(1)
    .toArray()

  const lastRunAt = newest[0]?.lastSeenAt ?? null

  // Everything below the first two counts is scoped to the board — live AND
  // inside the rolling window — because that is what a reader sees. Counting
  // the whole collection would quote numbers no page ever shows.
  const onBoardFilter = { isActive: true, ...freshnessFilter() } as Filter<Job>
  const onBoardAnd = (extra: Filter<Job>) =>
    ({ isActive: true, $and: [freshnessFilter(), extra] }) as Filter<Job>

  const [total, active, onBoard, india, remote, ai, aiIndia, seenInLastRun, newInLastRun, bySource] =
    await Promise.all([
      col.countDocuments({}),
      col.countDocuments({ isActive: true }),
      col.countDocuments(onBoardFilter),
      col.countDocuments(onBoardAnd({ country: 'India' })),
      col.countDocuments(onBoardAnd({ isRemote: true })),
      col.countDocuments(onBoardAnd({ roleCategory: { $in: AI_CATEGORIES } })),
      col.countDocuments(
        onBoardAnd({ country: 'India', roleCategory: { $in: AI_CATEGORIES } }),
      ),
      lastRunAt ? col.countDocuments({ lastSeenAt: lastRunAt }) : 0,
      lastRunAt ? col.countDocuments({ fetchedAt: { $gte: lastRunAt } }) : 0,
      lastRunAt
        ? col
            .aggregate<{ _id: string | null; n: number }>([
              { $match: { lastSeenAt: lastRunAt } },
              { $group: { _id: '$source', n: { $sum: 1 } } },
            ])
            .toArray()
        : Promise.resolve([]),
    ])

  const counts = new Map(bySource.map((r) => [r._id ?? '', r.n]))
  const sources: SourceHealth[] = SOURCES.map((s) => ({
    value: s.value,
    label: s.label,
    expected: s.expected,
    count: counts.get(s.value) ?? 0,
    reported: (counts.get(s.value) ?? 0) > 0,
  }))

  return {
    lastRunAt,
    hoursSinceRun: lastRunAt
      ? (Date.now() - lastRunAt.getTime()) / 3_600_000
      : null,
    seenInLastRun,
    newInLastRun,
    total,
    active,
    retired: total - active,
    onBoard,
    india,
    remote,
    ai,
    aiIndia,
    sources: sources.filter((s) => s.reported || s.expected),
    // A source that should always report and didn't is the single most useful
    // thing on this page: it is how a board quietly dying gets noticed.
    missingSources: sources.filter((s) => s.expected && !s.reported),
  }
}

export type Distribution = { key: string; count: number; india: number }

/** Category counts for the mix, with the India split inside each one. */
export async function getCategoryMix(): Promise<Distribution[]> {
  const col = await jobs()
  const rows = await col
    .aggregate<{ _id: string | null; n: number; india: number }>([
      // The board, not the archive: the mix should describe what a reader
      // can actually click on.
      { $match: { isActive: true, $and: [freshnessFilter()] } },
      {
        $group: {
          _id: '$roleCategory',
          n: { $sum: 1 },
          india: { $sum: { $cond: [{ $eq: ['$country', 'India'] }, 1, 0] } },
        },
      },
    ])
    .toArray()

  const byKey = new Map(rows.map((r) => [r._id ?? '', r]))
  return ROLE_CATEGORY_VALUES.map((key) => ({
    key,
    count: byKey.get(key)?.n ?? 0,
    india: byKey.get(key)?.india ?? 0,
  })).filter((d) => d.count > 0)
}
