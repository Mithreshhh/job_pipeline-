/**
 * Instahyre.
 *
 * WHY IT IS HERE. India was the thinnest part of the board and the obvious
 * fixes are closed: Naukri's robots.txt names claudebot under `Disallow: /`,
 * Foundit disallows /jobs/ for AI crawlers specifically, Internshala
 * disallows every search and detail path, and Cutshort's terms prohibit
 * automated access outright. Instahyre is the one that is open on both
 * counts - its robots.txt carries no rules at all, and it serves an
 * unauthenticated JSON API.
 *
 * WHAT IT GIVES. 13,000 live Indian listings, filterable by job function.
 * This pulls the Data Science / Machine Learning function, which is ~1,660 of
 * them and the slice that matches what the programme teaches. Everything is
 * India by definition, which is the point.
 *
 * WHAT IT DOES NOT GIVE, which matters:
 *
 *   No posting date. The board's ten-day window keys on postedAt and falls
 *   back to fetchedAt, so these enter the window when we first see them and
 *   age out ten days later - regardless of how long the listing has actually
 *   been up. That is the honest limit of this source and the reason it is
 *   capped rather than drained.
 *
 *   No description. `keywords` is a skill array and stands in for one, so
 *   the syllabus scoring and pipeline/ranking.js both read a title and a
 *   skill list rather than prose. Scores from this source will read low
 *   against sources that ship a full description. That is correct: less
 *   evidence should mean less confidence, not a free pass.
 *
 * The API is undocumented, so this fails soft - an empty array rather than a
 * thrown error, the same as AmbitionBox.
 */

"use strict";

const API_URL = "https://www.instahyre.com/api/v1/job_search";

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json",
};

/**
 * Instahyre's own job-function ids. 9 is Data Science / Machine Learning.
 *
 * Deliberately not the whole catalogue: the other large functions are backend
 * and full-stack engineering, which arrive in quantity from every other
 * source already and would cost pages of requests to re-fetch.
 */
const JOB_FUNCTIONS = [9];

/** The server caps `limit` at 35 whatever you ask for, so this matches it. */
const PAGE_SIZE = 35;

/**
 * Stop after this many. ~600 is a third of the function and is the busiest
 * third, since the feed is ordered newest-first. Draining all 1,660 every
 * morning would be 48 requests for a long tail that the ten-day window
 * discards anyway.
 */
const MAX_JOBS = 600;

/** Polite spacing. Himalayas started returning 429s at roughly 8 requests a second. */
const REQUEST_SPACING_MS = 300;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One page. Returns the jobs plus the total, or null when the request fails -
 * the caller stops paging rather than treating a failure as "no more jobs".
 */
async function fetchPage({ offset, functions = JOB_FUNCTIONS, fetchImpl = fetch }) {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
  for (const id of functions) params.append("job_functions", String(id));

  const response = await fetchImpl(`${API_URL}?${params}`, { headers: DEFAULT_HEADERS });
  if (!response.ok) return null;

  const body = await response.json();
  if (!body || !Array.isArray(body.objects)) return null;

  return { jobs: body.objects, total: body?.meta?.total_count ?? null };
}

/**
 * Pages until MAX_JOBS, the end of the feed, or a failure.
 *
 * A failure part way through keeps what it already has. A morning that
 * returns 300 Indian jobs instead of 600 is a better outcome than one that
 * returns none because page nine timed out.
 */
async function fetchInstahyre({ maxJobs = MAX_JOBS, fetchImpl = fetch } = {}) {
  const jobs = [];

  try {
    for (let offset = 0; offset < maxJobs; offset += PAGE_SIZE) {
      const page = await fetchPage({ offset, fetchImpl });
      if (!page || page.jobs.length === 0) break;

      jobs.push(...page.jobs);

      if (page.total !== null && offset + PAGE_SIZE >= page.total) break;
      await sleep(REQUEST_SPACING_MS);
    }
  } catch {
    // Undocumented payload, so a shape change is a quiet day rather than a
    // broken run. Whatever was collected before the throw still ships.
  }

  return [{ source: "instahyre", jobs: jobs.slice(0, maxJobs) }];
}

module.exports = {
  fetchInstahyre,
  fetchPage,
  API_URL,
  JOB_FUNCTIONS,
  PAGE_SIZE,
  MAX_JOBS,
};
