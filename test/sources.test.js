/**
 * SmartRecruiters, the Indian company boards. No network.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { normalizeRaw } = require("../pipeline/normalize.js");
const { SOURCE_VALUES } = require("../pipeline/taxonomy.js");

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
