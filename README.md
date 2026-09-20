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

`title, company, location, country, isRemote, url, source, roleCategory,
workType, experienceLevel, postedAt, fetchedAt`

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

## Staleness

Nothing is ever deleted; postings are marked `isActive: false` and revived
if they come back. `db/deactivateStale.js` runs at the end of every daily
run and applies two rules, both of them about evidence rather than age:

1. **Taken down** — the posting is missing from a source that publishes a
   *complete* current listing every run (Greenhouse and Ashby company
   boards), and has been for longer than the grace window (2 days).
2. **Lapsed** — no source has confirmed the posting in 30 days.

Rule 1 only ever considers sources that actually returned jobs in that
run, so a board being down for a morning can't retire everything it holds.

Rule 2 keys on `lastSeenAt`, never `postedAt`: a job we saw this morning is
live however old the posting is. An earlier version tested the posting date
instead and hid 3,261 of 7,929 listings that were still on their boards.

After changing either constant run `node scripts/resweep.js` — the daily run
only judges what it just fetched, so older rows otherwise keep the verdict of
whatever rule retired them.

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
