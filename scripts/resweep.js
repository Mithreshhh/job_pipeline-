/**
 * Re-applies the withdrawal rule to everything already stored.
 *
 * The daily run only judges what it just fetched, so a change to
 * db/deactivateStale.js leaves older rows carrying the verdict of the rule
 * that retired them. This clears every verdict and decides again.
 *
 * Note it is NOT needed after changing the board's ten-day window. That
 * window is applied at read time in db/readJobs.js, so changing it takes
 * effect on the next page load with nothing to re-judge - which is most of
 * why it lives there rather than in a stored flag.
 *
 * Run it by hand:  node scripts/resweep.js
 */

"use strict";

const Job = require("../db/jobModel.js");
const { deactivateStaleJobs } = require("../db/deactivateStale.js");
const { connectToMongo, disconnectFromMongo } = require("../db/connection.js");

async function resweep() {
  await connectToMongo();

  const before = await Job.countDocuments({ isActive: false });
  console.log(`Currently retired: ${before}`);

  // The newest lastSeenAt is the last run's timestamp - every row a run
  // touches is stamped with the same instant - and the sources carrying it
  // are the ones that reported. The rule needs both, or it would judge a
  // complete feed on a run that never asked it.
  const newest = await Job.findOne().sort({ lastSeenAt: -1 }).select("lastSeenAt").lean();
  if (!newest || !newest.lastSeenAt) {
    console.log("No run has written to this collection yet - nothing to do.");
    return;
  }

  const runAt = newest.lastSeenAt;
  const seenSources = await Job.distinct("source", { lastSeenAt: runAt });
  console.log(`Last run: ${runAt.toISOString()}`);
  console.log(`Sources that reported: ${seenSources.join(", ")}`);

  // Clear every verdict first. Judging again without this would leave rows
  // retired by an old rule retired forever, since the rule only ever turns
  // isActive off.
  const cleared = await Job.updateMany({ isActive: false }, { $set: { isActive: true } });
  console.log(`Reactivated ${cleared.modifiedCount} rows, now judging again...`);

  const result = await deactivateStaleJobs({ runAt, seenSources });

  console.log("\n=== Re-swept ===");
  console.log(`Retired (taken down): ${result.takenDownChecked ? result.takenDown : "not checked"}`);
  console.log(`Retired before:       ${before}`);
  console.log(`Retired now:          ${await Job.countDocuments({ isActive: false })}`);
  console.log(`Not withdrawn:        ${await Job.countDocuments({ isActive: true })}`);
}

if (require.main === module) {
  resweep()
    .then(disconnectFromMongo)
    .catch(async (err) => {
      console.error("Re-sweep failed:", err.message);
      await disconnectFromMongo().catch(() => {});
      process.exit(1);
    });
}

module.exports = { resweep };
