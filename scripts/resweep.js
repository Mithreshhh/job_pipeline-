/**
 * Re-applies the staleness rules to everything already stored.
 *
 * The daily run only ever judges what it just fetched, so a change to the
 * rules in db/deactivateStale.js leaves older rows carrying the verdict of
 * the rule that retired them. This script clears every verdict and decides
 * again from scratch, which is what you want after tuning a constant or
 * fixing a rule.
 *
 * It was written for exactly that: the first version of rule 2 retired on
 * `postedAt`, which hid 3,261 of 7,929 postings that were still live on
 * their boards. Fixing the rule did not un-hide them - this does.
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
  // are the ones that reported. Rule 1 needs both, or it would judge a
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
  // retired by the old rule retired forever, since the new rules only ever
  // turn isActive off.
  const cleared = await Job.updateMany({ isActive: false }, { $set: { isActive: true } });
  console.log(`Reactivated ${cleared.modifiedCount} rows, now judging again...`);

  const result = await deactivateStaleJobs({ runAt, seenSources });

  const after = await Job.countDocuments({ isActive: false });
  console.log("\n=== Re-swept ===");
  console.log(`Retired (taken down): ${result.takenDownChecked ? result.takenDown : "not checked"}`);
  console.log(`Retired (unseen):     ${result.lapsed}`);
  console.log(`Retired before:       ${before}`);
  console.log(`Retired now:          ${after}`);
  console.log(`Live now:             ${await Job.countDocuments({ isActive: true })}`);
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
