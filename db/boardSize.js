/**
 * How many jobs Skeo's board shows, and whether today's run should top it up.
 *
 * Skeo shows a 15-day window and is meant to hold at least 1 lakh jobs. The
 * daily sweep is sized to land there (scrapers/indeed_wide.py, "core"), but a
 * source can go quiet for a week, so the run checks the board first: below
 * TARGET it also runs the reserve tier - Indeed Canada, Australia and the USA -
 * and above it skips it, which keeps the collection near what the database
 * is sized for (db/purgeOldJobs.js).
 *
 * The count is the board's own: live, and posted inside the window, falling
 * back to first-seen for the few rows with no posting date. Served by the
 * { isActive, postedAt } index.
 */

"use strict";

const Job = require("./jobModel");
const { connectToMongo } = require("./connection");
const { WIDEST_BOARD_DAYS } = require("./purgeOldJobs");

/** Skeo's floor is 1 lakh; the target leaves a fifth as margin. */
const BOARD_TARGET = 120000;

const DAY_MS = 24 * 60 * 60 * 1000;

function boardFilter({ now = Date.now(), days = WIDEST_BOARD_DAYS } = {}) {
  const since = new Date(now - days * DAY_MS);
  return {
    isActive: true,
    $or: [{ postedAt: { $gte: since } }, { postedAt: null, fetchedAt: { $gte: since } }],
  };
}

/**
 * Whether to run the reserve tier. An unknown count (the database did not
 * answer) runs it: a missed top-up costs the board a day of jobs, an extra
 * one costs a few minutes.
 */
function needsReserve(boardCount, target = BOARD_TARGET) {
  if (!Number.isFinite(boardCount)) return true;
  return boardCount < target;
}

async function countBoard(options = {}) {
  await connectToMongo();
  return Job.countDocuments(boardFilter(options));
}

module.exports = { countBoard, boardFilter, needsReserve, BOARD_TARGET };
