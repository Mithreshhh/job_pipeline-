/**
 * Rescores every stored job against the current syllabus.
 *
 * The daily run scores a job as it writes it, so this exists for two other
 * moments: the backlog that predates a scoring field, and any change to
 * pipeline/syllabus.js - which would otherwise apply to tomorrow's jobs only
 * and leave the board sorted by two different rules at once.
 *
 * WHAT IT CAN SEE. Descriptions are never stored; at 10k listings they would
 * not fit the free tier, and nothing reads them. So this scores from the
 * title plus `matchedSkills` - the syllabus terms the original run found,
 * which are stored precisely so the description's evidence survives it. Every
 * term name re-matches its own pattern (pinned by a test), so feeding them
 * back in place of the description reproduces the live score exactly.
 *
 * Rows written before matchedSkills existed have none, so they are scored
 * from the title alone and will read slightly low until the next daily run
 * sees them again and refreshes both fields. That resolves itself within a
 * day; it is not worth re-fetching 10,000 descriptions to avoid.
 *
 *   node scripts/backfillRelevance.js
 */

"use strict";

const Job = require("../db/jobModel.js");
const { scoreRelevanceDetailed } = require("../pipeline/normalize.js");
const { connectToMongo, disconnectFromMongo } = require("../db/connection.js");

const BATCH = 500;

async function backfill() {
  await connectToMongo();

  const total = await Job.countDocuments();
  console.log(`Rescoring ${total} stored jobs against the syllabus...`);

  let seen = 0;
  let changed = 0;
  let thin = 0;
  let writes = [];

  const cursor = Job.find({}, "title roleCategory experienceLevel relevance matchedSkills")
    .lean()
    .cursor();

  const flush = async () => {
    if (!writes.length) return;
    await Job.bulkWrite(writes, { ordered: false });
    writes = [];
  };

  for (let job = await cursor.next(); job; job = await cursor.next()) {
    seen += 1;

    const stored = Array.isArray(job.matchedSkills) ? job.matchedSkills : [];
    if (!stored.length) thin += 1;

    const scored = scoreRelevanceDetailed(job.title, stored.join(" "), job.roleCategory, {
      experienceLevel: job.experienceLevel,
    });

    const skillsChanged =
      stored.length !== scored.matchedSkills.length ||
      stored.some((skill, i) => skill !== scored.matchedSkills[i]);

    if (scored.relevance !== (job.relevance || 0) || skillsChanged) {
      changed += 1;
      writes.push({
        updateOne: {
          filter: { _id: job._id },
          update: { $set: { relevance: scored.relevance, matchedSkills: scored.matchedSkills } },
        },
      });
    }

    if (writes.length >= BATCH) await flush();
    if (seen % 2000 === 0) console.log(`  ${seen}/${total}...`);
  }

  await flush();

  console.log(`\nRescored ${seen} jobs, ${changed} changed.`);
  // Deliberately worded as "matched nothing" rather than "was never scored":
  // an empty matchedSkills means either, and this script cannot tell them
  // apart. Most of this number is the honest majority of any job board -
  // listings with no connection to the syllabus at all.
  console.log(
    `${thin} carry no syllabus terms, so they scored on category alone.` +
      ` That includes both jobs that match nothing and any row the daily run` +
      ` has not re-seen yet; the next run resolves the second kind.`,
  );

  // What the board will now open on, which is the point of the exercise.
  const top = await Job.find({ isActive: true })
    .sort({ relevance: -1, postedAt: -1 })
    .limit(10)
    .select("title company relevance roleCategory matchedSkills")
    .lean();

  console.log("\nTop of the board now:");
  for (const job of top) {
    const why = (job.matchedSkills || []).join(", ") || "category only";
    console.log(
      `  ${String(job.relevance).padStart(3)}  ${String(job.roleCategory).padEnd(11)} ` +
        `${job.title} — ${job.company}  [${why}]`,
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
