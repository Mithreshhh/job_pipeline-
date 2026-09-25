/**
 * Mongoose model for a normalized job.
 *
 * Mirrors the shared schema in pipeline/schema.js, plus the `sources` array
 * that dedupe adds and the two liveness fields the pipeline maintains
 * (`lastSeenAt`, `isActive`). Only `url` is required, because it's the key
 * upserts match on - everything else is scraped from sites we don't
 * control, so a missing company name shouldn't stop a job being stored.
 *
 * The job boards in skeo-lms and menler-lms read this collection directly
 * with a read-only Atlas user, so the indexes below exist for their
 * queries as much as for ours. See db/readJobs.js for the query shape they
 * are built to serve.
 */

"use strict";

const mongoose = require("mongoose");
const {
  ROLE_CATEGORY_VALUES,
  WORK_TYPE_VALUES,
  EXPERIENCE_LEVEL_VALUES,
} = require("../pipeline/taxonomy.js");

const jobSchema = new mongoose.Schema({
  title: { type: String, default: null },
  company: { type: String, default: null },
  location: { type: String, default: null },
  country: { type: String, default: null },
  isRemote: { type: Boolean, default: false },
  url: { type: String, required: true },
  source: { type: String, default: null },
  sources: { type: [String], default: [] },

  // Tagged by the classifiers in pipeline/normalize.js. The enums come from
  // pipeline/taxonomy.js, the same table the LMS job boards read, so the
  // permitted values are stated in one place rather than three.
  //
  // Note these do NOT police the daily run: bulkWrite skips validators
  // unless asked, and upsertJobs deliberately leaves them off so one odd
  // value can't fail a row silently in the middle of a 9,800-row batch.
  // What actually keeps the classifiers and this table in step are the
  // reachability tests in test/taxonomy.test.js.
  //
  // roleCategory stays nullable because normalize only stores a job once
  // it has matched a category - a future pass could store unclassified
  // jobs without needing a migration.
  roleCategory: { type: String, default: null, enum: [...ROLE_CATEGORY_VALUES, null] },
  workType: { type: String, default: "unspecified", enum: WORK_TYPE_VALUES },
  experienceLevel: {
    type: String,
    default: "unspecified",
    enum: EXPERIENCE_LEVEL_VALUES,
  },

  // How well the job matches what these students train for, 0-100.
  // Scored once at normalize time (pipeline/normalize.js) rather than at
  // read time, because it never changes for a stored job and sorting by a
  // stored number is the difference between an index scan and a full one.
  relevance: { type: Number, default: 0 },

  // What kind of job it is - Product, Founder's Office, Full Stack - which is
  // how students browse. See DOMAINS in pipeline/taxonomy.js for why this
  // sits beside roleCategory rather than replacing it.
  domain: { type: String, default: null, index: false },

  // The syllabus terms this posting actually evidenced - "claude", "n8n",
  // "prompt engineering". Stored for two reasons: it is what makes a job's
  // position on the board explainable to the student looking at it, and the
  // description it was matched from is never stored, so without this a
  // rescore could only ever see the title again.
  matchedSkills: { type: [String], default: [] },

  // Five of the eleven sources ship a logo URL (JobSpy, Himalayas, Jobicy,
  // Instahyre, AmbitionBox); the company boards ship none. Null is the normal
  // case, and both LMS boards draw a monogram instead.
  companyLogo: { type: String, default: null },

  // The three reachability scores, and the combined number the board sorts
  // on. All 0-100, all written by pipeline/ranking.js at normalize time for
  // the same reason relevance is: a stored number turns the board's default
  // sort into an index scan instead of a full one.
  //
  //   achievability  experience level, title seniority, years demanded
  //   indiaFit       India-based, or remote that really hires from India
  //   easeOfApply    direct link, no take-home, no degree gate
  //   rankScore      the weighted combination, RANK_WEIGHTS in ranking.js
  achievability: { type: Number, default: 0 },
  indiaFit: { type: Number, default: 0 },
  easeOfApply: { type: Number, default: 0 },
  rankScore: { type: Number, default: 0 },

  // Short phrases explaining the position: ["entry level", "Bengaluru",
  // "direct apply", "matches claude"]. Shown on the card, because an order
  // nobody can account for is one nobody trusts.
  rankReasons: { type: [String], default: [] },

  postedAt: { type: Date, default: null },
  fetchedAt: { type: Date, default: null },

  // When a source last confirmed this posting still exists. Distinct from
  // fetchedAt, which is stamped by the scraper on the run that first saw
  // it; lastSeenAt is refreshed by every run that sees it again. The gap
  // between the two is how long a posting has been up.
  lastSeenAt: { type: Date, default: null },

  // Whether the board should show it. Set false by db/deactivateStale.js
  // rather than deleting the row, so a posting that comes back (re-listed,
  // or a source that was down for a few days) is revived by the next
  // upsert instead of being re-inserted as if it were new.
  isActive: { type: Boolean, default: true },
});

// Unique so that two upserts for the same posting can't create two rows.
jobSchema.index({ url: 1 }, { unique: true });

// The board's queries, which always scope to live listings and sort newest
// first. isActive leads every one of them because it is the filter that is
// never absent; putting the varying facet second lets one index serve both
// "this category, newest first" and "everything, newest first".
// The board's default order: best overall match first, newest breaking ties.
jobSchema.index({ isActive: 1, rankScore: -1, postedAt: -1 });
// The domain filter on its own is the board's most common narrowing, and it
// is always combined with the default sort.
jobSchema.index({ isActive: 1, domain: 1, rankScore: -1 });
// Kept because the dashboard still offers a sort by syllabus relevance alone.
jobSchema.index({ isActive: 1, relevance: -1, postedAt: -1 });
jobSchema.index({ isActive: 1, postedAt: -1 });
jobSchema.index({ isActive: 1, roleCategory: 1, postedAt: -1 });
jobSchema.index({ isActive: 1, country: 1, postedAt: -1 });
jobSchema.index({ isActive: 1, workType: 1, postedAt: -1 });

// The daily staleness sweep looks up by how long ago a job was last seen.
jobSchema.index({ lastSeenAt: 1 });

// Free-text search over the two fields a student actually types into a
// search box. MongoDB allows one text index per collection, so this is the
// whole of it - title outweighs company because someone searching "stripe"
// wants Stripe's jobs, but someone searching "engineer" does not want every
// company with "engineering" in its name first.
jobSchema.index(
  { title: "text", company: "text" },
  { weights: { title: 10, company: 4 }, name: "job_text_search" },
);

module.exports = mongoose.model("Job", jobSchema);
