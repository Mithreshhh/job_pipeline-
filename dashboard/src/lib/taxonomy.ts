/**
 * The vocabularies a job is tagged with, and their display labels.
 *
 * A port of `pipeline/taxonomy.js` in skeo-job-pipeline, which is the source
 * of truth — the classifiers there produce these values. When a category is
 * added or renamed it changes there first, then here. Kept as a plain copy
 * rather than a shared package because the two repos deploy separately and a
 * published package for five lists would cost more than it saves.
 *
 * Stored values are slugs, never labels: labels change when someone dislikes
 * the wording, and rewriting thousands of rows over a copy edit should not be
 * possible.
 */

export type Facet = { value: string; label: string }

/**
 * Order is the order the board offers them in: the AI categories first, since
 * that is what these students are training for, then the rest by volume.
 */
export const ROLE_CATEGORIES: Facet[] = [
  { value: 'AI-Tech', label: 'AI — Technical' },
  { value: 'AI-NonTech', label: 'AI — Non-technical' },
  { value: 'Tech', label: 'Tech' },
  { value: 'Creative', label: 'Creative' },
  { value: 'Marketing', label: 'Marketing' },
  { value: 'Writing', label: 'Writing' },
  { value: 'Business', label: 'Business' },
]

/**
 * How the work is engaged — independent of category, because a freelance gig
 * can be technical or not and so can a staff job. `unspecified` is a real
 * answer: most boards never say, and defaulting to full-time because it is
 * the common case would put wrong information on a listing.
 */
export const WORK_TYPES: Facet[] = [
  { value: 'full-time', label: 'Full-time' },
  { value: 'part-time', label: 'Part-time' },
  { value: 'contract', label: 'Contract' },
  { value: 'freelance', label: 'Freelance' },
  { value: 'internship', label: 'Internship' },
  { value: 'unspecified', label: 'Not specified' },
]

export const EXPERIENCE_LEVELS: Facet[] = [
  { value: 'internship', label: 'Internship' },
  { value: 'entry', label: 'Entry level' },
  { value: 'mid', label: 'Mid level' },
  { value: 'senior', label: 'Senior' },
  { value: 'unspecified', label: 'Not specified' },
]

/**
 * Every board a listing can come from. `expected` marks the ones a healthy
 * run should always report — the dashboard raises a flag when one is missing,
 * which is how a source quietly dying gets noticed.
 */
export const SOURCES: (Facet & { expected: boolean })[] = [
  { value: 'greenhouse', label: 'Greenhouse', expected: true },
  { value: 'ashby', label: 'Ashby', expected: true },
  { value: 'lever', label: 'Lever', expected: true },
  { value: 'indeed', label: 'Indeed', expected: true },
  { value: 'ambitionbox', label: 'AmbitionBox', expected: true },
  { value: 'instahyre', label: 'Instahyre', expected: true },
  { value: 'linkedin', label: 'LinkedIn', expected: true },
  { value: 'freelancer', label: 'Freelancer.com', expected: true },
  { value: 'arbeitnow', label: 'Arbeitnow', expected: true },
  { value: 'weworkremotely', label: 'We Work Remotely', expected: true },
  { value: 'jobicy', label: 'Jobicy', expected: true },
  { value: 'remoteok', label: 'RemoteOK', expected: true },
  { value: 'himalayas', label: 'Himalayas', expected: true },
  { value: 'manual', label: 'Posted by the team', expected: false },
]

export const AI_CATEGORIES = ['AI-Tech', 'AI-NonTech']

const values = (list: Facet[]) => list.map((f) => f.value)

export const ROLE_CATEGORY_VALUES = values(ROLE_CATEGORIES)
export const WORK_TYPE_VALUES = values(WORK_TYPES)
export const EXPERIENCE_LEVEL_VALUES = values(EXPERIENCE_LEVELS)
export const SOURCE_VALUES = SOURCES.map((s) => s.value)

function lookup(list: Facet[]) {
  const byValue = new Map(list.map((f) => [f.value, f.label]))
  // An unknown value renders as itself rather than as "Other": a listing
  // tagged with something this table has never heard of is a bug worth seeing
  // on the page, not one worth hiding.
  return (value: string | null | undefined) =>
    (value && byValue.get(value)) || value || '—'
}

export const roleCategoryLabel = lookup(ROLE_CATEGORIES)
export const workTypeLabel = lookup(WORK_TYPES)
export const experienceLevelLabel = lookup(EXPERIENCE_LEVELS)
export const sourceLabel = lookup(SOURCES)
