/**
 * Runs scrapers/indeed_wide.py and reads back what it found.
 *
 * JobSpy is Python-only, so this is the same bridge india.py and
 * jobspy_global.py use, with one difference: the results come back through a
 * temporary file rather than stdout, because a day's sweep is tens of
 * thousands of rows and stdout through spawnSync has a buffer ceiling.
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const SCRIPT = path.join(__dirname, "indeed_wide.py");

/** The sweep's two tiers, as indeed_wide.py names them. */
const TIERS = ["core", "reserve"];

function runIndeedWide(tier = "core") {
  if (!TIERS.includes(tier)) throw new Error(`Unknown Indeed tier "${tier}"`);

  const outPath = path.join(os.tmpdir(), `indeed_wide_${tier}_${process.pid}.json`);
  try {
    const result = spawnSync("python", [SCRIPT, outPath, tier], {
      encoding: "utf-8",
      // The sweep's own progress line; the rows are in the file.
      maxBuffer: 1024 * 1024 * 20,
    });
    if (result.status !== 0) {
      throw new Error(`indeed_wide.py ${tier} failed: ${(result.stderr || "").slice(-2000)}`);
    }
    if (result.stderr) console.log(result.stderr.trim().split("\n").slice(-1)[0]);
    return JSON.parse(fs.readFileSync(outPath, "utf-8"));
  } finally {
    fs.rmSync(outPath, { force: true });
  }
}

module.exports = { runIndeedWide, TIERS };
