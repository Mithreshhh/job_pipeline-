# Jobs dashboard

A read-only view of what `skeo-job-pipeline` scrapes: whether last night's run
worked, what the board currently holds, and a browser for the listings
themselves.

It exists to be checked in the morning. The top of the page answers the only
question that matters daily — *did the run happen, and did every source
report* — before any of the totals.

```
src/
├── lib/       mongo connection, auth, and every query
├── components/  the filter bar, the list, the small shared pieces
└── app/       the dashboard, the login screen, the session route
```

## Run locally

```bash
npm install
cp .env.example .env.local     # then fill in MONGODB_URI
npm run dev                    # http://localhost:3000
```

Without `MONGODB_URI` the page renders a setup screen rather than an error.
Without `DASHBOARD_PASSWORD` a built-in development password (`jobs-dashboard`)
is in force and the UI says so on every screen.

## What it reads

The `jobs` collection in the `jobboard` database — written by the pipeline and
by nothing else. This app opens the connection with the **read-only** Atlas
user, so a mistake here cannot damage the feed.

The query shape in `src/lib/jobs.ts` is a port of `db/readJobs.js` in the
pipeline, which is the reference implementation: same whitelisting of filter
values, same live-listings-only default, same pagination. Keeping them in step
is what stops this dashboard and the LMS job boards disagreeing about what is
live.

`src/lib/taxonomy.ts` is likewise a copy of the pipeline's `pipeline/taxonomy.js`.
That file is the source of truth; when a category is renamed there, rename it
here.

## How the daily check works

Every row a run touches is stamped with that run's single start timestamp, so:

- the newest `lastSeenAt` in the collection **is** the last run,
- counting rows carrying it says how much that run confirmed still live,
- a row whose `fetchedAt` is later than it was inserted during that run, so
  it is new — `fetchedAt` is written once, on insert, and never updated.

A run older than 26 hours raises a flag (24 plus margin, so a slow queue
doesn't cry wolf). Any source that normally reports and returned nothing is
called out by name: that is how a board quietly getting blocked gets noticed,
rather than being read as "no jobs today".

## Deploy

Vercel, root `jobs-dashboard/`. Set `MONGODB_URI`, `MONGODB_DB` and
`DASHBOARD_PASSWORD`. Atlas must allow Vercel's egress — the pipeline's own
`0.0.0.0/0` entry already covers it.
