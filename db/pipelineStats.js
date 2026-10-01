/**
 * The pipeline's lifetime totals: how many postings it has collected since
 * it began, across every run.
 *
 * The jobs collection cannot answer that by itself. db/purgeOldJobs.js
 * deletes rows sixty days past their posting date to keep the collection
 * inside the free Atlas tier, so counting it gives "collected in the last
 * two months or so", which shrinks the day a purge runs. The boards want the
 * other number - Menler LMS shows it over its job board as "jobs collected" -
 * so it is kept here, as a running total that only ever grows.
 *
 * One small document, `pipeline_stats` / `_id: "lifetime"`:
 *
 *   jobsCollected  postings ever stored
 *   runs           runs that recorded themselves
 *   firstSeenAt    when collecting began
 *   lastRunAt      the most recent run's start
 *   lastRunNew     what that run added
 *
 * It needs no seeding. On its first write the total is the larger of what
 * it already had (nothing) and what is stored now, so it starts at the true
 * floor; after that each run adds its new rows, and the stored count is a
 * floor it never drops below. Readers apply the same rule, so a board that
 * reads before the first write still shows the stored count.
 *
 * Nothing reads this to make a decision. A failure here is logged and the
 * run carries on: a missed count is a cosmetic error, a failed run is not.
 */

"use strict";

const mongoose = require("mongoose");
const Job = require("./jobModel");
const { connectToMongo } = require("./connection");

const COLLECTION = "pipeline_stats";
const LIFETIME_ID = "lifetime";

const count = (value) => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

/**
 * The next lifetime document, from the last one and this run. Pure, so the
 * arithmetic is tested without a database.
 *
 * @param {object|null} previous   the stored document, or null on the first run
 * @param {object} run
 * @param {Date}   run.runAt       this run's start
 * @param {number} run.newJobs     rows this run inserted that are still stored
 * @param {number} run.storedNow   the collection's size after the run
 * @param {Date|null} run.oldestFetchedAt  the earliest fetchedAt still stored
 */
function nextLifetime(previous, { runAt, newJobs, storedNow, oldestFetchedAt = null }) {
  const prev = previous || {};
  const added = count(newJobs);
  const runningTotal = count(prev.jobsCollected) + added;

  // A first sight that predates the counter is real history: the rows were
  // collected then, the counter just did not exist yet.
  const candidates = [prev.firstSeenAt, oldestFetchedAt, runAt]
    .map((d) => (d ? new Date(d) : null))
    .filter((d) => d && !Number.isNaN(d.getTime()));
  const firstSeenAt = new Date(Math.min(...candidates.map((d) => d.getTime())));

  return {
    _id: LIFETIME_ID,
    jobsCollected: Math.max(runningTotal, count(storedNow)),
    runs: count(prev.runs) + 1,
    firstSeenAt,
    lastRunAt: runAt,
    lastRunNew: added,
  };
}

/**
 * Records one run. Call it after the upsert and the purge, so "new" means
 * rows this run inserted that are still there: a posting already past the
 * keep window is inserted and purged in the same run, and counting it would
 * add it again every morning a source keeps listing it.
 *
 * @returns the document written, or null when it could not be.
 */
async function recordRun({ runAt }) {
  try {
    await connectToMongo();
    const stats = mongoose.connection.collection(COLLECTION);

    const [previous, newJobs, storedNow, oldest] = await Promise.all([
      stats.findOne({ _id: LIFETIME_ID }),
      Job.countDocuments({ fetchedAt: { $gte: runAt } }),
      Job.estimatedDocumentCount(),
      Job.findOne({}, { fetchedAt: 1 }).sort({ fetchedAt: 1 }).lean(),
    ]);

    const next = nextLifetime(previous, {
      runAt,
      newJobs,
      storedNow,
      oldestFetchedAt: oldest ? oldest.fetchedAt : null,
    });
    await stats.replaceOne({ _id: LIFETIME_ID }, next, { upsert: true });
    return next;
  } catch (err) {
    console.error(`[stats] lifetime total not recorded: ${err.message}`);
    return null;
  }
}

module.exports = { recordRun, nextLifetime, COLLECTION, LIFETIME_ID };
