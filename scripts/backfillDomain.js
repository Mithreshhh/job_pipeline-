/**
 * Files every stored job under a domain.
 *
 * Run it once after domains were introduced, and again after any change to
 * the rules in pipeline/domain.js - otherwise new jobs are filed by the new
 * rules while everything already stored keeps the old ones.
 *
 * EXACT, unlike the relevance and rank backfills. pipeline/domain.js reads
 * only the title and roleCategory, both of which are stored, so this produces
 * precisely what the daily run would. No description is needed and nothing is
 * approximated.
 *
 *   node scripts/backfillDomain.js
 */

"use strict";

const Job = require("../db/jobModel.js");
const { classifyDomain } = require("../pipeline/domain.js");
const { DOMAINS } = require("../pipeline/taxonomy.js");
const { connectToMongo, disconnectFromMongo } = require("../db/connection.js");

const BATCH = 500;

async function backfill() {
  await connectToMongo();

  const total = await Job.countDocuments();
  console.log(`Filing ${total} stored jobs under a domain...`);

  let seen = 0;
  let written = 0;
  let writes = [];

  const cursor = Job.find({}, "title roleCategory domain").lean().cursor();

  const flush = async () => {
    if (!writes.length) return;
    await Job.bulkWrite(writes, { ordered: false });
    writes = [];
  };

  for (let job = await cursor.next(); job; job = await cursor.next()) {
    seen += 1;

    const domain = classifyDomain(job.title, job.roleCategory);
    if (domain !== job.domain) {
      written += 1;
      writes.push({ updateOne: { filter: { _id: job._id }, update: { $set: { domain } } } });
    }

    if (writes.length >= BATCH) await flush();
    if (seen % 5000 === 0) console.log(`  ${seen}/${total}...`);
  }

  await flush();
  console.log(`\nRead ${seen}, wrote ${written}.`);

  // What the board's domain filter will now offer, live listings only.
  const counts = await Job.aggregate([
    { $match: { isActive: true } },
    { $group: { _id: "$domain", n: { $sum: 1 } } },
  ]);
  const byDomain = new Map(counts.map((c) => [c._id, c.n]));

  console.log("\nLive listings per domain:");
  for (const { value, label } of DOMAINS) {
    console.log(`  ${String(byDomain.get(value) || 0).padStart(6)}  ${label}`);
  }
}

if (require.main === module) {
  backfill()
    .then(disconnectFromMongo)
    .catch(async (err) => {
      console.error("Backfill failed:", err.message);
      await disconnectFromMongo().catch(() => {});
      process.exit(1);
    });
}

module.exports = { backfill };
