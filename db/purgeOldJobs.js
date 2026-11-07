/**
 * Deletes jobs that fell out of the board's window long ago.
 *
 * This is the only place in the pipeline that removes data, and it exists
 * for one reason: the collection otherwise only grows. Around 2,700 new
 * postings arrive a day, which is roughly a million rows a year, and the
 * free Atlas tier stops at 512MB.
 *
 * WHY 21 DAYS. The widest board is Skeo's, at 15 days; Menler's is 10. The
 * six days past it are margin: a row just outside the window is invisible
 * but still what you read when asking why a listing did or didn't appear,
 * and deleting at the window edge would make that impossible.
 *
 * It was 60 when ~2,700 jobs arrived a day. The wide Indeed sweep
 * (scrapers/indeed_wide.py) brought that to ~10,000, and 60 days of those
 * is ~600,000 rows - several times what the free tier holds. 21 days keeps
 * the collection near the ~200,000 rows it already held.
 *
 * Deleting is safe here because nothing downstream holds a reference to a
 * job by id - the LMS boards query this collection live. If a deleted
 * posting is still on its board, the next run simply inserts it again.
 */

"use strict";

const Job = require("./jobModel");
const { connectToMongo } = require("./connection");

/** The widest board's window: Skeo LMS, server/routes/jobs.js FRESH_DAYS. */
const WIDEST_BOARD_DAYS = 15;

/** That window and six days of margin. */
const DEFAULT_PURGE_DAYS = 21;

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

module.exports = { purgeOldJobs, buildPurgeFilter, DEFAULT_PURGE_DAYS, WIDEST_BOARD_DAYS };
