/**
 * Tests for the withdrawal rule and the purge.
 *
 * The failure mode here is silent and large. Get the source guard wrong and
 * a morning where Greenhouse is blocked retires every Greenhouse job we
 * hold; get the null handling wrong and the first run after a deploy
 * retires everything stored before it.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");

const {
  buildStaleFilters,
  COMPLETE_FEED_SOURCES,
  DEFAULT_GRACE_DAYS,
} = require("../db/deactivateStale.js");
const { buildPurgeFilter, DEFAULT_PURGE_DAYS } = require("../db/purgeOldJobs.js");
const { FRESH_DAYS } = require("../db/readJobs.js");

const RUN_AT = new Date("2026-09-20T00:30:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

test("only complete-feed sources can be retired for going missing", () => {
  const { takenDown } = buildStaleFilters({
    runAt: RUN_AT,
    seenSources: ["greenhouse", "ashby", "lever", "linkedin", "himalayas"],
  });

  // Himalayas only answers for the last 24h and LinkedIn is a keyword
  // search, so a job of theirs dropping out of view proves nothing.
  assert.deepEqual(takenDown.source, { $in: ["greenhouse", "ashby", "lever"] });
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
  // BSON sorts null before every date, so a bare $lt would match every row
  // written before this field existed.
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
});

test("the sweep judges withdrawal only, never age", () => {
  // Age is the board's rolling window, applied at read time. An earlier
  // version put both facts in one flag and hid 3,261 live postings.
  const filters = buildStaleFilters({ runAt: RUN_AT, seenSources: ["greenhouse"] });

  assert.deepEqual(Object.keys(filters).sort(), ["takenDown", "takenDownCutoff"]);
  assert.ok(!("postedAt" in filters.takenDown));
  assert.equal(filters.takenDown.isActive, true);
});

test("We Work Remotely is deliberately not a complete feed", () => {
  // Its RSS is capped at a page of recent items, so a job falling off the
  // end means the feed moved on, not that the role was filled.
  assert.ok(!COMPLETE_FEED_SOURCES.includes("weworkremotely"));
  assert.deepEqual([...COMPLETE_FEED_SOURCES].sort(), ["ashby", "greenhouse", "lever"]);
});

test("purge keeps well clear of the board's window", () => {
  // The margin is what lets you widen the window without having thrown the
  // jobs away, and what you read when asking why a listing never appeared.
  assert.ok(DEFAULT_PURGE_DAYS > FRESH_DAYS * 3);
});

test("purge judges a row on the same date the board judged it by", () => {
  const { filter, cutoff } = buildPurgeFilter({
    now: RUN_AT.getTime(),
    purgeDays: 60,
  });

  assert.equal(cutoff.getTime(), RUN_AT.getTime() - 60 * DAY_MS);
  assert.deepEqual(filter.$or, [
    { postedAt: { $ne: null, $lt: cutoff } },
    { postedAt: null, fetchedAt: { $ne: null, $lt: cutoff } },
  ]);
});

test("purge never deletes a row whose dates are both unknown", () => {
  // Deleting is the one irreversible thing here, so a row we can't date is
  // kept rather than guessed at.
  const { filter } = buildPurgeFilter({ now: RUN_AT.getTime() });

  assert.equal(filter.$or[0].postedAt.$ne, null);
  assert.equal(filter.$or[1].fetchedAt.$ne, null);
});
