/**
 * Daily pipeline: fetch -> normalize -> dedupe -> store.
 *
 * Every source is fetched inside its own try/catch, because these are seven
 * different websites and any one of them can be down, rate-limited or
 * blocked on a given morning. A single bad source costs us its jobs for the
 * day; it doesn't cost us the run.
 */

"use strict";

const path = require("path");
const { spawnSync } = require("child_process");

const international = require("../scrapers/international.js");
const { searchFreelancerBulk } = require("../scrapers/freelance.js");
const { fetchAiCompanyBoards } = require("../scrapers/aiCompanies.js");
const { fetchWeWorkRemotely } = require("../scrapers/weworkremotely.js");
const { normalizeRaw } = require("../pipeline/normalize.js");
const { dedupeJobs } = require("../pipeline/dedupe.js");
const { upsertJobs } = require("../db/upsertJobs.js");
const { deactivateStaleJobs } = require("../db/deactivateStale.js");
const { disconnectFromMongo } = require("../db/connection.js");

const SCRAPERS_DIR = path.join(__dirname, "..", "scrapers");

const KEYWORDS = [
  "machine learning engineer",
  "AI engineer",
  "data scientist",
  "NLP engineer",
  "deep learning engineer",
  "generative AI",
  "computer vision engineer",
  "MLOps",
  "AI researcher",
  "prompt engineer",
];


/**
 * Freelance marketplaces are searched with shorter, skill-style terms -
 * clients post "need an AI chatbot built", not "Machine Learning Engineer".
 * Covers creative and marketing gigs too, not just AI.
 */
const FREELANCE_KEYWORDS = [
  "machine learning",
  "artificial intelligence",
  "data science",
  "chatbot",
  "computer vision",
  "generative ai",
  "prompt engineering",
  "data annotation",
  "video editing",
  "video editor",
  "social media manager",
  "social media marketing",
  "graphic design",
  "motion graphics",
  "content writing",
  "copywriting",
  "seo",
  "web development",
  "ui ux design",
  "digital marketing",
];

/**
 * Reuses india.py's run_jobspy() rather than reimplementing it. JobSpy is
 * Python-only, so this asks Python for the results as JSON on stdout.
 */
function runJobSpyIndia() {
  const code = [
    "import sys, json",
    `sys.path.insert(0, ${JSON.stringify(SCRAPERS_DIR)})`,
    "import india",
    "print(json.dumps(india.run_jobspy()))",
  ].join("\n");

  const result = spawnSync("python", ["-c", code], {
    encoding: "utf-8",
    maxBuffer: 1024 * 1024 * 200,
  });

  if (result.status !== 0) {
    throw new Error(`india.py run_jobspy failed: ${result.stderr}`);
  }

  return JSON.parse(result.stdout);
}

/**
 * Each source returns entries shaped {source, jobs:[...]} - the same shape
 * normalize expects, so nothing needs reshaping here.
 */
const SOURCES = [
  {
    name: "jobspy indeed+linkedin (India)",
    run: async () => runJobSpyIndia(),
  },
  {
    name: "jobspy indeed+linkedin (international)",
    run: async () => international.runJobSpyGlobal(),
  },
  {
    name: "remoteok",
    run: async () => [{ source: "remoteok", jobs: await international.fetchRemoteOk() }],
  },
  {
    name: "arbeitnow",
    run: async () => [
      { source: "arbeitnow", jobs: await international.fetchArbeitnow({ pages: 4 }) },
    ],
  },
  {
    name: "jobicy",
    run: async () => [
      { source: "jobicy", jobs: await international.fetchJobicy({ count: 100 }) },
    ],
  },
  {
    name: "weworkremotely",
    run: () => fetchWeWorkRemotely(),
  },
  {
    name: "himalayas",
    run: async () => [
      { source: "himalayas", jobs: await international.fetchHimalayasLast24h() },
    ],
  },
  {
    name: "freelancer.com (gigs)",
    run: () => searchFreelancerBulk(FREELANCE_KEYWORDS),
  },
  {
    name: "ai company boards (greenhouse + ashby)",
    run: () => fetchAiCompanyBoards(),
  },
];

function countJobs(entries) {
  return entries.reduce(
    (total, entry) => total + (Array.isArray(entry.jobs) ? entry.jobs.length : 0),
    0
  );
}

/** Scrapers record per-request failures inline instead of throwing. */
function countPartialErrors(entries) {
  return entries.filter((entry) => entry.error).length;
}

async function fetchAllSources() {
  const entries = [];
  const failed = [];
  const contributions = [];

  for (const source of SOURCES) {
    console.log(`\n[fetch] ${source.name}...`);
    try {
      const sourceEntries = (await source.run()) || [];
      const jobCount = countJobs(sourceEntries);
      const partialErrors = countPartialErrors(sourceEntries);

      entries.push(...sourceEntries);
      contributions.push({ name: source.name, jobCount, partialErrors });

      const note = partialErrors > 0 ? ` (${partialErrors} request(s) failed)` : "";
      console.log(`[fetch] ${source.name}: ${jobCount} jobs${note}`);
    } catch (err) {
      failed.push({ name: source.name, error: err.message });
      contributions.push({ name: source.name, jobCount: 0, partialErrors: 0 });
      console.error(`[fetch] ${source.name} FAILED: ${err.message}`);
    }
  }

  return { entries, failed, contributions };
}

async function runDaily() {
  const startedAt = Date.now();
  // One timestamp for the whole run, rather than a fresh Date at each
  // step: the staleness sweep compares against the same instant the
  // upserts stamped, so a run that takes 20 minutes can't retire the jobs
  // it wrote at the start of itself.
  const runAt = new Date();
  console.log(`Daily job pipeline started ${runAt.toISOString()}`);

  const { entries, failed, contributions } = await fetchAllSources();
  const totalFetched = countJobs(entries);

  const { jobs, excluded } = normalizeRaw(entries);
  console.log(
    `\n[normalize] ${jobs.length} AI/ML jobs kept, ${excluded.length} filtered out as not relevant`
  );

  const deduped = dedupeJobs(jobs);
  console.log(
    `[dedupe] ${deduped.length} unique jobs (${jobs.length - deduped.length} duplicates merged)`
  );

  let upsertSummary = {
    received: 0,
    upserted: 0,
    modified: 0,
    skipped: 0,
    seenSources: [],
  };
  let staleSummary = { takenDown: 0, lapsed: 0, takenDownChecked: false };

  if (deduped.length > 0) {
    upsertSummary = await upsertJobs(deduped, { runAt });
    console.log(
      `[store] ${upsertSummary.upserted} new, ${upsertSummary.modified} updated, ${upsertSummary.skipped} skipped (no url)`
    );

    // Retire what has gone away, using only the sources that answered this
    // run. Skipped entirely when nothing was stored: a run that wrote no
    // jobs has no evidence about what is still live, and acting on it
    // would empty the board on the first bad morning.
    staleSummary = await deactivateStaleJobs({
      runAt,
      seenSources: upsertSummary.seenSources,
    });
    console.log(
      `[stale] ${staleSummary.takenDown} taken down, ${staleSummary.lapsed} unconfirmed`
    );
  } else {
    console.log("[store] nothing to write");
    console.log("[stale] skipped - nothing was stored, so nothing is proven");
  }

  console.log("\n=== Summary ===");
  console.log(`Duration:            ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  console.log(`Total jobs fetched:  ${totalFetched}`);
  console.log(`Relevant (AI/ML):    ${jobs.length}`);
  console.log(`After dedupe:        ${deduped.length}`);
  console.log(`Upserted (new):      ${upsertSummary.upserted}`);
  console.log(`Updated (existing):  ${upsertSummary.modified}`);
  // "not checked" and 0 mean different things: the first says no
  // complete-feed source reported, so the rule never ran.
  const takenDown = staleSummary.takenDownChecked
    ? staleSummary.takenDown
    : "not checked";
  console.log(`Retired (taken down): ${takenDown}`);
  console.log(`Retired (unseen):     ${staleSummary.lapsed}`);

  console.log("\nPer source:");
  for (const item of contributions) {
    const note = item.partialErrors > 0 ? `  [${item.partialErrors} request(s) failed]` : "";
    console.log(`  ${item.name}: ${item.jobCount}${note}`);
  }

  if (failed.length > 0) {
    console.log(`\nFailed sources (${failed.length}):`);
    for (const item of failed) console.log(`  ${item.name}: ${item.error}`);
  } else {
    console.log("\nNo sources failed.");
  }

  return {
    totalFetched,
    deduped: deduped.length,
    failed,
    upsertSummary,
    staleSummary,
  };
}

if (require.main === module) {
  runDaily()
    .then(async (result) => {
      await disconnectFromMongo();
      // Every source failing means we stored nothing - that's a red run,
      // not a quiet success.
      if (result.failed.length === SOURCES.length) {
        console.error("\nAll sources failed - exiting with failure.");
        process.exit(1);
      }
    })
    .catch(async (err) => {
      console.error("\nPipeline failed:", err);
      await disconnectFromMongo().catch(() => {});
      process.exit(1);
    });
}

module.exports = { runDaily, SOURCES, KEYWORDS, FREELANCE_KEYWORDS };
