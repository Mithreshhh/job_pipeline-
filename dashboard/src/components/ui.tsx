import type { ReactNode } from 'react'

/**
 * The small set of pieces every screen is built from.
 *
 * Deliberately plain: a dashboard is scanned and operated rather than read, so
 * the job here is consistent edges and spacing, not variety. Border, fill and
 * emphasis are spent by role — a tile that is merely informative stays
 * neutral, and colour is reserved for the two things the page is actually
 * asking about (is it an AI role, is it in India) plus alarms.
 */

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-3">
      {children}
    </p>
  )
}

export function Panel({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={`rounded-lg border border-line bg-surface ${className}`.trim()}
    >
      {children}
    </div>
  )
}

/**
 * A row of figures. The 1px gaps are the grid background showing through,
 * which keeps the dividing lines identical to the panel borders around them.
 */
export function TileRow({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-5">
      {children}
    </div>
  )
}

export function Tile({
  label,
  value,
  note,
  tone = 'plain',
}: {
  label: string
  value: string
  note?: string
  tone?: 'plain' | 'accent' | 'signal' | 'alarm'
}) {
  const toneClass =
    tone === 'accent'
      ? 'text-accent'
      : tone === 'signal'
        ? 'text-signal'
        : tone === 'alarm'
          ? 'text-alarm'
          : 'text-ink'

  return (
    <div className="bg-surface px-4 py-3.5">
      <div className="font-mono text-[10.5px] uppercase tracking-[0.07em] text-ink-3">
        {label}
      </div>
      <div
        className={`tabular mt-2 font-display text-[27px] leading-none font-bold tracking-tight ${toneClass}`}
      >
        {value}
      </div>
      {note ? <div className="mt-1.5 text-[11.5px] text-ink-2">{note}</div> : null}
    </div>
  )
}

export function Tag({
  children,
  tone = 'plain',
}: {
  children: ReactNode
  tone?: 'plain' | 'ai' | 'india' | 'mono'
}) {
  const base =
    'inline-flex items-center rounded border px-[7px] py-[4px] text-[11px] leading-none'
  const tones = {
    plain: 'border-line bg-surface-2 text-ink-2',
    ai: 'border-accent bg-accent-wash text-accent-ink font-medium',
    india: 'border-signal bg-signal-wash text-signal-ink font-medium',
    mono: 'border-line text-ink-3 font-mono text-[10.5px]',
  }
  return <span className={`${base} ${tones[tone]}`}>{children}</span>
}

/**
 * A labelled magnitude bar. One hue, because this compares sizes of the same
 * thing — a second colour here would imply a distinction that isn't there.
 */
export function Bar({
  label,
  count,
  max,
  suffix,
  tone = 'accent',
}: {
  label: string
  count: number
  max: number
  suffix?: string
  tone?: 'accent' | 'signal'
}) {
  const width = Math.max(2, Math.round((count / Math.max(max, 1)) * 100))
  return (
    <div className="grid grid-cols-[104px_1fr_86px] items-center gap-2.5 py-[3.5px]">
      <span className="truncate text-[12.5px] text-ink-2" title={label}>
        {label}
      </span>
      <span className="h-[9px] overflow-hidden rounded bg-track">
        <span
          className={`block h-full rounded ${tone === 'signal' ? 'bg-signal' : 'bg-accent'}`}
          style={{ width: `${width}%` }}
        />
      </span>
      <span className="tabular text-right font-mono text-[11.5px] text-ink-2">
        {count.toLocaleString('en-IN')}
        {suffix ? <span className="text-ink-3">{suffix}</span> : null}
      </span>
    </div>
  )
}
