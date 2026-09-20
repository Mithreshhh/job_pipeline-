"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { dedupeJobs } = require("../pipeline/dedupe.js");

/** A schema-shaped job, overridable per test. */
const job = (overrides) => ({
  title: null,
  company: null,
  location: null,
  country: "India",
  isRemote: false,
  url: null,
  source: null,
  roleCategory: "AI-Tech",
  workType: "unspecified",
  experienceLevel: "unspecified",
  postedAt: null,
  fetchedAt: "2026-09-19T00:00:00Z",
  ...overrides,
});

test("merges the same job from two boards and records both sources", () => {
  const result = dedupeJobs([
    job({ title: "AI Engineer", company: "Acme", source: "linkedin", url: "li", postedAt: "2026-09-15T00:00:00Z" }),
    job({ title: "AI Engineer", company: "Acme", source: "indeed", url: "in", postedAt: "2026-09-10T00:00:00Z" }),
  ]);

  assert.equal(result.length, 1);
  assert.deepEqual(result[0].sources, ["linkedin", "indeed"]);
  // The earliest posting wins, so its URL is the one kept.
  assert.equal(result[0].url, "in");
  assert.equal(result[0].postedAt, "2026-09-10T00:00:00Z");
});

test("matching ignores case and extra whitespace", () => {
  const result = dedupeJobs([
    job({ title: "  Machine   Learning Engineer ", company: " ACME  Labs ", source: "a", url: "u1", postedAt: "2026-09-12T00:00:00Z" }),
    job({ title: "machine learning engineer", company: "acme labs", source: "b", url: "u2", postedAt: "2026-09-11T00:00:00Z" }),
  ]);

  assert.equal(result.length, 1);
  assert.deepEqual(result[0].sources, ["a", "b"]);
});

test("the earliest posting wins even when it arrives in the middle", () => {
  const result = dedupeJobs([
    job({ title: "Data Scientist", company: "X", source: "remoteok", url: "u1", postedAt: "2026-09-14T00:00:00Z" }),
    job({ title: "Data Scientist", company: "X", source: "indeed", url: "u2", postedAt: "2026-09-09T00:00:00Z" }),
    job({ title: "Data Scientist", company: "X", source: "jobicy", url: "u3", postedAt: "2026-09-20T00:00:00Z" }),
  ]);

  assert.equal(result.length, 1);
  assert.equal(result[0].postedAt, "2026-09-09T00:00:00Z");
  assert.deepEqual(result[0].sources, ["remoteok", "indeed", "jobicy"]);
});

test("an unknown postedAt never beats a real date", () => {
  const result = dedupeJobs([
    job({ title: "ML Eng", company: "Y", source: "indeed", url: "u1", postedAt: null }),
    job({ title: "ML Eng", company: "Y", source: "linkedin", url: "u2", postedAt: "2026-09-08T00:00:00Z" }),
  ]);

  assert.equal(result[0].postedAt, "2026-09-08T00:00:00Z");
});

test("same title at different companies stays separate", () => {
  const result = dedupeJobs([
    job({ title: "AI Engineer", company: "Acme", source: "indeed", url: "u1" }),
    job({ title: "AI Engineer", company: "Globex", source: "indeed", url: "u2" }),
  ]);

  assert.equal(result.length, 2);
});

test("a repeated source is not listed twice", () => {
  const result = dedupeJobs([
    job({ title: "AI Engineer", company: "Acme", source: "indeed", url: "u1", postedAt: "2026-09-10T00:00:00Z" }),
    job({ title: "AI Engineer", company: "Acme", source: "indeed", url: "u2", postedAt: "2026-09-11T00:00:00Z" }),
  ]);

  assert.equal(result.length, 1);
  assert.deepEqual(result[0].sources, ["indeed"]);
});

test("jobs with no company fall back to the URL instead of merging", () => {
  // Freelance gigs expose no company name, and generic titles are common -
  // two unrelated "Logo design" gigs must not collapse into one.
  const result = dedupeJobs([
    job({ title: "Logo design", company: null, source: "freelancer", url: "https://f/1" }),
    job({ title: "Logo design", company: null, source: "freelancer", url: "https://f/2" }),
  ]);

  assert.equal(result.length, 2);
});

test("identical URLs still merge when there is no company", () => {
  const result = dedupeJobs([
    job({ title: "Logo design", company: null, source: "freelancer", url: "https://f/1", postedAt: "2026-09-12T00:00:00Z" }),
    job({ title: "Logo design", company: null, source: "weworkremotely", url: "https://f/1", postedAt: "2026-09-11T00:00:00Z" }),
  ]);

  assert.equal(result.length, 1);
  assert.deepEqual(result[0].sources, ["freelancer", "weworkremotely"]);
});

test("jobs with nothing to match on are kept, not collapsed", () => {
  const result = dedupeJobs([job({ source: "a" }), job({ source: "b" })]);
  assert.equal(result.length, 2);
});

test("every surviving job carries a sources array", () => {
  const result = dedupeJobs([
    job({ title: "A", company: "X", source: "indeed", url: "u1" }),
    job({ title: "B", company: "Y", source: "jobicy", url: "u2" }),
  ]);

  assert.ok(result.every((j) => Array.isArray(j.sources) && j.sources.length === 1));
});

test("the input array is never mutated", () => {
  const input = [job({ title: "T", company: "C", source: "indeed", url: "u1" })];
  dedupeJobs(input);

  assert.ok(!("sources" in input[0]));
});

test("empty and invalid input return an empty array", () => {
  assert.deepEqual(dedupeJobs([]), []);
  assert.deepEqual(dedupeJobs(null), []);
  assert.deepEqual(dedupeJobs(undefined), []);
});
