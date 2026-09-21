/**
 * AmbitionBox.
 *
 * WHY IT IS HERE. India was the weakest part of the board, and Naukri - the
 * obvious fix - answers every scripted request with a reCAPTCHA wall
 * (re-checked today: still 406). AmbitionBox aggregates Naukri's listings and
 * serves them without one, so this is the closest thing to Naukri coverage
 * that does not involve defeating bot protection. The `portal` field on each
 * job usually says "naukri".
 *
 * HOW IT WORKS. There is no API. The jobs page is server-rendered by Next.js,
 * which means the data is already sitting in the page as JSON inside the
 * `__NEXT_DATA__` script tag - so this reads that rather than parsing markup,
 * which would break on the next redesign.
 *
 * WHAT IT IS WORTH, HONESTLY. About 20 jobs a run. Only the bare /jobs URL
 * returns data: `?page=2`, `?keyword=`, and every category path
 * (/jobs/data-scientist-jobs and friends) all answer 200 with an empty 20KB
 * shell, so there is no pagination and no search to exploit. That makes this
 * a small, steady trickle of Indian listings rather than a volume source, and
 * it is fragile in a way the keyless APIs are not: an undocumented payload
 * that can change shape without warning. It fails soft for exactly that
 * reason - no jobs rather than a thrown error.
 */

"use strict";

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
};

const JOBS_URL = "https://www.ambitionbox.com/jobs";

/**
 * "1 day ago", "today", "30+ days ago" -> an ISO date.
 *
 * AmbitionBox only ever gives a relative age, so this is approximate by
 * nature. Anything it can't read comes back null rather than as today's
 * date, because a wrong posting date would put a stale job at the top of a
 * board sorted by recency.
 */
function parsePostedOn(text) {
  if (typeof text !== "string") return null;

  const value = text.trim().toLowerCase();
  if (!value) return null;
  if (/just now|today|few hours/.test(value)) return new Date().toISOString();

  const match = value.match(/(\d+)\+?\s*(hour|day|week|month)/);
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2];
  const hours =
    unit === "hour" ? amount : unit === "day" ? amount * 24 : unit === "week" ? amount * 168 : amount * 720;

  return new Date(Date.now() - hours * 3600 * 1000).toISOString();
}

/** Pulls the SSR payload out of the page. */
function extractJobs(html) {
  const match = html.match(/id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) return [];

  try {
    const data = JSON.parse(match[1]);
    const list = data?.props?.pageProps?.jobsList;
    return Array.isArray(list) ? list : [];
  } catch {
    // A payload we can't parse is a changed page, not a crash worth having.
    return [];
  }
}

async function fetchAmbitionBox() {
  const response = await fetch(JOBS_URL, { headers: DEFAULT_HEADERS });

  if (!response.ok) {
    throw new Error(`AmbitionBox request failed: ${response.status}`);
  }

  const jobs = extractJobs(await response.text()).map((job) => ({
    ...job,
    // Normalize what the mapper needs, while leaving the rest raw.
    postedAtIso: parsePostedOn(job.postedOn),
  }));

  return [{ source: "ambitionbox", jobs }];
}

module.exports = { fetchAmbitionBox, extractJobs, parsePostedOn, JOBS_URL };
