/**
 * Marks postings that have gone away as inactive, so the board stops
 * showing links that 404 or lead to a filled role.
 *
 * Nothing is deleted. A posting that comes back - re-listed by the
 * employer, or belonging to a source that was down for a week - is revived
 * by the next upsert setting isActive back to true, which a delete would
 * make impossible.
 *
 * There is exactly one thing this decides: was the posting TAKEN DOWN.
 * Greenhouse, Lever and Ashby hand us a company's complete list of current
 * openings every single run, so a job of theirs that is no longer in the
 * list has genuinely been pulled. That inference is only safe for sources
 * that return everything, which is why no other source is eligible.
 *
 * AGE IS NOT DECIDED HERE. The board shows a rolling ten-day window, and
 * that window is applied at read time in db/readJobs.js. Two facts that got
 * conflated in earlier versions of this file are now kept apart:
 *
 *   isActive: false   the employer withdrew this
 *   outside window    it is simply not recent any more
 *
 * Conflating them is what produced the worst bug this project has had: a
 * rule that retired anything whose `postedAt` was older than 45 days hid
 * 3,261 of 7,929 postings, most of them jobs sitting right there on
 * Greenhouse that morning. "Posted a while ago" and "gone" are different
 * claims, and only the second one belongs in a flag.
 */

"use strict";

const Job = require("./jobModel");
const { connectToMongo } = require("./connection");

/**
 * Sources that publish a complete current listing on every run, so that a
 * job missing from one is a job that was taken down.
 *
 * Only the company ATS boards qualify. We Work Remotely is deliberately
 * not here: its RSS feeds are capped at a page of recent items, so a job
 * falling off the end means the feed moved on, not that the role was
 * filled. Add a source here only after checking it returns everything and
 * not merely the newest N.
 */
const COMPLETE_FEED_SOURCES = ["greenhouse", "ashby", "lever"];

const DEFAULT_GRACE_DAYS = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

const daysBefore = (date, days) => new Date(date.getTime() - days * DAY_MS);

/**
 * Builds the query, kept separate from running it so the rule can be tested
 * without a database.
 *
 * @param {Date}     runAt        when this run started
 * @param {string[]} seenSources  sources that returned jobs this run
 * @param {number}   graceDays    how many runs a complete-feed job may be
 *                                missing for before it is called dead. One
 *                                missed run is not proof: a source can
 *                                answer successfully and still return a
 *                                short list because a page timed out.
 */
function buildStaleFilters({
  runAt = new Date(),
  seenSources = [],
  graceDays = DEFAULT_GRACE_DAYS,
} = {}) {
  // Intersecting with what we actually saw is the guard that makes this
  // safe: if Greenhouse threw this morning, it contributes no sources, so
  // none of its jobs are eligible to be retired on the strength of a run
  // that never asked.
  const completeSeen = COMPLETE_FEED_SOURCES.filter((source) =>
    seenSources.includes(source),
  );

  const takenDownCutoff = daysBefore(runAt, graceDays);

  // $lt alone would match null, because BSON sorts null before every date -
  // which would retire any row written before lastSeenAt existed, on the
  // first run after deploying this.
  const takenDown =
    completeSeen.length === 0
      ? null
      : {
          isActive: true,
          source: { $in: completeSeen },
          lastSeenAt: { $ne: null, $lt: takenDownCutoff },
        };

  return { takenDown, takenDownCutoff };
}

/**
 * Applies both rules and returns how many rows each one retired.
 */
async function deactivateStaleJobs(options = {}) {
  const { takenDown, takenDownCutoff } = buildStaleFilters(options);

  await connectToMongo();

  let count = 0;
  if (takenDown) {
    const result = await Job.updateMany(takenDown, { $set: { isActive: false } });
    count = result.modifiedCount || 0;
  }

  return {
    takenDown: count,
    takenDownCutoff,
    // False when no complete-feed source reported, which is worth printing:
    // it means the rule did not run at all rather than finding nothing.
    takenDownChecked: Boolean(takenDown),
  };
}

module.exports = {
  deactivateStaleJobs,
  buildStaleFilters,
  COMPLETE_FEED_SOURCES,
  DEFAULT_GRACE_DAYS,
};
