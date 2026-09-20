/**
 * Deletes jobs that fell out of the board's window long ago.
 *
 * This is the only place in the pipeline that removes data, and it exists
 * for one reason: the collection otherwise only grows. Around 2,700 new
 * postings arrive a day, which is roughly a million rows a year, and the
 * free Atlas tier stops at 512MB.
 *
 * WHY 60 DAYS WHEN THE BOARD ONLY SHOWS 10. The gap is deliberate margin.
 * A row outside the ten-day window is invisible but still useful: it is
 * what lets you widen the window to fourteen days and immediately have the
 * jobs to fill it, and it is what you read when asking why a listing did or
 * didn't appear. Deleting at the window edge would make both impossible and
 * save nothing worth having.
 *
 * Deleting is safe here because nothing downstream holds a reference to a
 * job by id - the LMS boards query this collection live. If a deleted
 * posting is still on its board, the next run simply inserts it again.
 */

"use strict";

const Job = require("./jobModel");
const { connectToMongo } = require("./connection");

/** Six times the board's ten-day window. */
const DEFAULT_PURGE_DAYS = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Same "posted, or first seen if the source gave no date" rule the board
 * reads by, so a row is judged on the date that decided whether it was ever
 * shown.
 */
function buildPurgeFilter({ now = Date.now(), purgeDays = DEFAULT_PURGE_DAYS } = {}) {
  const cutoff = new Date(now - purgeDays * DAY_MS);

  return {
    filter: {
      $or: [
        { postedAt: { $ne: null, $lt: cutoff } },
        { postedAt: null, fetchedAt: { $ne: null, $lt: cutoff } },
      ],
    },
    cutoff,
  };
}

async function purgeOldJobs(options = {}) {
  const { filter, cutoff } = buildPurgeFilter(options);

  await connectToMongo();

  const result = await Job.deleteMany(filter);
  return { deleted: result.deletedCount || 0, cutoff };
}

module.exports = { purgeOldJobs, buildPurgeFilter, DEFAULT_PURGE_DAYS };
