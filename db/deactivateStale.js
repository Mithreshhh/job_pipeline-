/**
 * Marks postings that have gone away as inactive, so the board stops
 * showing links that 404 or lead to a filled role.
 *
 * Nothing is deleted. A posting that comes back - re-listed by the
 * employer, or belonging to a source that was down for a week - is revived
 * by the next upsert setting isActive back to true, which a delete would
 * make impossible.
 *
 * There are two different reasons a posting is stale, and only one of them
 * can be detected by absence:
 *
 * 1. TAKEN DOWN. Greenhouse and Ashby hand us a company's complete list of
 *    current openings every single run. If a job we stored is no longer in
 *    that list, it has genuinely been pulled. That inference is only safe
 *    for sources that return everything.
 *
 * 2. AGED OUT. Every other source is a recent-window feed or a keyword
 *    search: Himalayas only answers for the last 24 hours, Arbeitnow and
 *    Jobicy return a page or two of whatever is newest, and the JobSpy and
 *    Freelancer sources return whatever matched a search that day. A job
 *    from any of those drops out of view while still being perfectly live,
 *    so absence proves nothing and only age can be acted on.
 *
 * Getting that distinction wrong is expensive in one direction: treating
 * every source as complete would mark thousands of live Himalayas and
 * LinkedIn listings dead the morning after they were stored.
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
const COMPLETE_FEED_SOURCES = ["greenhouse", "ashby"];

const DEFAULT_GRACE_DAYS = 2;
const DEFAULT_MAX_AGE_DAYS = 45;

const DAY_MS = 24 * 60 * 60 * 1000;

const daysBefore = (date, days) => new Date(date.getTime() - days * DAY_MS);

/**
 * Builds the two queries, kept separate from running them so the rules can
 * be tested without a database.
 *
 * @param {Date}     runAt        when this run started
 * @param {string[]} seenSources  sources that returned jobs this run
 * @param {number}   graceDays    how many runs a complete-feed job may be
 *                                missing for before it is called dead. One
 *                                missed run is not proof: a source can
 *                                answer successfully and still return a
 *                                short list because a page timed out.
 * @param {number}   maxAgeDays   how old a posting gets before it is
 *                                retired regardless of source
 */
function buildStaleFilters({
  runAt = new Date(),
  seenSources = [],
  graceDays = DEFAULT_GRACE_DAYS,
  maxAgeDays = DEFAULT_MAX_AGE_DAYS,
} = {}) {
  // Intersecting with what we actually saw is the guard that makes this
  // safe: if Greenhouse threw this morning, it contributes no sources, so
  // none of its jobs are eligible to be retired on the strength of a run
  // that never asked.
  const completeSeen = COMPLETE_FEED_SOURCES.filter((source) =>
    seenSources.includes(source),
  );

  const takenDownCutoff = daysBefore(runAt, graceDays);
  const agedOutCutoff = daysBefore(runAt, maxAgeDays);

  const takenDown =
    completeSeen.length === 0
      ? null
      : {
          isActive: true,
          source: { $in: completeSeen },
          // $lt alone would match null, because BSON sorts null before
          // every date - which would retire any row written before
          // lastSeenAt existed, on the first run after deploying this.
          lastSeenAt: { $ne: null, $lt: takenDownCutoff },
        };

  const agedOut = {
    isActive: true,
    $or: [
      { postedAt: { $ne: null, $lt: agedOutCutoff } },
      // No posting date means we fall back to when we first saw it, which
      // is the earliest moment we can prove the listing existed.
      { postedAt: null, fetchedAt: { $ne: null, $lt: agedOutCutoff } },
    ],
  };

  return { takenDown, agedOut, takenDownCutoff, agedOutCutoff };
}

/**
 * Applies both rules and returns how many rows each one retired.
 */
async function deactivateStaleJobs(options = {}) {
  const { takenDown, agedOut, takenDownCutoff, agedOutCutoff } =
    buildStaleFilters(options);

  await connectToMongo();

  const deactivate = async (filter) => {
    if (!filter) return 0;
    const result = await Job.updateMany(filter, { $set: { isActive: false } });
    return result.modifiedCount || 0;
  };

  return {
    takenDown: await deactivate(takenDown),
    agedOut: await deactivate(agedOut),
    takenDownCutoff,
    agedOutCutoff,
    // Null when no complete-feed source reported, which is worth printing:
    // it means rule 1 did not run at all rather than finding nothing.
    takenDownChecked: Boolean(takenDown),
  };
}

module.exports = {
  deactivateStaleJobs,
  buildStaleFilters,
  COMPLETE_FEED_SOURCES,
  DEFAULT_GRACE_DAYS,
  DEFAULT_MAX_AGE_DAYS,
};
