import type { Job } from '@/lib/jobs'
import {
  AI_CATEGORIES,
  experienceLevelLabel,
  roleCategoryLabel,
  workTypeLabel,
} from '@/lib/taxonomy'
import { Tag } from './ui'

/** How long ago, in the units a person actually thinks in. */
function ago(date: Date | null): string {
  if (!date) return 'no date'
  const days = Math.round((Date.now() - date.getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.round(days / 30)}mo ago`
  return `${Math.round(days / 365)}y ago`
}

function Row({ job }: { job: Job }) {
  const isAi = job.roleCategory
    ? AI_CATEGORIES.includes(job.roleCategory)
    : false
  const isIndia = job.country === 'India'
  const place = job.location || job.country || 'Not stated'

  return (
    <article
      className={`grid grid-cols-1 gap-x-3.5 gap-y-1 bg-surface px-4 py-3 hover:bg-surface-2 sm:grid-cols-[1fr_auto] ${
        job.isActive ? '' : 'opacity-55'
      }`}
    >
      <div className="min-w-0">
        <a
          href={job.url}
          target="_blank"
          rel="noreferrer noopener"
          className="text-sm font-medium text-ink hover:text-accent hover:underline"
        >
          {job.title || 'Untitled posting'}
        </a>
        <div className="mt-0.5 text-[12.5px] text-ink-2">
          {job.company || 'Company not stated'}
          <span className="mx-1.5 text-line-2">/</span>
          {place}
        </div>
      </div>

      <div className="tabular font-mono text-[11.5px] whitespace-nowrap text-ink-3 sm:text-right">
        {ago(job.postedAt)}
      </div>

      <div className="col-span-full mt-1.5 flex flex-wrap items-center gap-1.5">
        <Tag tone={isAi ? 'ai' : 'plain'}>
          {roleCategoryLabel(job.roleCategory)}
        </Tag>
        {isIndia ? <Tag tone="india">India</Tag> : null}
        {job.isRemote ? <Tag>Remote</Tag> : null}
        <Tag>{workTypeLabel(job.workType)}</Tag>
        {job.experienceLevel !== 'unspecified' ? (
          <Tag>{experienceLevelLabel(job.experienceLevel)}</Tag>
        ) : null}
        <Tag tone="mono">{job.source ?? 'unknown'}</Tag>
        {!job.isActive ? <Tag tone="mono">retired</Tag> : null}
      </div>

      {/* Why this row sits where it does. The board ranks on how well a job
          matches the Menler syllabus, and these are the terms it matched -
          the quickest way to see whether the ranking is working. */}
      {job.matchedSkills?.length ? (
        <div className="col-span-full mt-1 font-mono text-[11px] text-ink-3">
          {job.matchedSkills.join(' · ')}
          {typeof job.relevance === 'number' ? (
            <span className="ml-2 text-line-2">{job.relevance}</span>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

export default function JobList({ jobs }: { jobs: Job[] }) {
  if (jobs.length === 0) {
    return (
      <div className="rounded-lg border border-line bg-surface px-5 py-11 text-center">
        <b className="mb-1.5 block font-display text-sm text-ink">
          Nothing matches those filters
        </b>
        <span className="text-[12.5px] text-ink-3">
          Loosen one of them, or clear them all and start again.
        </span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-px overflow-hidden rounded-lg border border-line bg-line">
      {jobs.map((job) => (
        <Row key={String(job._id)} job={job} />
      ))}
    </div>
  )
}
