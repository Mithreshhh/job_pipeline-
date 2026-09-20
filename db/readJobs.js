/**
 * The read side of the job board.
 *
 * The LMSes connect to this collection directly with a read-only Atlas
 * user, so this file is the reference implementation of the query they
 * run: one place where "what the board asks for" is defined, tested, and
 * kept in step with the indexes in db/jobModel.js. When the query changes
 * here, the copies in skeo-lms and menler-lms change with it.
 *
 * Two rules the callers depend on:
 *
 *   Only live listings. isActive is forced true unless something
 *   deliberately asks otherwise, so nobody has to remember to add it and
 *   a forgotten filter can't put dead links in front of a student.
 *
 *   Every facet value is checked against pipeline/taxonomy.js before it
 *   reaches Mongo. These values arrive from a query string, and an
 *   unchecked one lets a visitor post `?workType[$ne]=x` and hand Mongo an
 *   operator instead of a string. Whitelisting to values we already know
 *   about closes that, and drops typos rather than silently returning zero
 *   results for them.
 */

"use strict";

const Job = require("./jobModel");
const { connectToMongo } = require("./connection");
const {
  isRoleCategory,
  isWorkType,
  isExperienceLevel,
} = require("../pipeline/taxonomy.js");

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/**
 * Accepts `?x=a&x=b`, `?x=a,b` or a plain array, and keeps only the values
 * the taxonomy recognises.
 */
function cleanList(input, isValid) {
  if (input === undefined || input === null) return [];

  const raw = Array.isArray(input) ? input : [input];
  const flattened = raw
    .filter((value) => typeof value === "string")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);

  return [...new Set(flattened.filter(isValid))];
}

/** One value, or nothing. Used for free-text fields with no fixed list. */
function cleanString(input, maxLength = 120) {
  if (typeof input !== "string") return null;

  const trimmed = input.trim();
  if (!trimmed) return null;

  return trimmed.slice(0, maxLength);
}

/**
 * "true"/"false" from a query string, or a real boolean. Anything else is
 * "the filter wasn't asked for", which is different from "asked for false".
 */
function cleanBoolean(input) {
  if (typeof input === "boolean") return input;
  if (input === "true") return true;
  if (input === "false") return false;
  return null;
}

function buildJobQuery(params = {}) {
  const query = {};

  // includeInactive exists for admin screens and for debugging what the
  // staleness sweep did. It is never driven by a student-facing filter.
  if (!params.includeInactive) query.isActive = true;

  const categories = cleanList(params.category, isRoleCategory);
  if (categories.length) query.roleCategory = { $in: categories };

  const workTypes = cleanList(params.workType, isWorkType);
  if (workTypes.length) query.workType = { $in: workTypes };

  const levels = cleanList(params.experienceLevel, isExperienceLevel);
  if (levels.length) query.experienceLevel = { $in: levels };

  // Country has no fixed list - it is whatever detectCountry() read off a
  // location string - so it is length-capped and matched exactly rather
  // than whitelisted.
  const country = cleanString(params.country, 60);
  if (country) query.country = country;

  const remote = cleanBoolean(params.remote);
  if (remote !== null) query.isRemote = remote;

  const search = cleanString(params.search);
  if (search) query.$text = { $search: search };

  return query;
}

/**
 * Newest first, always. When there's a search term, relevance leads and
 * the date breaks ties - a student searching "prompt engineer" wants the
 * prompt engineering roles, not whatever was posted most recently.
 */
function buildJobSort(params = {}) {
  const hasSearch = Boolean(cleanString(params.search));

  return hasSearch
    ? { score: { $meta: "textScore" }, postedAt: -1 }
    : { postedAt: -1 };
}

/** Clamped so a caller can't ask for all 9,800 rows in one response. */
function buildPagination(params = {}) {
  const rawPage = Number.parseInt(params.page, 10);
  const rawLimit = Number.parseInt(params.limit, 10);

  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, MAX_LIMIT)
      : DEFAULT_LIMIT;

  return { page, limit, skip: (page - 1) * limit };
}

/**
 * Runs the query and returns a page of jobs plus the total, which the UI
 * needs to render "1-25 of 431" and to know whether there's a next page.
 */
async function findJobs(params = {}) {
  const query = buildJobQuery(params);
  const sort = buildJobSort(params);
  const { page, limit, skip } = buildPagination(params);

  await connectToMongo();

  const projection = query.$text ? { score: { $meta: "textScore" } } : {};

  const [jobs, total] = await Promise.all([
    Job.find(query, projection).sort(sort).skip(skip).limit(limit).lean(),
    Job.countDocuments(query),
  ]);

  return {
    jobs,
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
  };
}

/**
 * Counts per category for the filter bar, so a tab can show how many
 * listings it holds - and so an empty category is visibly empty rather
 * than looking broken when clicked.
 */
async function countByCategory(params = {}) {
  const query = buildJobQuery({ ...params, category: undefined });

  await connectToMongo();

  const rows = await Job.aggregate([
    { $match: query },
    { $group: { _id: "$roleCategory", count: { $sum: 1 } } },
  ]);

  return rows.reduce((counts, row) => {
    if (row._id) counts[row._id] = row.count;
    return counts;
  }, {});
}

module.exports = {
  findJobs,
  countByCategory,
  buildJobQuery,
  buildJobSort,
  buildPagination,
  DEFAULT_LIMIT,
  MAX_LIMIT,
};
