# Understanding Log

This file tracks what gets built in this project and why, in plain language.
A new section gets added every time a task is finished.

## Project setup

- Created the basic folder layout: `/scrapers` (fetch jobs from each site),
  `/pipeline` (shared logic + schema), `/db` (storage), `/scripts` (one-off
  run scripts). Splitting it this way means a scraper breaking doesn't touch
  storage code, and vice versa.
- Defined one shared job schema (`pipeline/schema.js`) instead of letting
  each scraper invent its own fields. Every job site formats data
  differently (e.g. "Remote" vs "remote" vs a boolean), so normalizing
  everything into one shape early means the rest of the pipeline never has
  to special-case a source.
- `createJob()` fills in any missing field as `null` rather than leaving it
  undefined. That way every job object always has the same keys, which
  avoids bugs later when code checks `job.someField` and gets `undefined`
  vs `null` inconsistently.
- Marked `package.json` as `"private": true` since this is an internal
  pipeline, not something meant to be published to npm.
- Added a `.gitignore` for `node_modules`, `.env` files, and local database
  files — these are either huge, secret, or machine-specific, so they
  shouldn't be committed to git.

## India scrapers: Naukri + JobSpy

- Built two scrapers for Indian job listings and one script
  (`scrapers/india.py`) that runs both over the same 10 AI-related keywords.
  Neither scraper normalizes anything yet — they just dump each source's
  raw response into `db/raw/`. Normalizing into the shared schema is a
  separate, later step, so bugs in one don't corrupt the other's data.
- **`scrapers/naukri.js` (Node)**: Naukri has no public API, so this calls
  the same internal JSON endpoint (`naukri.com/jobapi/v3/search`) that
  naukri.com's own search page calls in the browser. It's a from-scratch
  function, not the cloned `naukri_webscraper` repo — that repo was only
  used as a reference for headers/params, and it turned out to target an
  older HTML-scraping flow that Naukri has since replaced with this JSON
  endpoint.
- **`scrapers/india.py` (Python)**: calls JobSpy directly (`site_name=
  ["indeed", "linkedin"]`, `country_indeed="India"`) once per keyword, and
  shells out to `node naukri.js` as a subprocess for the Naukri half. Mixed
  languages because JobSpy is Python-only and Naukri's scraper is JS —
  rather than reimplementing JobSpy in JS or Naukri's endpoint in Python,
  Python orchestrates and calls out to Node for the one piece that needs it.
- **Why they're structured differently**: JobSpy searches India as a whole
  country in one call per keyword. Naukri's search is city-based, so
  `naukri.js` loops over keyword x city combinations (10 keywords x 5
  cities = 50 requests) with a small delay between each to avoid looking
  like a bot flood.
- **Gotcha — Naukri blocks scripted requests with a reCAPTCHA wall**: even
  with correct headers (`appid`, `systemid`, a browser User-Agent), Naukri's
  edge/bot-protection layer (Akamai) returned `406 {"message":"recaptcha
  required"}` when tested from this machine's network. This isn't
  necessarily about being outside India specifically — it's Naukri's
  anti-bot system flagging the request pattern/IP as automated. The code
  itself is correct and well-formed (confirmed by getting a real JSON error
  back, not a connection failure); getting live data through may need
  running it from a "cleaner" residential/Indian IP, adding delays/rotation,
  or eventually a headless browser. Until that's solved, `naukri.js` will
  write `error` fields into its raw output for blocked requests instead of
  silently failing, so the pipeline can see what happened.

## International scrapers: global JobSpy + free remote-job APIs

- **What "international" adds**: the India scrapers only see Indian
  postings. `scrapers/international.js` adds (a) the same 10 AI keywords
  searched via JobSpy across major English-speaking markets (US, UK,
  Canada, Australia for Indeed; LinkedIn searched globally), and (b) four
  free remote-job boards — RemoteOK, Arbeitnow, Jobicy, Himalayas. Remote
  roles matter because an Indian candidate can take a remote US job
  without relocating, so those listings belong on the board too.
- **Why free APIs are lower-risk than scraping**: these four hand you
  official JSON endpoints with no API key and no login. You're using the
  front door they built for this, so there's no reCAPTCHA wall (the exact
  thing that blocked Naukri), no HTML parsing that breaks when they
  redesign the page, and no terms-of-service grey area. All four worked
  first try and returned clean, stable JSON.
- **Same cross-language bridge, opposite direction**: JobSpy is Python-only,
  so `international.js` (Node) shells out to `scrapers/jobspy_global.py`
  as a subprocess — mirroring how `india.py` (Python) shells out to
  `naukri.js`. Indeed needs one country per call in JobSpy, so it loops
  over markets; LinkedIn takes no country param, so it's one global call
  per keyword.
- **Gotcha — Himalayas ignores the filter params you'd expect**: their API
  silently ignores both `postedAfter` and `limit` (always 20 jobs/page).
  The feed is strictly newest-first though, so the 24h window is applied in
  our own code: page through with their cursor, stop at the first job older
  than the cutoff. My first version capped pagination at 20 pages and
  quietly returned only 400 jobs — it looked like it worked, but it was
  truncating, not filtering. A real 24h pull is ~123 pages / ~2,455 jobs /
  ~85 seconds. Lesson: when you filter client-side, check whether the loop
  stopped because it *finished* or because it *ran out of budget*.
- **Smaller gotchas**: RemoteOK's first array element is a legal/terms
  notice, not a job, so it gets dropped (their terms also require linking
  back to RemoteOK when you display their listings). Arbeitnow accepts
  `search`/`tags` params but ignores them, returning all 250 jobs/page
  regardless — so no keyword filtering is possible at the API level.
  Because of that, the free APIs are pulled as whole recent feeds rather
  than per-keyword, and matching them against the AI keyword list is left
  to the normalize step, consistent with keeping raw data raw.

## Normalization: one shape for six different sources

- **Why normalize before dedupe**: dedupe means "is this the same job twice?"
  You can't compare a RemoteOK job to a Naukri job while one calls the title
  `position` and the other calls it `title`, or while one date is epoch
  seconds and the other is an ISO string. Normalizing first gives every job
  identical field names, so dedupe can just compare values.
- **Why normalize before storage**: a database table needs fixed columns.
  If you store raw source shapes you get six different table layouts (or one
  messy blob), and every query has to know which source it's reading.
  Normalize once at the door, and everything after it stays simple.
- **How the relevance filter works**: each job's title + description is
  scanned for the 10 AI keywords. A match sets `roleCategory: "AI/ML"`;
  no match sets it to `null` and the job is returned under `excluded`
  instead of being deleted — so if the filter is too strict, you can see
  what it threw away rather than wondering where the jobs went. In a live
  test this kept 33 of 476 jobs, which is expected since most of these
  feeds are all-industry job boards.
- **Gotcha — three tagging bugs that all looked fine at first**: (1) US jobs
  were labelled `country: "India"` because the pattern matching the country
  code `", IN"` also matched the word "in" in ordinary description prose;
  country is now read from the location field only, with `IN` anchored to
  the end. (2) "Custom Software Engineering **Lead**" was tagged `entry`
  because a stray "graduate" in the job description outranked the title;
  the title is now checked before the description. (3) Every JobSpy
  international job defaulted to India because `jobspy-indeed` and
  `jobspy` shared a mapper, and the default country was keyed off the
  mapper instead of the actual source name.
- **Gotcha — seniority words mean different things in titles vs prose**:
  scanning descriptions for "lead"/"architect"/"senior" tagged 27 of 33
  jobs as senior, because JDs constantly say things like "lead a team of
  architects". Those words are now only trusted in the job title.
  Descriptions are only scanned for things that describe the *candidate* —
  explicit year ranges ("2-4 Yrs", "5+ years"), "fresher", "entry-level",
  "intern". Anything unclear stays `"unspecified"`, which is more honest
  than a confident wrong guess.
- **Still unverified**: the Naukri mapper is written from that endpoint's
  documented response shape and tested against a hand-made fixture, because
  the live endpoint is still behind the reCAPTCHA wall from Part 2. It's
  the one mapper that hasn't seen real data.

## Dedupe: one job, many boards

- **Why dedupe comes after normalization**: dedupe asks "are these two
  records the same job?" You can't answer that while one source calls the
  title `position` and another calls it `jobTitle`. Normalizing first means
  every record has a `title` and a `company`, so the comparison is just
  `title + company` on both sides. Dedupe before normalize would need its
  own copy of all six field mappings — the same work, done twice.
- **Why match on title + company, not URL**: every board mints its own URL
  for the same posting, so URLs never match even when the job is identical.
  Title + company is the closest thing to a natural ID a job posting has.
- **What the `sources` field is for**: it records every board a job was
  found on before the duplicates were dropped. That's useful for showing
  "also on LinkedIn" on a listing, for deciding which board to trust when
  details conflict, and for spotting which sources actually pull their
  weight — if a board only ever returns jobs we already had, it may not be
  worth scraping.
- **Earliest `postedAt` wins** because it's the closest thing we have to
  when the job first went live; a board that re-lists an old job shouldn't
  make it look new. A `null` postedAt is treated as "unknown" and ranks
  last, so a record with a real date always beats one without.
- **Gotcha — "jobspy" isn't a source, it's a tool**: normalize was writing
  `source: "jobspy"` for both Indeed and LinkedIn jobs, which made a
  `sources: ["indeed", "linkedin"]` array impossible. JobSpy tags every
  record with the board it came from (`site`), so normalize now uses that.
  Sources are now the six real boards: naukri, indeed, linkedin, remoteok,
  arbeitnow, jobicy, himalayas.
- **What dedupe actually catches (tested on ~135 real jobs)**: 15 merges,
  all of them *repeat postings within one board* — e.g. Accenture listing
  "AI Infrastructure Architect" four times on Indeed. Zero cross-board
  merges, and that was correct here: the boards genuinely returned
  different jobs (no shared companies at all). Worth knowing that exact
  matching only works when two boards write the company name identically —
  "Acme Labs" and "Acme Labs Pvt Ltd" won't merge. If cross-board overlap
  shows up later, that's the thing to loosen.
- **Known limitation**: if `company` is null, the key is just the title, so
  two different companies both posting "Senior Data Scientist" with a
  missing company would merge. Rare (2 of 135 jobs), but a reason to prefer
  sources that reliably provide a company name.

## Storing jobs in MongoDB

- **What an upsert is**: one operation that means "update this row if it
  already exists, otherwise insert it" (UP-date + in-SERT). Without it
  you'd have to check whether each job exists, then branch — two round
  trips per job, and a race if two runs overlap. `upsertJobs` sends them
  all as one bulk write.
- **Why key on `url` instead of inserting fresh every day**: the pipeline
  runs daily, and the same job is still on the board tomorrow. Plain
  inserts would create a new copy every single day, so a job live for two
  weeks becomes 14 rows. Keying on `url` means day two finds the existing
  row and refreshes it instead.
- **Why `url` specifically**: our sources share no common job ID — each
  board numbers jobs its own way — but the posting URL is unique per board
  and doesn't change between runs, which is exactly what a key needs.
- **The unique index does the real enforcing**: `url` has a unique index in
  the model, so even if buggy code tried to insert a second copy, the
  database itself rejects it. The application logic and the database agree,
  rather than the rule living only in code.
- **Credentials stay out of the repo**: `connection.js` reads
  `process.env.MONGO_URI` and throws a clear error if it's missing. A
  connection string contains a username and password, so hardcoding one
  would put it in git history permanently — where it stays even after you
  delete the line.
- **Verified against a real database**: tested on a throwaway in-memory
  MongoDB. Live run of 17 scraped jobs → 17 inserted; running the exact
  same batch again → 0 inserted, still 17 rows, which is the whole point.
  Changing a field updated in place instead of adding a row, a job with no
  URL was skipped rather than crashing the batch, and the duplicate-URL
  insert was rejected by the index. Indexes on `postedAt`, `roleCategory`
  and `country` exist and are actually used by the board's queries
  (confirmed with `explain()`).

## Running it daily: runDaily.js + GitHub Actions

- **What the script does end to end**: fetch every source one at a time →
  `normalizeRaw()` to get one shape → `dedupeJobs()` to collapse repeats →
  `upsertJobs()` to write to MongoDB → print a summary. It's just the
  previous five parts called in order; all the logic already lived in
  `/pipeline` and `/db`.
- **Why each source is wrapped in its own try/catch**: these are seven
  websites we don't control, and on any given morning one can be down,
  rate-limited or blocked — Naukri already is. Without isolation, the
  first failure would end the run and we'd store nothing. With it, a dead
  source costs us its jobs for the day and nothing else. The script only
  exits with a failure code if *every* source fails.
- **Two kinds of failure are logged separately**: a source that throws
  (listed under "Failed sources") versus a source that came back but with
  some requests failing inside it, like Naukri's per-city reCAPTCHA
  blocks (shown as "2 request(s) failed"). The second kind is easy to miss
  because the run still looks green.
- **GitHub Actions runs it for free on a schedule**: the cron is
  `30 0 * * *` because GitHub cron is always UTC, and 06:00 IST is 00:30
  UTC (IST is UTC+5:30). `workflow_dispatch` is also enabled, so you can
  hit "Run workflow" in the Actions tab instead of waiting for 6 AM —
  which is how you'll test it.
- **The database password lives in GitHub Secrets**, injected as the
  `MONGO_URI` env var for that one step. Same reason as before: never in
  the repo. Add it under Settings → Secrets and variables → Actions.
- **How to read the logs when it breaks**: Actions tab → click the failed
  run → click the `scrape` job → expand the red step. Most failures are
  one of four things: (1) *"MONGO_URI is not set"* — the secret is missing
  or misnamed; (2) a step failing at `npm ci` or `pip install` —
  a dependency problem, not your code; (3) the run is green but
  "Total jobs fetched: 0" — the sites blocked the GitHub runner's IP,
  which is a likelier problem in the cloud than on your laptop; (4) a
  MongoDB connection timeout — Atlas blocks unknown IPs, so GitHub's
  runners need to be allowed in the Atlas network settings. Always read
  the "=== Summary ===" block at the end first; it tells you whether the
  problem was fetching, filtering or storing.
- **Heads-up about where the workflow file sits**: GitHub only runs
  workflows from `.github/workflows/` at the **repository root**. This one
  is at the project root (`skeo-job-pipeline/.github/...`), which is
  correct, because this project is going into its own repo.

## Freelance gigs, and splitting tech from non-tech

- **Two new fields, not one**: `roleCategory` is now `AI-Tech` /
  `AI-NonTech` / null, and a separate `workType` field holds
  freelance / contract / full-time / part-time / internship. They're
  separate because they're independent — a freelance gig can be technical
  or not, and so can a full-time job. One combined field would force a
  freelance ML gig to pick a side.
- **Most freelance platforms are simply closed.** Checked all of them:
  Upwork retired its job RSS (returns 410) and its API is documented as
  non-commercial only; Fiverr, Toptal, Guru and PeoplePerHour publish no
  usable feed; Wellfound and Braintrust sit behind the same Cloudflare bot
  wall that blocks Naukri. **Freelancer.com** is the one with a public API
  that answers without a key, so it's the freelance source.
- **Where non-tech AI roles actually live**: not on general job boards.
  Titles like "AI Trainer", "Data Annotator" and "Model Evaluator" are
  posted on the career pages of AI-data companies. Greenhouse and Ashby
  both expose an official keyless JSON endpoint per company, so
  `scrapers/aiCompanies.js` reads those directly for Scale AI, Mercor,
  Invisible, Anthropic, Labelbox, Turing and others. The tradeoff is a
  hand-maintained company list — add a token when you find another.
- **Gotcha — substring matching tagged Indian cities as AI jobs**: plain
  `includes()` meant "Mumbai marketing" matched the keyword "ai marketing",
  and "Dubai operations" matched "ai operations". Every such listing was
  being filed as an AI role. Keyword matching is now word-boundary regex.
- **Gotcha — company boilerplate polluted the non-tech bucket**: phrases
  like "responsible AI" and "AI governance" appear in ordinary company
  blurbs, so scanning descriptions with them filed HR and security roles
  as AI jobs. The non-tech list is now matched on the **job title only**;
  only the more specific tech phrases still fall back to the description.
  This dropped a test batch from 53 "AI" jobs to 22 real ones.
- **Gotcha — gig listings aren't written like job ads**: a client posts
  "build me an AI chatbot", never "Machine Learning Engineer", so the
  job-title keyword list matched just 1 of 90 real gigs. Marketplace
  listings are now matched against a broader skill vocabulary (llm,
  chatbot, pytorch, data annotation…) which is deliberately *not* used for
  job boards, where "machine learning" shows up in half of all JDs. That
  took it from 1 gig to 44.
- **Also fixed a dedupe hole this exposed**: freelance gigs have no company
  name (the API only exposes an owner id), and the dedupe key was
  title + company — so two unrelated "Logo design" gigs would have merged
  into one. When there's no company, the key now falls back to the URL.
- **Known looseness**: Freelancer's own search is a loose full-text match
  (searching "machine learning" returns logo-design gigs), so some
  borderline gigs still get through on a passing mention of AI. Tightening
  that is a one-place change in `classifyRole`.

## Going wide: from 96 jobs a run to ~9,800

- **The biggest win wasn't a new source, it was the filter.** A run was
  fetching 1,963 jobs and keeping 96 — we were paying to download jobs and
  then throwing 95% of them away. Widening the categories turned the same
  fetches into thousands of kept jobs. Always check what you're discarding
  before you go looking for more to download.
- **Categories now cover the whole board**, in priority order: AI-Tech,
  AI-NonTech, Creative (video editing, design, motion), Marketing (social
  media, SEO, growth), Writing, Tech, Business. Order matters — "Video
  Editor" has to reach Creative before Writing claims it for "editor", and
  "Data Analyst" has to reach Tech before Business claims "analyst".
- **Two-tier matching**: an exact list first, then a deliberately broad
  pass. Real titles are endlessly varied ("Forward Deployed Engineer,
  GenAI", "Engagement Manager, Public Sector") and no keyword list will
  ever cover them. The broad tier just asks two questions — does the title
  mention AI, and is it an engineering role — which sorts most of the rest.
  That tier alone took the keep rate from 50% to 94%.
- **New sources added**: We Work Remotely (8 RSS feeds — design, marketing
  and support heavy, exactly what was missing), and a much longer list of
  company ATS boards. Greenhouse and Ashby publish keyless JSON per
  company, so adding Stripe, Figma, OpenAI, Databricks, ElevenLabs and
  others was just adding tokens — they alone supply ~5,600 jobs a run.
- **Where it landed**: a live run fetches ~12,700 jobs and stores ~9,800
  unique ones — Business 4,864, Tech 3,121, Marketing 631, AI-Tech 443,
  Creative 430, AI-NonTech 251, Writing 121; 549 of them freelance.
- **Gotcha — a source tag outranked the job title**: RemoteOK labels some
  freelance posts with a "full-time" tag, so "Freelance Designer" was being
  stored as full-time. The fix was to loop work types by priority on the
  outside and text sources on the inside, so "freelance" found anywhere
  beats "full-time" found anywhere.
- **Non-worry worth writing down**: running the pipeline twice in a row
  added new rows, which looked like the upsert key had broken. It hadn't —
  fetching the same source twice returns 100% identical URLs, and the
  second run *updated* 6,891 existing rows rather than re-inserting them.
  The new rows were genuinely new jobs; these feeds move constantly. The
  test assertion was wrong, not the code.

## Dropping Naukri, and adding a test suite

- **Naukri is gone.** Last check: its internal search API answers every
  request with a reCAPTCHA challenge page, and its public search pages
  return 503 — a session-cookie bootstrap didn't help either. It's a
  deliberate bot wall, not a headers problem, and the only way through
  would be defeating that protection. It was also costing ~40 seconds of
  every run for zero jobs. India coverage now rides on JobSpy
  (Indeed + LinkedIn, `country_indeed="India"`).
- **When you delete a source, delete all of it**: `scrapers/naukri.js`, its
  mapper, its entry in the source alias table, the `CITIES` list that only
  it used, and the half of `india.py` that shelled out to it. Leaving dead
  code behind is how a repo becomes confusing to read six months later.
- **There are tests now** — `npm test`, 34 of them, using Node's built-in
  test runner so there's no new dependency. They also run in CI before the
  pipeline touches the database, so a broken classifier fails the run
  instead of writing bad data.
- **Why these tests specifically**: almost every case is a bug that
  actually shipped and had to be spotted by eyeballing live output — the
  "Mumbai marketing" substring match, US jobs labelled India, "responsible
  AI" boilerplate pulling in HR roles, a source tag overriding a
  "Freelance" title, `jobspy` masking which board a job came from. A test
  is the cheapest way to make sure a bug only costs you once.
- **The suite immediately earned its keep**, twice over. It caught a live
  bug — for freelance gigs the broad classifier ran *before* the gig
  vocabulary, so "Build me an AI chatbot" was being filed as a
  non-technical AI role. And it caught a bad test: I had asserted that bare
  "machine learning" in a description should mark a job as AI, which is
  exactly the leak the gig vocabulary is designed to prevent. Worth
  remembering that a failing test means one of the two is wrong, and it
  isn't always the code.

## Liveness: knowing which postings are still real

- **The board had no way to stop showing dead links.** The pipeline only
  ever added and updated; nothing was ever retired. A role filled three
  weeks ago sat on the board looking as current as one posted this morning.
- **Two fields, not one**: `lastSeenAt` is refreshed every run that finds a
  posting still on its board; `isActive` is what the board filters on.
  Keeping them separate means the reason a job is hidden is still on the
  record — you can see it was last seen on the 3rd rather than just that
  it's gone.
- **`fetchedAt` now means first seen.** It used to be overwritten on every
  upsert, which made it an exact duplicate of what `lastSeenAt` now holds
  and left nothing recording how long a listing had been up. It moved to
  `$setOnInsert`, so the pair reads as "first seen / last seen".
- **Nothing is deleted.** A posting that disappears for a week and comes
  back — re-listed, or on a source that was down — is revived by the next
  upsert flipping `isActive` back to true. Deleting would lose the history
  and make the return look like a brand new job.
- **The important distinction: absence only proves something for sources
  that return everything.** Greenhouse and Ashby hand over a company's
  complete current openings every run, so a job missing from one has
  genuinely been pulled. Every other source is a recent-window feed or a
  keyword search — Himalayas answers for the last 24 hours only, Arbeitnow
  and Jobicy return a page or two of the newest, JobSpy and Freelancer
  return whatever matched that day's search. Their jobs drop out of view
  while still being live.
- **Which is why there are two rules**: *taken down* (missing from a
  complete feed, for longer than a grace window) and *aged out* (older than
  45 days, any source). Treating every source as complete would have
  retired thousands of live Himalayas and LinkedIn listings the morning
  after they were stored — a silent, large failure that would have looked
  like the scrapers breaking.
- **Guard 1 — only sources that actually answered.** The eligible source
  list is intersected with the sources present in *this run's* output. If
  Greenhouse throws, it contributes nothing, so none of its jobs can be
  retired on the strength of a run that never asked. Deriving it from the
  output rather than from the scraper names avoids the alias problem
  (`jobspy-indeed` → `indeed`) for free.
- **Guard 2 — a grace window, not a single miss.** A source can answer
  successfully and still return a short list because one page timed out.
  Two days means a job has to be missing from two runs before it counts.
- **Guard 3 — `$ne: null` on `lastSeenAt`.** BSON sorts null before every
  date, so a bare `$lt: cutoff` matches rows where the field is null —
  which on the first run after deploying this would have been every row in
  the collection. Worth remembering that in Mongo a range query is not
  automatically a "field exists" query.
- **The sweep is skipped entirely when nothing was stored.** A run that
  wrote no jobs has no evidence about what is still live, and acting on it
  would empty the board on the first bad morning.

## One vocabulary, shared with both LMSes

- **`pipeline/taxonomy.js` is now the contract.** The classifiers produce
  these values, the model validates against them, and the job boards in
  `skeo-lms` and `menler-lms` filter and label by them. A category gets
  added or renamed here first.
- **The pipeline's lowercase slugs won over the LMS's enum.** `skeo-lms`
  had `Full-time | Part-time | Internship | Contract` on its hand-posted
  openings. That can't express `freelance` (~550 listings a run) or
  `unspecified` (most listings, because most boards don't say), so
  widening the pipeline to fit it would have meant discarding tags we
  already have. The LMS migrates onto these instead, via
  `normalizeWorkType()`, which also accepts the spellings the boards use
  (`FULLTIME`, `part_time`, `Permanent`, `Gig`).
- **`unspecified` is an answer, not a gap.** Defaulting an unknown
  engagement type to full-time because it's the common case would put
  wrong information on a listing a student is deciding about.
- **Labels are separate from values, and stored values are never labels.**
  Labels change when someone dislikes the wording; rewriting 9,800 rows
  over a copy edit shouldn't be possible. An unknown value renders as
  itself rather than as "Other", so a tag the table has never heard of is
  visible on the page instead of hidden.
- **The drift guard is behavioural.** `taxonomy.js` gets copied into two
  other repos, so the risk is a value renamed in one place and not the
  others. The tests run real titles through the classifiers and assert
  that every category, work type and experience level in the table is
  reachable and that nothing outside the table comes out — rename a value
  on one side only and they fail.

## The read layer the LMSes use

- **Option A: both LMSes read this collection directly** with a read-only
  Atlas user, rather than the pipeline serving an API. Fewer moving parts
  and no extra deploy. `db/readJobs.js` is the reference implementation of
  the query they run, so the semantics are defined and tested in one place
  and ported from there.
- **`isActive: true` is applied unless something explicitly opts out**, so
  no caller has to remember it and a forgotten filter can't put retired
  links in front of a student.
- **Every facet value is whitelisted against the taxonomy before it reaches
  Mongo.** These arrive from a query string, and an unchecked one lets a
  visitor send `?workType[$ne]=x` — an object, not a string — and hand the
  driver an operator. Whitelisting closes that, and has the side benefit
  that a typo narrows nothing instead of silently returning zero rows.
  `country` has no fixed list (it's whatever `detectCountry` read off a
  location), so it's length-capped and matched exactly instead.
- **Pagination is clamped at 100.** The old route did a bare `find()` with
  no limit, which on ~9,800 rows means the whole collection in one
  response.
- **Search sorts by relevance, then date.** Someone searching "prompt
  engineer" wants prompt engineering roles, not whatever was posted most
  recently. It's backed by a single text index on title + company, title
  weighted higher — searching "stripe" should find Stripe's jobs, but
  searching "engineer" shouldn't rank every company with "engineering" in
  its name first.
- **Indexes were rebuilt around the real query shape**: `isActive` leads
  every compound index because it's the one filter that is never absent,
  which lets a single index serve both "this category, newest first" and
  "everything, newest first". The old standalone `roleCategory` / `country`
  / `workType` indexes are gone. Note that Mongoose creates new indexes but
  never drops removed ones — on a collection that already has the old ones,
  they have to be dropped by hand.
- **Not yet verified against a live database.** The query building, the
  staleness rules and the taxonomy are covered by 29 tests that need no
  server. What hasn't been exercised is the Mongo-side behaviour —
  `$setOnInsert` on `fetchedAt`, the text index, the sweep's `updateMany` —
  because there's no in-memory MongoDB in the dependencies and adding one
  would cost a 100MB download in CI. It should be run once against the real
  Atlas cluster before the LMSes point at it.

## Fixing the rule that hid 41% of the board

- **What went wrong**: rule 2 retired anything whose `postedAt` was older
  than 45 days. On the first live run that hid 3,261 of 7,929 postings —
  most of them jobs sitting right there on Greenhouse that morning.
- **The mistake was mixing up two claims.** "Posted a while ago" and "gone"
  are different things, and only the second justifies hiding a job. I had
  reasoned about the window-limited sources, where absence genuinely tells
  you nothing, and then applied the same age test to the complete feeds,
  where we have positive daily evidence the job is still listed.
- **Rule 2 now asks when we last *saw* it**, not when it was posted:
  `lastSeenAt` older than 30 days. A job confirmed this morning stays up
  however old the posting is; a Himalayas listing seen once and never again
  still ages out on schedule, because we stop seeing it. Both rules are now
  about evidence.
- **No offline test would have caught this.** Every assertion passed —
  the rule did exactly what it said. What exposed it was one run against
  real data and looking at the resulting number. Worth remembering that a
  green suite only proves the code matches the intent, not that the intent
  was right.
- **`scripts/resweep.js` exists because fixing a rule doesn't un-hide
  anything.** The daily run only judges what it just fetched, so rows keep
  the verdict of whatever rule retired them. The script clears every
  verdict and decides again from scratch: it reactivated all 3,261 and the
  new rules correctly retired none of them, since every row had been
  confirmed hours earlier. Run it after changing any staleness constant.

## Two papercuts, closed

- **The pipeline now reads a `.env` file.** It never did — `connection.js`
  read `process.env.MONGO_URI` and nothing loaded a file, so a `.env`
  sitting there would have been silently ignored and every manual run meant
  pasting a connection string into the shell. It uses Node's own
  `process.loadEnvFile()` rather than the dotenv package, so the repo keeps
  its near-zero dependency count. Real environment variables still win, so
  a laptop's `.env` can never override what CI passes in.
- **Himalayas was not blocked, it was going too fast.** Two live runs got
  `429` and contributed zero jobs. A 24h pull is ~123 requests and they
  were being issued as fast as the event loop could manage them. A 250ms
  pause between pages plus exponential backoff on 429/503 (honouring
  `Retry-After` when sent) took it from **0 jobs to 3,520**, at a cost of
  about a minute.
- **A 429 mid-run no longer throws away the pages already fetched.** It
  used to: being throttled on page 80 of 123 discarded 1,600 perfectly good
  jobs. It now keeps what it has and logs where it stopped, which matches
  how the rest of the pipeline treats a source failing partway.

## The rolling ten-day board

- **What was asked for**: a board that only ever shows jobs from the last
  ten days. Accumulate for ten days, then each new day pushes the oldest
  day off the back — day 11 drops day 1's jobs and adds its own.
- **It keys on the employer's posting date, not on when we saw it.**
  That was worth measuring rather than assuming: `postedAt` turns out to be
  present on **99.9%** of stored rows — 6 of 10,696 lack it, all LinkedIn —
  so "ten days old" can mean what it actually says. The six fall back to
  when we first saw them.
- **The window is applied when the board reads, not written into a flag by
  the nightly run.** Three reasons, and the third is the real one:
  - It is exact. A swept flag is only as fresh as the last run, so a job
    crossing the line at noon would linger until 6am.
  - Changing it is a one-line change that takes effect immediately, instead
    of needing every stored row re-judged.
  - It keeps `isActive` meaning exactly one thing: *the employer withdrew
    this*. Age and withdrawal are different facts, and merging them into one
    flag is precisely what produced this project's worst bug.
- **So the nightly sweep lost a rule and got simpler.** It now decides
  withdrawal only — a job missing from a complete feed (Greenhouse, Ashby,
  now Lever) for more than the grace window. The old 30-day "unconfirmed"
  rule is gone: with a ten-day board nothing survives to reach it.
- **What the window does to the numbers**: 10,696 stored → **5,273 on the
  board**. Roughly half, and the shape is steep — 3 days gives 4,160 and 30
  days only 6,633, because these feeds are heavily weighted to the last
  week. Widening the window buys much less than it looks like it should.
- **`db/purgeOldJobs.js` is new, and is the only thing in the pipeline that
  deletes.** Without it the collection only grows: ~2,700 new rows a day is
  about a million a year, and the free Atlas tier stops at 512MB. It
  deletes at 60 days, six times the board's window — the margin is what
  lets you widen the window to fourteen days and immediately have the jobs
  to fill it, and what you read when asking why a listing never appeared.
- **A row whose dates are both unknown is never deleted.** Deleting is the
  one irreversible act here, so the filter requires a real date rather than
  treating "no date" as "old".
- **A latent bug fell out of this.** The dashboard's place filter assigned
  to `filter.$or`, and the window is itself an `$or` — the second would
  have silently replaced the first, so "India" plus the window would have
  quietly returned the wrong set. Both now go under one `$and`.

## Ranking: against the syllabus, not against the word "AI"

- **Newest-first was burying the point of the board.** Business and Tech are
  two thirds of the feed, so page one was sales and ops while the AI roles
  sat pages deep. Sorting is `relevance` first, `postedAt` breaking ties.
- **The first attempt ranked the acronym, and it showed.** Scoring on
  "does the title say AI" put *VP – Distinguished Engineer of Generative AI*
  at position 12 and *Senior Director of Engineering, AI Agents* at 11, while
  *Claude MCP / AI Automation Developer — Small Business Operations* — the
  single closest match on the whole board — sat at 33. Every one of those
  says AI. Only one is a job a graduate can actually do.
- **It also barely sorted.** 9,950 listings held 13 distinct scores, 66 of
  them tied at 85 and 4,390 tied at 10. The "ranking" was seven buckets,
  ordered by date inside each.

### What replaced it

- **`pipeline/syllabus.js` is the vocabulary, transcribed from the
  curriculum.** Not a general AI word list — the two real curricula in
  `menler-lms/server/scripts/curricula.js`, the AI Kickstarter (4 sessions)
  and the Claude-First AI Generalist Fellowship (6 weeks). Every band cites
  the session or week it came from, so "why is this job ranked here" is
  answerable from the syllabus rather than from a regex tuned by feel.
- **Four bands, by how directly they match what is taught**: the Claude
  spine (claude, Claude Code, MCP, prompt engineering, AI agents) is worth
  most; then the role *shape* the programme produces (AI generalist,
  automation specialist, no-code, voice agent, vibecoding); then the named
  tools it puts in students' hands (n8n, Zapier, Lovable, Replit,
  ElevenLabs, VAPI, Midjourney, Runway, Perplexity, NotebookLM); and last,
  well behind, the adjacent words (generative AI, LLM, machine learning).
- **The adjacent band is the correction.** Those words used to be worth as
  much as naming Claude, and they are roughly twenty times more common.
- **Two things subtract.** Seniority the programme does not bridge (VP,
  Director, Head of, Principal/Distinguished/Staff, "10+ years") and depth it
  never teaches (research scientist, PhD, MLOps, CUDA, model training,
  computer vision). Capped, because the point is to move these down the
  board, not to bury them.
- **"Director" is exempt in the creative trades.** Art Director and Creative
  Director are ordinary career titles, and Fellowship W3 teaches creative
  direction — penalising them would have been exactly backwards.
- **Reachability counts.** An entry-level opening is worth more to a
  graduate than a senior one with identical wording, so `experienceLevel`
  adjusts the score.
- **Evidence decays.** The first match counts full, the second 60%, the
  third 35%. A description listing twenty tools cannot outscore a title that
  names one.

### What it produces

- **The top of the board is now the syllabus.** Measured on 10,647 live
  listings after a full run: Claude MCP / AI Automation Developer (86), AI
  Workflow Specialist – Claude Expert (76), AI agent engineer (75), AI
  Transformation & Enablement Specialist (73), AI Forward Deployed Engineer
  (71), No-Code & AI Specialist (70), Conversational AI Operations Specialist
  (70). The exec and research roles that used to lead are at the bottom.
- **76 distinct scores instead of 13**, so the order at the top means
  something rather than being date within a bucket.
- **The India board is the clearest win**, because it was the thinnest: it
  now opens on *AI Workflow Specialist – Claude Expert*, then an **AI/ML
  Intern** matching claude, mcp, ai agents, chatgpt, gemini and hugging face,
  then *Agentic AI Trainer* matching claude, prompt engineering, n8n and
  zapier. None of those would have surfaced on a title-only score.
- **1,404 of 10,647 listings carry syllabus evidence.** The rest score on
  category alone, which is the honest shape of any job board — most jobs
  have nothing to do with what you teach.
- **A search term still switches ranking off.** Someone typing "video
  editor" means it, and ranking AI roles above their own query would be the
  board arguing with them.

### `matchedSkills`, and why it is stored

- **Each job stores the syllabus terms it matched** — `["claude", "n8n",
  "prompt engineering"]`. Where one matched name contains another the more
  specific wins, so "Claude Code" counts once rather than scoring as both
  `claude` and `claude code`. Skeo and the dashboard show them under the listing
  ("Matches what you're learning: …"), which is the difference between an
  order a student trusts and one that looks arbitrary.
- **It is also what makes a rescore possible.** Descriptions are never
  stored, and 99% of syllabus evidence lives in the body text, so without
  this a later rescore could only ever see the title again. Every term name
  re-matches its own pattern — which is why the stored term is `"cursor ai"`
  and not `"cursor"` — so feeding the stored terms back in place of the
  description reproduces the live score exactly. A test pins that.
- **`scripts/backfillRelevance.js`** rescores the backlog, and is what you
  run after changing `syllabus.js` — otherwise new jobs use the new rule and
  everything already stored keeps the old one, and the board is sorted by two
  rules at once. Rows written before `matchedSkills` existed score from the
  title alone until the next daily run refreshes them.

## Reachability: the question relevance was not answering

- **Relevance answers "does this match what we teach". It does not answer
  "could this student get it".** A Staff Engineer role in San Francisco
  wanting ten years and a US work visa can match the syllabus perfectly and
  be useless to somebody finishing six weeks of study in Coimbatore.
- **So three more scores sit beside it**, in `pipeline/ranking.js`:
  `achievability` (level, title seniority, years demanded), `indiaFit`
  (India-based, or remote that really hires from India), `easeOfApply`
  (direct link, no take-home, no degree gate). `rankScore` weights all four
  0.40 / 0.30 / 0.18 / 0.12 and the board sorts on it.
- **Three rules are where the obvious version goes wrong.** A junior word in
  the title beats a senior one, so "AI Intern - Supporting Senior Engineers"
  is an internship. "Remote" plus "must be authorized to work in the US" is
  not open, and scores near zero. And an Indian role quoted in USD is still
  an Indian role, because currency says nothing about eligibility.
- **"Associate" cost two goes to get right.** It overrides the seniority
  list, which is correct for "Associate Software Engineer" and wrong for
  "Associate Director", "Associate Vice President" and "Associate Manager" -
  at Accenture an Associate Manager is eight years in. The first version put
  two Accenture Associate Manager roles at the top of a sample run.

### The rule that is not a weighted average

- **Weighting relevance fourth breaks on jobs that are not on-topic at all.**
  Measured on a 525-job sample: a bank's walk-in hiring drive for a customer
  service executive in Chennai is entry level, in India, and easy to apply
  to, so it scored 74 and ranked third. Four of the top seven were walk-in
  drives and call-centre roles.
- **No weighting fixes that.** Relevance at 0.12 moves such a job by four
  points, and raising its weight far enough to matter would undo the priority
  order the board is supposed to have.
- **So below a threshold, relevance scales the score instead of adding to
  it** (`OFF_TOPIC_DAMPING`). 15 sits above a category floor with no syllabus
  match (Business scores 12) and below every category that has one (Creative,
  Writing and Marketing 18, Tech 20). The walk-in drive drops from 74 to 44;
  an Indian AI engineering role at 79 does not move. Set `multiplier: 1` to
  get the pure weighted sum.
- **Every job stores `rankReasons`**, so a position can be accounted for:
  `["internship", "remote, hires from India", "direct apply", "matches
  claude"]`.

## More of India, and what is closed

- **The scrapers were the upstream half.** No ranking can surface a listing
  that was never fetched, and the India sweep asked 31 nationwide keywords
  and nothing else. It now also runs 8 fresher-specific terms ("fresher",
  "graduate engineer trainee", "0-1 years") and crosses 3 broad terms with 15
  locations - the metros, the tier-2 cities where competition is thinner, and
  "India remote".
- **The arithmetic is the design.** Crossing all 31 keywords with all 15
  locations is 465 JobSpy calls at 15-25 seconds each, which is three hours
  inside a 6am cron. Three broad terms against 15 locations is 45 calls.
  `search_plan()` exists so that budget is countable without running
  anything: India went 31 -> 84 calls, global 50 -> 66.
- **Instahyre is the one new source that is open on both counts.** Its
  robots.txt carries no rules and it serves an unauthenticated JSON API with
  13,000 Indian listings, filterable by job function. It gives no posting
  date and no description, so its rows enter the window on first-seen and
  score lower than sources that ship a full JD - which is correct, less
  evidence should mean less confidence.
- **Everything else is shut.** Naukri's robots.txt names `claudebot`,
  `Claude-User` and `Claude-SearchBot` under `Disallow: /`. Foundit disallows
  `/jobs/` and `/search/` for AI crawlers by name. Internshala disallows every
  search and detail path. Cutshort's robots allows listings but its terms
  prohibit "automated access, bots, scraping, data extraction" outright -
  though it publishes a publicly documented API and MCP server, which is a
  sanctioned route if that coverage is ever wanted.

## A bug that scored nothing, and how it hid

- **The word-boundary escapes were literal backspace bytes.** A patch script
  wrote `\b` through a JavaScript template literal, where it means the
  backspace control character, not the regex escape. Every pattern compiled
  fine, matched nothing, and every job scored exactly its category base.
- **It looked like it worked.** The relative order was still right — AI-Tech
  above Business — so a test comparing scores to each other would have
  passed. What exposed it was printing an absolute number and noticing
  "Claude Prompt Engineer" scored 60 when the rule says 85.
- **The same corruption had already shipped.** The Lever mapper's
  `/\bremote\b/i` had been written by the same kind of patch, so for every
  Lever job the remote check silently never fired — it had been relying on
  `workplaceType` alone since the day it was added.
- **Two things came out of it**: the patch scripts now assert that no
  control characters exist in the file before writing, and the tests assert
  an absolute score, not just an ordering.

## AmbitionBox, and what the other requested sources turned out to be

Checked all six by hand rather than assuming:

- **AmbitionBox** — open, and now a source. No API, but the jobs page is
  server-rendered by Next.js, so the data is already in the page as JSON.
  Worth being honest about the size: **~20 jobs a run**. Only the bare
  `/jobs` URL returns anything; `?page=2`, `?keyword=`, and every category
  path answer 200 with an empty 20KB shell. It matters anyway because its
  `portal` field usually says "naukri" — it is Naukri's listings reached
  without Naukri's wall, and India is where the board is thinnest.
- **Naukri** — re-checked today with the documented `appid`/`systemid`
  headers: still `406 {"message":"recaptcha required"}`. Unchanged.
- **Fiverr** — `403`. **Upwork** — `403` behind a bot wall; its job RSS was
  retired years ago.
- **pmjobsdaily.netlify.app** — reads a Supabase project whose anon key is
  in the page, but the `jobs` table answers `200 []` to an anonymous caller:
  it is access-controlled, and getting at it would mean using someone's
  account. Its own `daily_job_counts` table puts it at ~110 jobs a day, and
  it is product-management only.
- **Mercor** — already ingested, 127 rows, via its Ashby board.
