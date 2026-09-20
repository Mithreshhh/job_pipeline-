'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import {
  EXPERIENCE_LEVELS,
  ROLE_CATEGORIES,
  SOURCES,
  WORK_TYPES,
} from '@/lib/taxonomy'

/**
 * The filter bar. State lives in the URL rather than in React, so a filtered
 * view can be bookmarked or pasted into Slack and comes back the same — which
 * is most of the point of a tool you check every morning.
 *
 * Changing a filter always resets to page 1: keeping page 7 while narrowing
 * from 4,000 rows to 30 lands the reader on an empty page that looks broken.
 */

type Group = { key: string; label: string; options: { value: string; label: string }[] }

const GROUPS: Group[] = [
  { key: 'category', label: 'Category', options: ROLE_CATEGORIES },
  {
    key: 'place',
    label: 'Place',
    options: [
      { value: 'India', label: 'India' },
      { value: 'International', label: 'International' },
      { value: 'Remote', label: 'Remote' },
    ],
  },
  { key: 'workType', label: 'Type', options: WORK_TYPES },
  { key: 'experience', label: 'Level', options: EXPERIENCE_LEVELS },
  {
    key: 'source',
    label: 'Source',
    options: SOURCES.map((s) => ({ value: s.value, label: s.label })),
  },
]

export default function Filters({ total }: { total: number }) {
  const router = useRouter()
  const params = useSearchParams()
  const [pending, startTransition] = useTransition()
  const [q, setQ] = useState(params.get('q') ?? '')

  // Keep the box in step when the URL changes from somewhere else (back
  // button, a cleared filter), without fighting the user while they type.
  useEffect(() => {
    setQ(params.get('q') ?? '')
  }, [params])

  const push = (next: URLSearchParams) => {
    next.delete('page')
    startTransition(() => router.push(`/?${next.toString()}`, { scroll: false }))
  }

  const selected = (key: string) => params.getAll(key)

  const toggle = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString())
    const current = next.getAll(key)
    next.delete(key)
    const after = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value]
    after.forEach((v) => next.append(key, v))
    push(next)
  }

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const next = new URLSearchParams(params.toString())
    if (q.trim()) next.set('q', q.trim())
    else next.delete('q')
    push(next)
  }

  const retired = params.get('retired') === '1'
  const toggleRetired = () => {
    const next = new URLSearchParams(params.toString())
    if (retired) next.delete('retired')
    else next.set('retired', '1')
    push(next)
  }

  const anyActive =
    retired || Boolean(params.get('q')) || GROUPS.some((g) => selected(g.key).length)

  return (
    <div
      className={`flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 ${
        pending ? 'opacity-70' : ''
      }`}
    >
      <form onSubmit={submitSearch} className="flex gap-2">
        <input
          id="q"
          name="q"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search title or company"
          autoComplete="off"
          className="min-w-0 flex-1 rounded-md border border-line-2 bg-ground px-3 py-2 text-[13.5px] text-ink placeholder:text-ink-3"
        />
        <button
          type="submit"
          className="rounded-md border border-line-2 bg-surface px-3.5 py-2 font-mono text-xs text-ink-2 hover:border-ink-3 hover:text-ink"
        >
          Search
        </button>
      </form>

      {GROUPS.map((group) => {
        const chosen = selected(group.key)
        return (
          <div key={group.key} className="flex flex-wrap items-start gap-2">
            <span className="w-[74px] shrink-0 font-mono text-[10.5px] leading-[22px] uppercase tracking-[0.07em] text-ink-3">
              {group.label}
            </span>
            <div className="flex flex-1 flex-wrap gap-1.5">
              {group.options.map((opt) => {
                const on = chosen.includes(opt.value)
                return (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(group.key, opt.value)}
                    className={`rounded-full border px-2.5 py-[5px] text-xs whitespace-nowrap ${
                      on
                        ? 'border-accent bg-accent font-medium text-white'
                        : 'border-line-2 bg-surface text-ink-2 hover:border-ink-3 hover:text-ink'
                    }`}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
        <span className="tabular font-mono text-[12.5px] text-ink-2">
          <b className="font-medium text-ink">{total.toLocaleString('en-IN')}</b>{' '}
          matching
        </span>
        <div className="flex items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-2">
            <input
              id="retired"
              type="checkbox"
              checked={retired}
              onChange={toggleRetired}
              className="accent-[var(--accent)]"
            />
            Include retired
          </label>
          {anyActive ? (
            <a href="/" className="text-xs text-ink-3 underline hover:text-ink">
              Clear all
            </a>
          ) : null}
        </div>
      </div>
    </div>
  )
}
