/**
 * Company job boards, read straight from their ATS.
 *
 * Two reasons this source exists. First, the AI-data companies are where
 * non-technical AI work actually gets posted - AI trainer, data annotator,
 * model evaluator, AI policy - roles that barely surface on general job
 * boards. Second, big tech boards are simply the highest-volume listings
 * available to us, and they carry plenty of design, marketing and support
 * roles alongside engineering.
 *
 * Greenhouse, Lever and Ashby all publish an official, keyless JSON endpoint
 * per company, so this reads a public API rather than scraping. The cost is a
 * hand-maintained list.
 *
 * TWO CHECKS before adding a token, both learned the hard way:
 *
 *   1. Does it return jobs? A wrong token returns an empty list, not an
 *      error, so a typo looks like a quiet company.
 *   2. Are the jobs where you think they are? Tokens are first-come, and
 *      several are not the company you mean - "slice" on Greenhouse is a
 *      North Macedonian firm, "navi" on Ashby is in San Francisco. Both were
 *      about to be added as Indian boards on the strength of the name alone.
 *      Print the locations before you trust one.
 */

"use strict";

/**
 * India. Verified by reading each board's locations, not by recognising the
 * name: every token here is at least 60% India-based postings. They exist
 * because India was 7.7% of everything stored - only JobSpy was looking for
 * it, and Naukri, which used to be the other half, is behind a bot wall.
 */
const INDIA_GREENHOUSE_BOARDS = ["groww", "hackerrank"];

const INDIA_LEVER_BOARDS = [
  "meesho",
  "paytm",
  "cred",
  "zeta",
  "mindtickle",
  "fampay",
  "epifi",
];

const INDIA_ASHBY_BOARDS = ["atlan"];

const GREENHOUSE_BOARDS = [
  // AI-data companies: the source of non-technical AI roles.
  "scaleai",
  "invisibletech",
  "anthropic",
  "turing",
  "labelbox",
  // Volume, and non-engineering roles.
  "stripe",
  "airbnb",
  "databricks",
  "figma",
  "discord",
  "reddit",
  "coinbase",
  "robinhood",
  "instacart",
  "gitlab",
  "elastic",
  "datadog",
  "twilio",
  ...INDIA_GREENHOUSE_BOARDS,
];

const LEVER_BOARDS = [...INDIA_LEVER_BOARDS];

const ASHBY_BOARDS = [
  "mercor",
  "sierra",
  "perplexity",
  "cohere",
  "handshake",
  "openai",
  "linear",
  "ramp",
  "notion",
  "replit",
  "runway",
  "elevenlabs",
  "suno",
  "synthesia",
  ...INDIA_ASHBY_BOARDS,
];

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json",
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchGreenhouseBoard(token) {
  const response = await fetch(
    `https://boards-api.greenhouse.io/v1/boards/${token}/jobs`,
    { headers: DEFAULT_HEADERS }
  );

  if (!response.ok) {
    throw new Error(`Greenhouse board "${token}" failed: ${response.status}`);
  }

  const data = await response.json();
  return data.jobs || [];
}

/**
 * Lever. Returns a bare array rather than an object with a `jobs` key, and
 * a job's location lives under `categories`.
 */
async function fetchLeverBoard(token) {
  const response = await fetch(
    `https://api.lever.co/v0/postings/${token}?mode=json`,
    { headers: DEFAULT_HEADERS }
  );

  if (!response.ok) {
    throw new Error(`Lever board "${token}" failed: ${response.status}`);
  }

  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

async function fetchAshbyBoard(token) {
  const response = await fetch(
    `https://api.ashbyhq.com/posting-api/job-board/${token}`,
    { headers: DEFAULT_HEADERS }
  );

  if (!response.ok) {
    throw new Error(`Ashby board "${token}" failed: ${response.status}`);
  }

  const data = await response.json();
  return data.jobs || [];
}

/**
 * Returns one entry per company board. The company name rides on the entry
 * because Ashby's job objects don't carry it - only the board does.
 */
async function fetchAiCompanyBoards({ delayMs = 400 } = {}) {
  const boards = [
    ...GREENHOUSE_BOARDS.map((token) => ({ token, source: "greenhouse", fetcher: fetchGreenhouseBoard })),
    ...LEVER_BOARDS.map((token) => ({ token, source: "lever", fetcher: fetchLeverBoard })),
    ...ASHBY_BOARDS.map((token) => ({ token, source: "ashby", fetcher: fetchAshbyBoard })),
  ];

  const results = [];
  for (const board of boards) {
    try {
      const jobs = await board.fetcher(board.token);
      results.push({ source: board.source, company: board.token, jobs });
    } catch (err) {
      results.push({
        source: board.source,
        company: board.token,
        error: err.message,
        jobs: [],
      });
    }
    await sleep(delayMs);
  }

  return results;
}

module.exports = {
  GREENHOUSE_BOARDS,
  LEVER_BOARDS,
  ASHBY_BOARDS,
  INDIA_GREENHOUSE_BOARDS,
  INDIA_LEVER_BOARDS,
  INDIA_ASHBY_BOARDS,
  fetchGreenhouseBoard,
  fetchLeverBoard,
  fetchAshbyBoard,
  fetchAiCompanyBoards,
};
