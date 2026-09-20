/**
 * We Work Remotely, read from its public RSS feeds.
 *
 * WWR is design/marketing/support heavy, which is exactly the non-AI
 * coverage the board was missing. The main feed and the per-category feeds
 * overlap, but dedupe collapses that later, so pulling all of them is the
 * cheapest way to raise volume.
 *
 * Their item titles are formatted "Company: Job Title" - the mapper splits
 * that, since it's the only place the company name appears.
 */

"use strict";

const { XMLParser } = require("fast-xml-parser");

const FEEDS = [
  "https://weworkremotely.com/remote-jobs.rss",
  "https://weworkremotely.com/categories/remote-programming-jobs.rss",
  "https://weworkremotely.com/categories/remote-design-jobs.rss",
  "https://weworkremotely.com/categories/remote-sales-and-marketing-jobs.rss",
  "https://weworkremotely.com/categories/remote-customer-support-jobs.rss",
  "https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss",
  "https://weworkremotely.com/categories/remote-product-jobs.rss",
  "https://weworkremotely.com/categories/remote-management-and-finance-jobs.rss",
];

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/rss+xml, application/xml, text/xml",
};

const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchFeed(url) {
  const response = await fetch(url, { headers: DEFAULT_HEADERS });
  if (!response.ok) {
    throw new Error(`WeWorkRemotely feed failed (${url}): ${response.status}`);
  }

  const xml = await response.text();
  const parsed = parser.parse(xml);
  const items = (parsed.rss && parsed.rss.channel && parsed.rss.channel.item) || [];

  // A feed with a single item parses to an object rather than an array.
  return Array.isArray(items) ? items : [items];
}

async function fetchWeWorkRemotely({ delayMs = 400 } = {}) {
  const results = [];

  for (const feed of FEEDS) {
    try {
      const jobs = await fetchFeed(feed);
      results.push({ source: "weworkremotely", feed, jobs });
    } catch (err) {
      results.push({ source: "weworkremotely", feed, error: err.message, jobs: [] });
    }
    await sleep(delayMs);
  }

  return results;
}

module.exports = { FEEDS, fetchFeed, fetchWeWorkRemotely };
