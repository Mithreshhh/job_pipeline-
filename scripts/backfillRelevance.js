/**
 * Scores `relevance` on jobs that were stored before it existed.
 *
 * The daily run scores a job as it writes it, so this is only for the
 * backlog - and for after a change to the scoring in pipeline/normalize.js,
 * which would otherwise apply to new jobs only and leave the board sorted by
 * two different rules at once.
 *
 * It scores from the title and the category, not the description: the
 * description is never stored (only matched against at normalize time), and
 * the title is where almost all of the signal is anyway.
 *
 *   node scripts/backfillRelevance.js
 */

"use strict";

const Job = require("../db/jobModel.js");
const { scoreRelevance } = require("../pipeline/normalize.js");
const { connectToMongo, disconnectFromMongo } = require("../db/connection.js");

const BATCH = 500;

async function backfill() {
  await connectToMongo();

  const total = await Job.countDocuments();
  console.log(`Scoring ${total} stored jobs...`);

  let seen = 0;
  let changed = 0;
  let writes = [];

  const cursor = Job.find({}, "title roleCategory relevance").lean().cursor();

  const flush = async () => {
    if (!writes.length) return;
    await Job.bulkWrite(writes, { ordered: false });
    writes = [];
  };

  for (let job = await cursor.next(); job; job = await cursor.next()) {
    seen += 1;
    const score = scoreRelevance(job.title, "", job.roleCategory);

    if (score !== (job.relevance || 0)) {
      changed += 1;
      writes.push({
        updateOne: { filter: { _id: job._id }, update: { $set: { relevance: score } } },
      });
    }

    if (writes.length >= BATCH) await flush();
    if (seen % 2000 === 0) console.log(`  ${seen}/${total}...`);
  }

  await flush();

  console.log(`\nScored ${seen} jobs, ${changed} changed.`);

  // What the board will now open on, which is the point of the exercise.
  const top = await Job.find({ isActive: true })
    .sort({ relevance: -1, postedAt: -1 })
    .limit(8)
    .select("title company relevance roleCategory")
    .lean();

  console.log("\nTop of the board now:");
  for (const job of top) {
    console.log(
      `  ${String(job.relevance).padStart(3)}  ${String(job.roleCategory).padEnd(11)} ${job.title} — ${job.company}`,
    );
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
