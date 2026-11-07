/**
 * The sources added to reach a 1 lakh board: the wide Indeed sweep, its
 * reserve tier, and SmartRecruiters. No network; the Indeed plan is read from
 * the Python module itself so the counts here cannot drift from it.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { spawnSync } = require("child_process");

const { normalizeRaw } = require("../pipeline/normalize.js");
const { SOURCE_VALUES } = require("../pipeline/taxonomy.js");
const { boardFilter, needsReserve, BOARD_TARGET } = require("../db/boardSize.js");
const { WIDEST_BOARD_DAYS } = require("../db/purgeOldJobs.js");
const { SOURCES } = require("../scripts/runDaily.js");

const SCRAPERS = path.join(__dirname, "..", "scrapers");

function indeedPlan() {
  const code = [
    "import sys, json",
    `sys.path.insert(0, ${JSON.stringify(SCRAPERS)})`,
    "import indeed_wide as w",
    "core = w.search_plan('core'); reserve = w.search_plan('reserve')",
    "print(json.dumps({'core': core, 'reserve': reserve, 'india': w.entry_source('India'), 'uk': w.entry_source('UK')}))",
  ].join("\n");
  const result = spawnSync("python", ["-c", code], { encoding: "utf-8" });
  return result.status === 0 ? JSON.parse(result.stdout) : null;
}

const plan = indeedPlan();

test("the Indeed sweep searches India by name and keeps the USA in reserve", { skip: !plan && "no python" }, () => {
  const markets = (pairs) => [...new Set(pairs.map(([, market]) => market))];
  assert.ok(markets(plan.core).includes("India"));
  assert.ok(!markets(plan.core).includes("USA"));
  assert.deepEqual(markets(plan.reserve), ["Canada", "Australia", "USA"]);
  // The call budget: a change to the lists shows up here as a number.
  assert.strictEqual(plan.core.length, 118);
  assert.strictEqual(plan.reserve.length, 60);
  const pairs = plan.core.map(([term, market]) => `${term}|${market}`);
  assert.strictEqual(new Set(pairs).size, pairs.length, "no search asked twice");
});

test("Indian Indeed rows are labelled so normalize reads them as Indian", { skip: !plan && "no python" }, () => {
  assert.strictEqual(plan.india, "jobspy");
  assert.strictEqual(plan.uk, "jobspy-indeed");

  const row = { site: "indeed", title: "Sales Executive", company: "Acme", location: "Leeds", job_url: "https://uk.indeed.com/viewjob?jk=1", date_posted: "2026-11-06" };
  const { jobs } = normalizeRaw([{ source: plan.uk, jobs: [row] }]);
  assert.strictEqual(jobs[0].country, "International");
  const { jobs: indian } = normalizeRaw([{ source: plan.india, jobs: [{ ...row, location: "Pune, MH" }] }]);
  assert.strictEqual(indian[0].country, "India");
});

test("exactly one source is the reserve, and it is the Indeed sweep abroad", () => {
  const reserve = SOURCES.filter((source) => source.reserve);
  assert.strictEqual(reserve.length, 1);
  assert.match(reserve[0].name, /USA/);
});

test("the reserve runs below the target, and when the board cannot be counted", () => {
  assert.strictEqual(needsReserve(BOARD_TARGET - 1), true);
  assert.strictEqual(needsReserve(BOARD_TARGET), false);
  assert.strictEqual(needsReserve(null), true);
  assert.strictEqual(needsReserve(NaN), true);
  assert.ok(BOARD_TARGET >= 100000, "the floor Skeo promises");
});

test("the board is counted the way Skeo shows it: live, inside its window", () => {
  const now = Date.parse("2026-11-07T00:30:00Z");
  const filter = boardFilter({ now });
  assert.strictEqual(filter.isActive, true);
  const since = filter.$or[0].postedAt.$gte;
  assert.strictEqual(now - since.getTime(), WIDEST_BOARD_DAYS * 24 * 60 * 60 * 1000);
  assert.deepEqual(filter.$or[1], { postedAt: null, fetchedAt: { $gte: since } });
});

// A real record from the public postings API, trimmed.
const SWIGGY = {
  id: "6000000001557489",
  name: "Associate Product Manager",
  company: { identifier: "SWIGGY", name: "SWIGGY" },
  releasedDate: "2026-11-06T09:56:40.615Z",
  location: { city: "Bengaluru", region: "KA", country: "in", remote: false, fullLocation: "Bengaluru, KA, India" },
  function: { id: "product_management", label: "Product Management" },
  typeOfEmployment: { id: "permanent", label: "Full-time" },
  experienceLevel: { id: "entry_level", label: "Entry Level" },
};

test("a SmartRecruiters posting becomes a full job, named as the board names it", () => {
  const { jobs, excluded } = normalizeRaw([{ source: "smartrecruiters", company: "Swiggy", jobs: [SWIGGY] }]);
  assert.strictEqual(excluded.length, 0);
  const job = jobs[0];
  assert.strictEqual(job.source, "smartrecruiters");
  assert.strictEqual(job.company, "Swiggy");
  assert.strictEqual(job.country, "India");
  assert.strictEqual(job.url, "https://jobs.smartrecruiters.com/SWIGGY/6000000001557489");
  assert.strictEqual(job.postedAt, "2026-11-06T09:56:40.615Z");
  assert.strictEqual(job.workType, "full-time");
  assert.strictEqual(job.domain, "product");
  assert.ok(SOURCE_VALUES.includes("smartrecruiters"));
});

test("a SmartRecruiters posting without an id has no link, rather than a broken one", () => {
  const { jobs, excluded } = normalizeRaw([{ source: "smartrecruiters", company: "Swiggy", jobs: [{ ...SWIGGY, id: undefined }] }]);
  const job = [...jobs, ...excluded][0];
  assert.strictEqual(job.url, null);
});
