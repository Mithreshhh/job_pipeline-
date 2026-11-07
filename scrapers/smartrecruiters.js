/**
 * SmartRecruiters company boards, India postings only.
 *
 * The fourth keyless ATS beside Greenhouse, Lever and Ashby, and the one large
 * Indian employers use: Bosch's Bengaluru software centre, Swiggy, ServiceNow
 * and Experian's Indian offices all publish here. The public postings API
 * takes a country filter, so only Indian roles are fetched rather than a
 * global board read and thrown away.
 *
 * Measured on 7 Nov 2026 with country=in: Bosch 572 open roles, Swiggy 189,
 * ServiceNow 83, Sutherland 53, Experian 38, Freshworks 32 - most released in
 * the last fifteen days. They are real employers with a direct apply link,
 * which is what Menler's board prefers.
 *
 * The same two checks as scrapers/aiCompanies.js before adding a company:
 * does it return jobs (a wrong identifier returns an empty list, not an
 * error), and are they in India (the filter is trusted, but print a few).
 * Identifiers are case-insensitive; `name` is what the board shows, because
 * the API's own is often all capitals ("SWIGGY").
 */

"use strict";

const INDIA_COMPANIES = [
  { id: "BoschGroup", name: "Bosch" },
  { id: "Swiggy", name: "Swiggy" },
  { id: "ServiceNow", name: "ServiceNow" },
  { id: "Sutherland", name: "Sutherland" },
  { id: "Experian", name: "Experian" },
  { id: "Freshworks", name: "Freshworks" },
  { id: "Continental", name: "Continental" },
  { id: "Endava", name: "Endava" },
  { id: "WesternDigital", name: "Western Digital" },
];

const PAGE_SIZE = 100;

// Bosch is the largest at ~600, so ten pages is room to double before
// anything is left behind.
const MAX_PAGES = 10;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Every Indian posting a company has open, following the offset pages. */
async function fetchCompany(id, { country = "in", delayMs = 300 } = {}) {
  const jobs = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url =
      `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(id)}/postings` +
      `?country=${country}&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`;
    const response = await fetch(url, { headers: HEADERS });
    if (!response.ok) throw new Error(`SmartRecruiters "${id}" failed: ${response.status}`);

    const data = await response.json();
    const content = Array.isArray(data.content) ? data.content : [];
    jobs.push(...content);
    if (content.length < PAGE_SIZE || jobs.length >= (data.totalFound || 0)) break;
    await sleep(delayMs);
  }
  return jobs;
}

/** One entry per company, the shape normalize expects. */
async function fetchSmartRecruiters({ companies = INDIA_COMPANIES, delayMs = 300 } = {}) {
  const results = [];
  for (const company of companies) {
    try {
      const jobs = await fetchCompany(company.id, { delayMs });
      results.push({ source: "smartrecruiters", company: company.name, jobs });
    } catch (err) {
      results.push({ source: "smartrecruiters", company: company.name, error: err.message, jobs: [] });
    }
    await sleep(delayMs);
  }
  return results;
}

module.exports = { fetchSmartRecruiters, fetchCompany, INDIA_COMPANIES };
