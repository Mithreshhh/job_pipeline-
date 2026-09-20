/**
 * Collapses the same job posted on several boards into one record.
 *
 * Matching is on title + company rather than URL: every board mints its own
 * URL for the same posting, so a URL comparison would never find a
 * duplicate. The surviving record is the earliest one posted, since that's
 * the closest thing we have to where the job first appeared.
 */

"use strict";

function buildKey(job) {
  const title = typeof job.title === "string" ? job.title : "";
  const company = typeof job.company === "string" ? job.company : "";
  const clean = (value) => value.toLowerCase().replace(/\s+/g, " ").trim();

  // With no company there's nothing to tell two same-titled postings apart,
  // and generic titles are common - freelance gigs ("Logo design") and
  // listings where the board hid the employer. Falling back to the URL keeps
  // them separate instead of silently merging unrelated jobs.
  if (!clean(company)) {
    const url = typeof job.url === "string" ? job.url : "";
    return url ? `${clean(title)} @${clean(url)}` : clean(title);
  }

  return clean(`${title} ${company}`);
}

/** An unknown postedAt sorts last, so a real date always wins. */
function postedTime(job) {
  if (!job.postedAt) return Number.POSITIVE_INFINITY;

  const ms = Date.parse(job.postedAt);
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

/**
 * Returns a new array with duplicates merged. Each surviving job gains a
 * `sources` array naming every board it was found on.
 */
function dedupeJobs(jobs) {
  if (!Array.isArray(jobs)) return [];

  const indexByKey = new Map();
  const results = [];

  for (const job of jobs) {
    const key = buildKey(job);
    const sources = job.source ? [job.source] : [];

    // An empty key means no title and no company - there's nothing to match
    // on, so keep it rather than collapsing unrelated jobs into one.
    if (key === "" || !indexByKey.has(key)) {
      if (key !== "") indexByKey.set(key, results.length);
      results.push({ ...job, sources });
      continue;
    }

    const index = indexByKey.get(key);
    const kept = results[index];

    if (job.source && !kept.sources.includes(job.source)) {
      kept.sources.push(job.source);
    }

    // The duplicate is older, so it becomes the record we keep - carrying
    // over the sources collected so far.
    if (postedTime(job) < postedTime(kept)) {
      results[index] = { ...job, sources: kept.sources };
    }
  }

  return results;
}

module.exports = { dedupeJobs };
