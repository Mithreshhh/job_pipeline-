/**
 * Rescores every stored job on the four ranking axes.
 *
 * Run this after changing RANK_WEIGHTS or anything in pipeline/ranking.js.
 * Otherwise tomorrow's jobs use the new rule while the 14,000 already stored
 * keep the old one, and the board is sorted by two rules at once.
 *
 * TWO MODES, because the descriptions are not stored.
 *
 *   default      Recombines the stored achievability / indiaFit /
 *                easeOfApply / relevance into a new rankScore. This is EXACT
 *                - the four components are facts about the posting and only
 *                the weights changed - and it is the mode you want after
 *                retuning the weights, which is the common case.
 *
 *   --rescore    Recomputes the components too, from the title and the
 *                stored fields. LOSSY: roughly everything easeOfApply and
 *                the years-of-experience part of achievability read lives in
 *                the description, which is never stored. Use it after
 *                changing the scoring rules themselves, and expect the next
 *                daily run to correct it - the run sees descriptions and
 *                refreshes every field on every live row.
 *
 * A row that has never been scored has no components to recombine, so it is
 * rescored from the title either way.
 *
 *   node scripts/backfillRankScore.js
 *   node scripts/backfillRankScore.js --rescore
 */

"use strict";

const Job = require("../db/jobModel.js");
const { combineRank, scoreJobRank } = require("../pipeline/ranking.js");
const { connectToMongo, disconnectFromMongo } = require("../db/connection.js");

const BATCH = 500;

const FIELDS =
  "title company location country isRemote url source experienceLevel " +
  "relevance matchedSkills achievability indiaFit easeOfApply rankScore rankReasons";

/** Has this row been through pipeline/ranking.js at all? */
function hasComponents(job) {
  return ["achievability", "indiaFit", "easeOfApply"].some((key) => Number.isFinite(job[key]));
}

/**
 * What this row's ranking fields should become.
 *
 * Pure, so the mode logic is tested in test/ranking.test.js without a
 * database standing behind it.
 */
function nextRankFor(job, { rescore = false } = {}) {
  if (!rescore && hasComponents(job)) {
    // Weights changed, components did not. Recombine and keep the reasons.
    return {
      achievability: job.achievability,
      indiaFit: job.indiaFit,
      easeOfApply: job.easeOfApply,
      rankScore: combineRank(job),
      rankReasons: Array.isArray(job.rankReasons) ? job.rankReasons : [],
      mode: "recombined",
    };
  }

  // No description to read: the title, the stored fields and the syllabus
  // terms are everything available.
  const scored = scoreJobRank({
    title: job.title,
    description: Array.isArray(job.matchedSkills) ? job.matchedSkills.join(" ") : "",
    location: job.location,
    country: job.country,
    isRemote: job.isRemote,
    url: job.url,
    source: job.source,
    experienceLevel: job.experienceLevel,
    relevance: job.relevance,
    matchedSkills: job.matchedSkills,
  });

  return { ...scored, mode: hasComponents(job) ? "rescored" : "first scoring" };
}

/** True when anything this script writes would actually differ. */
function changed(job, next) {
  if (job.rankScore !== next.rankScore) return true;
  for (const key of ["achievability", "indiaFit", "easeOfApply"]) {
    if (job[key] !== next[key]) return true;
  }
  const before = Array.isArray(job.rankReasons) ? job.rankReasons : [];
  return before.length !== next.rankReasons.length || before.some((r, i) => r !== next.rankReasons[i]);
}

async function backfill({ rescore = false } = {}) {
  await connectToMongo();

  const total = await Job.countDocuments();
  console.log(
    `Rescoring ${total} stored jobs (${rescore ? "--rescore: components too" : "recombining stored components"})...`,
  );

  const counts = { recombined: 0, rescored: 0, "first scoring": 0 };
  let seen = 0;
  let written = 0;
  let writes = [];

  const cursor = Job.find({}, FIELDS).lean().cursor();

  const flush = async () => {
    if (!writes.length) return;
    await Job.bulkWrite(writes, { ordered: false });
    writes = [];
  };

  for (let job = await cursor.next(); job; job = await cursor.next()) {
    seen += 1;

    const next = nextRankFor(job, { rescore });
    counts[next.mode] += 1;

    if (changed(job, next)) {
      written += 1;
      writes.push({
        updateOne: {
          filter: { _id: job._id },
          update: {
            $set: {
              achievability: next.achievability,
              indiaFit: next.indiaFit,
              easeOfApply: next.easeOfApply,
              rankScore: next.rankScore,
              rankReasons: next.rankReasons,
            },
          },
        },
      });
    }

    if (writes.length >= BATCH) await flush();
    if (seen % 2000 === 0) console.log(`  ${seen}/${total}...`);
  }

  await flush();

  console.log(`\nRead ${seen}, wrote ${written}.`);
  for (const [mode, n] of Object.entries(counts)) {
    if (n) console.log(`  ${mode}: ${n}`);
  }
  if (counts["first scoring"]) {
    console.log(
      `\n${counts["first scoring"]} had never been ranked, so they scored without a` +
        ` description. The next daily run refreshes those.`,
    );
  }

  const top = await Job.find({ isActive: true })
    .sort({ rankScore: -1, postedAt: -1 })
    .limit(10)
    .select("title company country rankScore achievability indiaFit easeOfApply relevance rankReasons")
    .lean();

  console.log("\nTop of the board now:");
  for (const job of top) {
    console.log(
      `  ${String(job.rankScore).padStart(3)}  ` +
        `a${String(job.achievability).padStart(3)} i${String(job.indiaFit).padStart(3)} ` +
        `e${String(job.easeOfApply).padStart(3)} r${String(job.relevance).padStart(3)}  ` +
        `${String(job.title).slice(0, 46).padEnd(47)} ${(job.rankReasons || []).join(", ")}`,
    );
  }
}

if (require.main === module) {
  backfill({ rescore: process.argv.includes("--rescore") })
    .then(disconnectFromMongo)
    .catch(async (err) => {
      console.error("Backfill failed:", err.message);
      await disconnectFromMongo().catch(() => {});
      process.exit(1);
    });
}

module.exports = { backfill, nextRankFor, hasComponents, changed };
