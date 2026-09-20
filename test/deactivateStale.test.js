/**
 * Tests for the staleness rules.
 *
 * These matter more than most: the failure mode is silent and large. Get
 * the source guard wrong and a morning where LinkedIn is blocked retires
 * every LinkedIn job we hold; get the null handling wrong and the first
 * run after deploying retires everything stored before it.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");

const {
  buildStaleFilters,
  COMPLETE_FEED_SOURCES,
  DEFAULT_GRACE_DAYS,
  DEFAULT_MAX_AGE_DAYS,
} = require("../db/deactivateStale.js");

const RUN_AT = new Date("2026-09-20T00:30:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

test("only complete-feed sources can be retired for going missing", () => {
  const { takenDown } = buildStaleFilters({
    runAt: RUN_AT,
    seenSources: ["greenhouse", "ashby", "linkedin", "himalayas"],
  });

  // Himalayas only answers for the last 24h and LinkedIn is a keyword
  // search, so a job of theirs dropping out of view proves nothing.
  assert.deepEqual(takenDown.source, { $in: ["greenhouse", "ashby"] });
});

test("a source that didn't report this run is left alone", () => {
  // The whole point of the guard: Greenhouse throwing must not read as
  // "every Greenhouse job was taken down".
  const { takenDown } = buildStaleFilters({
    runAt: RUN_AT,
    seenSources: ["ashby", "linkedin"],
  });

  assert.deepEqual(takenDown.source, { $in: ["ashby"] });
});

test("no complete-feed source means the rule does not run at all", () => {
  const { takenDown } = buildStaleFilters({
    runAt: RUN_AT,
    seenSources: ["linkedin", "remoteok"],
  });

  assert.equal(takenDown, null);
  assert.equal(buildStaleFilters({ runAt: RUN_AT }).takenDown, null);
});

test("rows that predate lastSeenAt are not swept up", () => {
  // BSON sorts null before every date, so a bare $lt would match every
  // row written before this field existed.
  const { takenDown } = buildStaleFilters({
    runAt: RUN_AT,
    seenSources: ["greenhouse"],
  });

  assert.equal(takenDown.lastSeenAt.$ne, null);
  assert.equal(
    takenDown.lastSeenAt.$lt.getTime(),
    RUN_AT.getTime() - DEFAULT_GRACE_DAYS * DAY_MS,
  );
});

test("a single missed run is not enough to retire a job", () => {
  // Sources answer successfully and still return a short list when a page
  // times out, so the grace window has to be more than one run.
  assert.ok(DEFAULT_GRACE_DAYS >= 2);

  const { takenDownCutoff } = buildStaleFilters({
    runAt: RUN_AT,
    seenSources: ["greenhouse"],
    graceDays: 5,
  });

  assert.equal(takenDownCutoff.getTime(), RUN_AT.getTime() - 5 * DAY_MS);
});

test("age-out falls back to fetchedAt when there's no posting date", () => {
  const { agedOut } = buildStaleFilters({ runAt: RUN_AT });
  const cutoff = new Date(RUN_AT.getTime() - DEFAULT_MAX_AGE_DAYS * DAY_MS);

  assert.deepEqual(agedOut.$or, [
    { postedAt: { $ne: null, $lt: cutoff } },
    { postedAt: null, fetchedAt: { $ne: null, $lt: cutoff } },
  ]);
});

test("age-out applies to every source, seen or not", () => {
  // Unlike rule 1 it needs no evidence from this run - a posting from
  // seven weeks ago is stale whether or not its board answered today.
  const { agedOut } = buildStaleFilters({ runAt: RUN_AT, seenSources: [] });

  assert.equal(agedOut.isActive, true);
  assert.ok(!("source" in agedOut));
});

test("both rules only ever touch listings that are still live", () => {
  const { takenDown, agedOut } = buildStaleFilters({
    runAt: RUN_AT,
    seenSources: ["greenhouse"],
  });

  assert.equal(takenDown.isActive, true);
  assert.equal(agedOut.isActive, true);
});

test("We Work Remotely is deliberately not a complete feed", () => {
  // Its RSS is capped at a page of recent items, so a job falling off the
  // end means the feed moved on, not that the role was filled.
  assert.ok(!COMPLETE_FEED_SOURCES.includes("weworkremotely"));
  assert.deepEqual([...COMPLETE_FEED_SOURCES].sort(), ["ashby", "greenhouse"]);
});
