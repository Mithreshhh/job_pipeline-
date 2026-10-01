/**
 * Tests for the lifetime total (db/pipelineStats.js).
 *
 * The number is shown to students as "jobs collected", so the two ways it
 * can go wrong are both visible: dropping when the purge deletes old rows,
 * or starting at zero on a feed that already holds fifty thousand.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { nextLifetime, LIFETIME_ID } = require("../db/pipelineStats.js");

const DAY = 24 * 60 * 60 * 1000;
const runAt = new Date("2026-10-03T00:30:00Z");

test("the first run starts at what is already stored, not at zero", () => {
  const next = nextLifetime(null, {
    runAt,
    newJobs: 3000,
    storedNow: 57722,
    oldestFetchedAt: new Date("2026-09-20T11:19:44Z"),
  });
  assert.strictEqual(next._id, LIFETIME_ID);
  assert.strictEqual(next.jobsCollected, 57722);
  assert.strictEqual(next.runs, 1);
  assert.strictEqual(next.lastRunNew, 3000);
});

test("collecting began at the oldest row, not at the counter's first run", () => {
  const next = nextLifetime(null, {
    runAt,
    newJobs: 0,
    storedNow: 10,
    oldestFetchedAt: new Date("2026-09-20T11:19:44Z"),
  });
  assert.strictEqual(next.firstSeenAt.toISOString(), "2026-09-20T11:19:44.000Z");
});

test("each run adds what it inserted", () => {
  const previous = { jobsCollected: 57722, runs: 1, firstSeenAt: new Date("2026-09-20") };
  const next = nextLifetime(previous, { runAt, newJobs: 2500, storedNow: 58000 });
  assert.strictEqual(next.jobsCollected, 60222);
  assert.strictEqual(next.runs, 2);
});

test("the purge shrinking the collection never shrinks the total", () => {
  const previous = { jobsCollected: 120000, runs: 40, firstSeenAt: new Date("2026-09-20") };
  // Sixty days in, the purge has deleted most of what was ever collected.
  const next = nextLifetime(previous, { runAt, newJobs: 2700, storedNow: 160000 - 100000 });
  assert.strictEqual(next.jobsCollected, 122700);
});

test("a run that stored nothing keeps the total and still counts as a run", () => {
  const previous = { jobsCollected: 500, runs: 3, firstSeenAt: new Date("2026-09-20") };
  const next = nextLifetime(previous, { runAt, newJobs: 0, storedNow: 400 });
  assert.strictEqual(next.jobsCollected, 500);
  assert.strictEqual(next.runs, 4);
  assert.strictEqual(next.lastRunNew, 0);
});

test("the first sighting never moves later", () => {
  const first = new Date(runAt.getTime() - 40 * DAY);
  const previous = { jobsCollected: 500, runs: 3, firstSeenAt: first };
  // The rows from back then have since been purged; the oldest stored is newer.
  const next = nextLifetime(previous, {
    runAt,
    newJobs: 10,
    storedNow: 400,
    oldestFetchedAt: new Date(runAt.getTime() - 5 * DAY),
  });
  assert.strictEqual(next.firstSeenAt.getTime(), first.getTime());
});

test("nonsense counts are treated as none, not as NaN", () => {
  const next = nextLifetime({ jobsCollected: "lots", runs: null }, { runAt, newJobs: -4, storedNow: undefined });
  assert.strictEqual(next.jobsCollected, 0);
  assert.strictEqual(next.runs, 1);
  assert.strictEqual(next.lastRunNew, 0);
  assert.strictEqual(next.firstSeenAt.getTime(), runAt.getTime());
});
