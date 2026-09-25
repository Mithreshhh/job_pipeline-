# skeo-job-pipeline

Scrapes job listings from multiple job sites, normalizes them into a shared
schema, and stores them so they can power the Skeo and Menler job boards.

## Folder structure

- `/scrapers` — one module per job source (e.g. LinkedIn, Indeed). Each
  scraper is responsible for fetching raw listings and converting them into
  the shared job schema.
- `/pipeline` — the shared job schema, the vocabularies a job is tagged
  with, and the logic that runs scrapers, cleans/dedupes results, and
  passes them on to storage.
- `/db` — database setup, writes, the staleness sweep, and the read query
  the job boards use.
- `/scripts` — one-off or scheduled scripts (e.g. "run all scrapers now").
- `/dashboard` — a Next.js read-only view of what the pipeline stores: whether
  last night's run worked, what the board holds, and a browser for the
  listings. Its own README covers it. Nothing in it writes.

## Job schema

Defined in `pipeline/schema.js` — the shape every scraper normalizes into:

`title, company, location, country, isRemote, url, source, companyLogo,
roleCategory, workType, relevance, matchedSkills, achievability, indiaFit,
easeOfApply, rankScore, rankReasons, experienceLevel, postedAt, fetchedAt`

`companyLogo` comes free from the five sources that ship one: JobSpy
(~60% of rows), Himalayas, Jobicy, Instahyre, and AmbitionBox (which gives a
slug, so the URL is built from its own pattern). Greenhouse, Lever, Ashby,
Arbeitnow and WeWorkRemotely ship nothing, and RemoteOK has the field but
leaves it empty, so **null is the normal case** and both boards draw a
monogram instead. Only `http(s)` URLs are kept, since the value ends up in an
`<img src>`.

The stored record (`db/jobModel.js`) adds three more, which the database
layer maintains rather than the scrapers:

- `sources` — every board the posting was found on, added by dedupe.
- `lastSeenAt` — the last run that found it still live. `fetchedAt` is the
  first run that ever saw it, so the pair reads as "first seen / last seen".
- `isActive` — whether the boards should show it. See **Staleness** below.

## Vocabularies

`pipeline/taxonomy.js` is the single source of truth for the values a job
can be tagged with, and is mirrored by both LMS job boards.

| Field | Values |
| --- | --- |
| `roleCategory` | `AI-Tech` `AI-NonTech` `Tech` `Creative` `Marketing` `Writing` `Business` |
| `workType` | `full-time` `part-time` `contract` `freelance` `internship` `unspecified` |
| `experienceLevel` | `internship` `entry` `mid` `senior` `unspecified` |

Values are lowercase slugs and are never display labels — labels live in
the same file and can be reworded without touching stored data. Anything
reading this collection should use `normalizeWorkType()` to fold other
spellings (`Full-time`, `FULLTIME`, `part_time`, `Gig`) onto these.

## Ranking: what a student can actually get, first

The board sorts by `rankScore` descending, newest breaking ties. It combines
four scores, all 0-100, all written at normalize time and all rule-based. The
weights live in one object, `RANK_WEIGHTS` in `pipeline/ranking.js`:

| Axis | Weight | What it reads |
| --- | --- | --- |
| `achievability` | 0.40 | Experience level, seniority in the title, years the description demands |
| `indiaFit` | 0.30 | India-based, or remote that genuinely hires from India; visa and clearance gates |
| `easeOfApply` | 0.18 | Direct apply link, take-home, multi-round process, degree gate |
| `relevance` | 0.12 | Match against the Menler syllabus (see below) |

Sorting on syllabus relevance alone answered the wrong question. It put a
Staff Engineer role in San Francisco wanting ten years and a US work visa
above an AI automation internship in Pune. Both match the curriculum. Only one
is a job a student finishing a six-week programme can take.

Three rules are worth knowing because they are where the obvious version goes
wrong:

- **A junior word in the title beats a senior one.** "AI Intern - Supporting
  Senior Engineers" is an internship. Reading the seniority list first buries
  exactly the postings this board exists to surface.
- **"Remote" is not the same as open.** A remote role that says "must be
  authorized to work in the United States" scores near zero on `indiaFit`.
  The gate is skipped for jobs physically in India, so a Bengaluru role at a
  US defence contractor keeps its score.
- **Currency says nothing about eligibility.** An Indian remote role paying in
  USD is still an Indian role.

Every job stores `rankReasons` - short phrases like `["entry level",
"Bengaluru", "direct apply", "matches claude"]` - so a position on the board
can be accounted for rather than taken on trust.

Two overrides on the sort: a **search term** replaces it with text relevance,
because the reader has said what they want; and **`?sort=relevance`** gives
the syllabus score alone, which is how you check that scoring without the
reachability weights on top.

**Run `scripts/backfillRankScore.js` after changing the weights.** Its default
mode recombines the four stored components, which is exact. `--rescore`
recomputes the components too, which is lossy because descriptions are not
stored; the next daily run corrects it.

### The relevance score itself

`pipeline/syllabus.js` holds the vocabulary, transcribed from the two real
curricula in `menler-lms/server/scripts/curricula.js`, with every band citing
the session or week it came from. Naming Claude, MCP or prompt engineering
counts for most; then the role shape the programme produces (AI generalist,
automation specialist, no-code, voice agent); then the tools it teaches (n8n,
Zapier, Lovable, ElevenLabs, Midjourney, Perplexity); and well behind, the
generic words - generative AI, LLM, machine learning - which are twenty times
more common and used to be worth just as much.

Two things subtract: seniority the programme does not bridge and depth it
never teaches (research scientist, PhD, MLOps, CUDA, model training).

Each job stores `matchedSkills`, the terms it actually matched. Both LMS
boards show them, and `scripts/backfillRelevance.js` reads them to rescore the
backlog without the description.

## The board: a rolling ten-day window

The board shows jobs posted in the last **10 days** and nothing older, so each
new day pushes the oldest day off the back. It keys on the employer's own
posting date, which is present on 99.9% of stored rows, and falls back to when
we first saw a listing for the handful without one.

The window is applied **at read time** in `db/readJobs.js`, not written into a
flag by the nightly run. It is therefore exact to the second, and changing
`FRESH_DAYS` takes effect on the next page load with nothing to re-judge. Pass
`freshDays: 0` for an admin view of everything stored.

Against real data: 10,696 stored, **5,273 on the board**. The curve is steep —
3 days gives 4,160 and 30 days only 6,633 — because these feeds are heavily
weighted to the last week, so widening the window buys less than it looks like
it should.

## Withdrawal

Separately, a posting is marked `isActive: false` when the employer takes it
down: it is missing from a source that publishes a *complete* current listing
every run (the Greenhouse, Lever and Ashby company boards) and has been for
longer than the grace window (2 days). That rule only ever considers sources
that actually returned jobs in the run, so a board being down for a morning
cannot retire everything it holds.

It deletes nothing — a posting that comes back is revived by the next upsert.
`isActive` means exactly one thing, *the employer withdrew this*; age is the
window's business and never touches this flag. Merging the two is what caused
this project's worst bug, which hid 3,261 of 7,929 live listings.

Run `node scripts/resweep.js` after changing the grace window. It is not needed
after changing `FRESH_DAYS`.

## Storage

`db/purgeOldJobs.js` runs at the end of each daily run and is the only thing
here that deletes. It removes rows older than **60 days** — six times the board
window, so widening the window never finds the jobs already thrown away.
Without it the collection grows by ~2,700 rows a day, about a million a year
against a 512MB free tier.

## Reading the jobs

Both LMSes connect to this collection directly with a **read-only** Atlas
user. `db/readJobs.js` is the reference implementation of their query —
filtering, search, sorting and pagination — and the indexes in
`db/jobModel.js` exist to serve it.

```js
const { findJobs } = require("./db/readJobs.js");

await findJobs({
  category: "AI-Tech,Tech",   // repeated params or arrays also work
  workType: "freelance",
  country: "India",
  remote: "true",
  search: "prompt engineer",
  page: 1,
  limit: 25,
});
// → { jobs, total, page, limit, pages }
```

Two things any port of this must keep: live listings only unless something
deliberately opts out, and facet values whitelisted against the taxonomy
before they reach Mongo — they arrive from a query string, and an
unchecked one lets a visitor send an operator (`?workType[$ne]=x`) instead
of a string.

## Getting started

```
npm install
npm test
```

The connection string comes from `MONGO_URI`. Put it in a `.env` file at the
project root and it is picked up automatically:

```
MONGO_URI=mongodb+srv://user:pass@host/jobboard
```

```
node scripts/runDaily.js
```

A real environment variable always wins over the file, so CI is unaffected.
If your network cannot resolve SRV records, use the long three-host string
from Atlas → Connect → Drivers with the SRV toggle off.

In CI the same value comes from the `MONGO_URI` GitHub Actions secret.
Note the name: the two LMSes use `MONGODB_URI` for their own databases,
and will use a third name again for their read-only connection to this one.
