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
 * Greenhouse and Ashby both publish an official, keyless JSON endpoint per
 * company, so this reads a public API rather than scraping. The cost is a
 * hand-maintained list: add a token when you find another company worth
 * tracking, and check it returns jobs (a wrong token returns an empty list
 * rather than an error).
 */

"use strict";

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
];

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
  ASHBY_BOARDS,
  fetchGreenhouseBoard,
  fetchAshbyBoard,
  fetchAiCompanyBoards,
};
