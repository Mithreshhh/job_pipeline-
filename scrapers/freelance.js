/**
 * Freelance gigs from Freelancer.com.
 *
 * Of the big freelance marketplaces this is the only one with a public API
 * that answers without a key or partner approval. Upwork retired its job
 * RSS (410) and limits its GraphQL API to non-commercial use; Fiverr,
 * Toptal, Guru and PeoplePerHour publish no usable feed; Wellfound and
 * Braintrust sit behind a hard bot wall. So this is the freelance source,
 * not one of several.
 *
 * Their API terms ask that cached data be refreshed at least every 24h and
 * not retained indefinitely, which suits a pipeline that re-runs daily and
 * upserts.
 *
 * Note their `query` is a loose full-text match - searching "machine
 * learning" returns logo-design gigs - so the real filtering is done later
 * by the normalizer's keyword classification.
 */

"use strict";

const FREELANCER_ENDPOINT =
  "https://www.freelancer.com/api/projects/0.1/projects/active/";

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json",
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fetches active projects matching one keyword. Returns raw project objects. */
async function searchFreelancer({ query, limit = 50 }) {
  const url = new URL(FREELANCER_ENDPOINT);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("query", query);
  url.searchParams.set("job_details", "true");
  url.searchParams.set("full_description", "true");

  const response = await fetch(url, { headers: DEFAULT_HEADERS });
  if (!response.ok) {
    throw new Error(
      `Freelancer search failed for "${query}": ${response.status} ${response.statusText}`
    );
  }

  const data = await response.json();
  if (data.status !== "success") {
    throw new Error(`Freelancer returned status "${data.status}" for "${query}"`);
  }

  return (data.result && data.result.projects) || [];
}

/** Runs one search per keyword, spacing requests out to stay polite. */
async function searchFreelancerBulk(keywords, { delayMs = 700, limit = 50 } = {}) {
  const results = [];

  for (const keyword of keywords) {
    try {
      const jobs = await searchFreelancer({ query: keyword, limit });
      results.push({ keyword, source: "freelancer", jobs });
    } catch (err) {
      results.push({ keyword, source: "freelancer", error: err.message, jobs: [] });
    }
    await sleep(delayMs);
  }

  return results;
}

module.exports = { searchFreelancer, searchFreelancerBulk };
