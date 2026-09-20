/**
 * Writes the deduped jobs from pipeline/dedupe.js into MongoDB.
 *
 * Every job is an upsert keyed on `url`: update the row if we've seen that
 * URL before, insert it if we haven't. Running the pipeline twice in a day
 * therefore refreshes the same rows instead of stacking up copies.
 *
 * `url` is the key because none of our sources share a common job ID - each
 * board has its own numbering - but the posting URL is unique per board and
 * stable between runs.
 *
 * Two fields are treated specially:
 *
 *   fetchedAt   written only on insert, so it keeps meaning "the first run
 *               that ever saw this posting". Before liveness tracking it
 *               was overwritten every run, which made it a duplicate of
 *               lastSeenAt and left nothing recording how old a listing is.
 *   lastSeenAt  written on every upsert, so it always means "the last run
 *               that found this still live on its board".
 *
 * The pair is what db/deactivateStale.js reads to decide what has gone
 * away. isActive is forced true here so a posting that disappears for a
 * few days and comes back is revived rather than staying hidden.
 */

"use strict";

const Job = require("./jobModel");
const { connectToMongo } = require("./connection");

async function upsertJobs(jobs, { runAt = new Date() } = {}) {
  const summary = {
    received: 0,
    upserted: 0,
    modified: 0,
    skipped: 0,
    runAt,
    seenSources: [],
  };
  if (!Array.isArray(jobs) || jobs.length === 0) return summary;

  summary.received = jobs.length;

  const withUrl = jobs.filter((job) => job && job.url);
  summary.skipped = jobs.length - withUrl.length;
  if (withUrl.length === 0) return summary;

  // Which boards actually answered this run. deactivateStale needs it so a
  // source that was down this morning doesn't have all of its listings
  // marked dead on the strength of it having returned nothing.
  summary.seenSources = [
    ...new Set(withUrl.map((job) => job.source).filter(Boolean)),
  ];

  await connectToMongo();

  const operations = withUrl.map((job) => {
    const { fetchedAt, ...rest } = job;

    return {
      updateOne: {
        filter: { url: job.url },
        update: {
          $set: { ...rest, lastSeenAt: runAt, isActive: true },
          $setOnInsert: { fetchedAt: fetchedAt || runAt },
        },
        upsert: true,
      },
    };
  });

  // ordered:false so one rejected job doesn't abandon the rest of the batch.
  const result = await Job.bulkWrite(operations, { ordered: false });

  summary.upserted = result.upsertedCount || 0;
  summary.modified = result.modifiedCount || 0;
  return summary;
}

module.exports = { upsertJobs };
