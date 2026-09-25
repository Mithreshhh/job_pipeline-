/**
 * Tests for the Instahyre source.
 *
 * The API is undocumented, so the behaviour worth pinning is what happens
 * when it misbehaves: a bad page must cost that page, not the morning's
 * Indian coverage.
 *
 * No network. Every test injects a fake fetch.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { fetchInstahyre, PAGE_SIZE } = require("../scrapers/instahyre.js");
const { normalizeEntry } = require("../pipeline/normalize.js");

/** A fake API holding `total` jobs, handing out PAGE_SIZE at a time. */
function fakeApi(total, { failAtOffset = null, status = 200 } = {}) {
  const calls = [];

  const fetchImpl = async (url) => {
    const offset = Number(new URL(url).searchParams.get("offset"));
    calls.push(offset);

    if (failAtOffset !== null && offset >= failAtOffset) {
      return { ok: false, status: 500, json: async () => ({}) };
    }
    if (status !== 200) return { ok: false, status, json: async () => ({}) };

    const jobs = [];
    for (let i = offset; i < Math.min(offset + PAGE_SIZE, total); i += 1) {
      jobs.push({
        id: i,
        title: `AI Engineer ${i}`,
        locations: "Bangalore",
        keywords: ["Python", "LLM"],
        public_url: `https://www.instahyre.com/job-${i}/`,
        employer: { company_name: "Acme" },
      });
    }
    return { ok: true, status: 200, json: async () => ({ objects: jobs, meta: { total_count: total } }) };
  };

  return { fetchImpl, calls };
}

test("pages until the cap and stops", async () => {
  const { fetchImpl, calls } = fakeApi(1000);
  const [entry] = await fetchInstahyre({ maxJobs: 70, fetchImpl });

  assert.equal(entry.source, "instahyre");
  assert.equal(entry.jobs.length, 70);
  assert.deepEqual(calls, [0, 35]);
});

test("stops at the end of the feed rather than paging into nothing", async () => {
  const { fetchImpl, calls } = fakeApi(40);
  const [entry] = await fetchInstahyre({ maxJobs: 600, fetchImpl });

  assert.equal(entry.jobs.length, 40);
  // Two pages covers 40 rows; a third request would be wasted.
  assert.equal(calls.length, 2);
});

test("a failure part way through keeps what it already has", async () => {
  // 300 Indian jobs is a better morning than none because page three timed
  // out. This is the behaviour Himalayas lacked when it aborted mid-fetch.
  const { fetchImpl } = fakeApi(1000, { failAtOffset: 70 });
  const [entry] = await fetchInstahyre({ maxJobs: 600, fetchImpl });

  assert.equal(entry.jobs.length, 70);
});

test("a dead API is an empty day, not a thrown error", async () => {
  const { fetchImpl } = fakeApi(1000, { status: 403 });
  const [entry] = await fetchInstahyre({ maxJobs: 600, fetchImpl });

  assert.deepEqual(entry.jobs, []);

  const thrown = async () => {
    throw new Error("socket hang up");
  };
  const [second] = await fetchInstahyre({ maxJobs: 600, fetchImpl: thrown });
  assert.deepEqual(second.jobs, []);
});

test("the mapper reads the shape the API actually returns", () => {
  const raw = {
    id: 412500,
    title: "Machine Learning Engineer IV",
    locations: "Bangalore",
    keywords: ["Computer Vision", "OpenCV"],
    public_url: "https://www.instahyre.com/job-412500-mle-at-amazon-bangalore/",
    employer: { company_name: "Amazon" },
  };

  const { jobs } = normalizeEntry({ source: "instahyre", jobs: [raw] }, { fetchedAt: "2026-09-25T00:00:00Z" });
  const job = jobs[0];

  assert.equal(job.title, "Machine Learning Engineer IV");
  assert.equal(job.company, "Amazon");
  assert.equal(job.country, "India");
  assert.equal(job.source, "instahyre");
  assert.equal(job.url, raw.public_url);

  // The API carries no date. Defaulting it to today would present a
  // six-month-old listing as this morning's, so it stays null and the
  // read-time window falls back to fetchedAt.
  assert.equal(job.postedAt, null);
});

test('"Work From Home" is the only way this source says remote', () => {
  const remote = normalizeEntry(
    { source: "instahyre", jobs: [{ title: "AI Engineer", locations: "Work From Home", public_url: "https://x.test/1", employer: {} }] },
    { fetchedAt: "2026-09-25T00:00:00Z" },
  );
  const onsite = normalizeEntry(
    { source: "instahyre", jobs: [{ title: "AI Engineer", locations: "Bangalore", public_url: "https://x.test/2", employer: {} }] },
    { fetchedAt: "2026-09-25T00:00:00Z" },
  );

  assert.equal(remote.jobs[0].isRemote, true);
  assert.equal(onsite.jobs[0].isRemote, false);
});

test("a listing with no apply link cannot be ranked above one with a link", () => {
  // public_url is occasionally absent. Such a row is unapplyable, and
  // easeOfApply is the axis that has to notice without a description.
  const { jobs } = normalizeEntry(
    {
      source: "instahyre",
      jobs: [
        { title: "AI Engineer", locations: "Pune", public_url: null, employer: { company_name: "A" } },
        { title: "AI Engineer", locations: "Pune", public_url: "https://x.test/1", employer: { company_name: "B" } },
      ],
    },
    { fetchedAt: "2026-09-25T00:00:00Z" },
  );

  const [noLink, withLink] = jobs;
  assert.equal(noLink.easeOfApply, 0);
  assert.ok(withLink.rankScore > noLink.rankScore);
});
