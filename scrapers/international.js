/**
 * International / global scrapers, complementing scrapers/india.py:
 *
 * - JobSpy (Indeed + LinkedIn) with no India restriction - shells out to
 *   scrapers/jobspy_global.py, since JobSpy is a Python-only library.
 * - Four free, no-API-key JSON job boards focused on remote work:
 *   RemoteOK, Arbeitnow, Jobicy and Himalayas.
 *
 * Like the India scrapers, nothing is normalized here. Each source's raw
 * response is written to db/raw/ separately and untouched - matching the
 * AI keyword list against these feeds happens in the later normalize step.
 */

"use strict";

const path = require("path");
const fs = require("fs/promises");
const { spawnSync } = require("child_process");

const SCRAPERS_DIR = __dirname;
const JOBSPY_SCRIPT = path.join(SCRAPERS_DIR, "jobspy_global.py");
const OUTPUT_DIR = path.join(SCRAPERS_DIR, "..", "db", "raw");

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * fetch() that backs off instead of giving up when a host says "slow down".
 *
 * A 429 is not a failure, it is a request to wait - treating it as fatal is
 * how a source that would have answered ends up contributing nothing. 503 is
 * included because it is what a rate limiter behind a CDN often returns
 * instead. Anything else (404, 500) is returned as-is for the caller to judge.
 *
 * Honours Retry-After when the server sends one, since a guess is worse than
 * being told.
 */
async function fetchPolitely(url, { headers = DEFAULT_HEADERS, retries = 3 } = {}) {
  let wait = 2000;

  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, { headers });
    if (response.status !== 429 && response.status !== 503) return response;
    if (attempt >= retries) return response;

    const retryAfter = Number(response.headers.get("retry-after"));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : wait;
    await sleep(Math.min(delay, 30000));
    wait *= 2;
  }
}

/** Runs jobspy_global.py (Indeed across major markets + LinkedIn globally). */
function runJobSpyGlobal() {
  const result = spawnSync("python", [JOBSPY_SCRIPT], {
    encoding: "utf-8",
    maxBuffer: 1024 * 1024 * 200,
  });

  if (result.status !== 0) {
    throw new Error(`jobspy_global.py failed: ${result.stderr}`);
  }

  return JSON.parse(result.stdout);
}

/**
 * RemoteOK. Returns a plain array where the first element is always
 * RemoteOK's API terms notice rather than a job, so that entry is dropped.
 * Their terms require crediting/linking back to RemoteOK when displaying
 * these listings.
 */
async function fetchRemoteOk() {
  const response = await fetch("https://remoteok.com/api", {
    headers: DEFAULT_HEADERS,
  });

  if (!response.ok) {
    throw new Error(`RemoteOK request failed: ${response.status}`);
  }

  const data = await response.json();
  return Array.isArray(data) ? data.slice(1) : [];
}

/**
 * Arbeitnow. Paginated at 250 jobs per page, refreshed hourly. Its API has
 * no keyword/tag search (the params are accepted but ignored), so this
 * pulls the most recent page(s) whole and leaves filtering to normalize.
 */
async function fetchArbeitnow({ pages = 1 } = {}) {
  const jobs = [];

  for (let page = 1; page <= pages; page += 1) {
    const url = new URL("https://arbeitnow.com/api/job-board-api");
    url.searchParams.set("page", String(page));

    const response = await fetch(url, { headers: DEFAULT_HEADERS });
    if (!response.ok) {
      throw new Error(`Arbeitnow request failed: ${response.status}`);
    }

    const data = await response.json();
    jobs.push(...(data.data || []));

    if (!data.links || !data.links.next) break;
  }

  return jobs;
}

/** Jobicy. Remote-only board; `count` caps how many jobs come back. */
async function fetchJobicy({ count = 50 } = {}) {
  const url = new URL("https://jobicy.com/api/v2/remote-jobs");
  url.searchParams.set("count", String(count));

  const response = await fetch(url, { headers: DEFAULT_HEADERS });
  if (!response.ok) {
    throw new Error(`Jobicy request failed: ${response.status}`);
  }

  const data = await response.json();
  return data.jobs || [];
}

/**
 * Himalayas, limited to the last 24 hours.
 *
 * Their API ignores a `postedAfter` query param (tested - same ~100k job
 * feed either way) and also ignores `limit`, always returning 20 jobs per
 * page. The feed is strictly newest-first though, so the 24h window is
 * applied here: page through with their cursor and stop at the first job
 * older than the cutoff.
 *
 * maxPages is only a runaway guard. At 20 jobs/page a full 24h measured
 * ~123 pages (~2.5k jobs, ~85s), so it's set well above that - if it ever
 * becomes the thing that stops the loop, the result is silently truncated
 * rather than actually covering 24h.
 *
 * Paced, because ~123 requests as fast as the event loop can issue them is
 * what got this source rate-limited to nothing on two live runs. A quarter
 * of a second between pages costs about 30s and is the difference between
 * ~2,400 jobs and zero.
 */
async function fetchHimalayasLast24h({ maxPages = 250, pageDelayMs = 250 } = {}) {
  const cutoff = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
  const jobs = [];
  let cursor = null;

  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL("https://himalayas.app/jobs/api");
    if (cursor) url.searchParams.set("cursor", cursor);

    if (page > 0) await sleep(pageDelayMs);

    const response = await fetchPolitely(url);
    if (!response.ok) {
      // Only fatal when it cost us everything. Having paged through 80 of
      // 123 pages and then being throttled is worth 1,600 jobs, and throwing
      // here would discard all of them.
      if (jobs.length > 0) {
        console.warn(
          `[himalayas] stopped early at page ${page}: HTTP ${response.status} (keeping ${jobs.length} jobs)`
        );
        break;
      }
      throw new Error(`Himalayas request failed: ${response.status}`);
    }

    const data = await response.json();
    const pageJobs = data.jobs || [];

    let reachedOlderJobs = false;
    for (const job of pageJobs) {
      if (job.pubDate && job.pubDate < cutoff) {
        reachedOlderJobs = true;
        break;
      }
      jobs.push(job);
    }

    if (reachedOlderJobs || pageJobs.length === 0 || !data.nextCursor) break;
    cursor = data.nextCursor;
  }

  return jobs;
}

async function writeRaw(filename, payload) {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(
    path.join(OUTPUT_DIR, filename),
    JSON.stringify(payload, null, 2),
    "utf-8"
  );
}

/**
 * Each free API is fetched independently so one being down or rate-limited
 * doesn't lose the others' results.
 */
async function fetchFreeApis() {
  const sources = [
    { name: "remoteok", fetcher: fetchRemoteOk },
    { name: "arbeitnow", fetcher: fetchArbeitnow },
    { name: "jobicy", fetcher: fetchJobicy },
    { name: "himalayas", fetcher: fetchHimalayasLast24h },
  ];

  const results = [];
  for (const { name, fetcher } of sources) {
    try {
      const jobs = await fetcher();
      results.push({ source: name, jobs });
      console.log(`${name}: ${jobs.length} jobs`);
    } catch (err) {
      results.push({ source: name, error: err.message, jobs: [] });
      console.error(`${name}: failed - ${err.message}`);
    }
  }

  return results;
}

async function main() {
  console.log("Fetching free remote job APIs...");
  const freeApiResults = await fetchFreeApis();

  for (const result of freeApiResults) {
    await writeRaw(`${result.source}_raw.json`, result);
  }

  console.log("Running JobSpy (Indeed + LinkedIn, global)...");
  const jobspyResults = runJobSpyGlobal();
  await writeRaw("jobspy_international_raw.json", jobspyResults);
  console.log(`JobSpy: ${jobspyResults.length} keyword/market combos`);
}

module.exports = {
  runJobSpyGlobal,
  fetchRemoteOk,
  fetchArbeitnow,
  fetchJobicy,
  fetchHimalayasLast24h,
  fetchFreeApis,
};

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
