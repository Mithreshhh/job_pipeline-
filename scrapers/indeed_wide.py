"""
Indeed, swept wide and fresh: every kind of role, posted in the last day.

The other JobSpy scrapers (india.py, jobspy_global.py) ask for 20-40 results
per search with no age limit, so most of what they return is listings the
board already holds. This one asks the opposite question - everything posted
since the last run, up to Indeed's own ceiling of about 1,000 per search - so
nearly every row it returns is new.

WHY IT EXISTS. Skeo's board is a 15-day window, and at ~4,000 new jobs a day
it held ~64,000 - well under the 1 lakh it is meant to show. Measured on
7 Nov 2026, from one machine, with hours_old=24:

    India, 60 searches        ~2,600 unique jobs after normalize + dedupe
                              (city-by-city searches added 21 more, so
                              this is Indeed India's whole daily supply)
    UK, 20 searches           ~2,300
    UAE + Singapore           ~700
    USA, 20 searches          ~8,500

and the first full core plan (India, Gulf, Singapore, UK, Canada, Australia
at 30 hours) gave 12,159 unique jobs in 259 seconds, none refused.

WHY TWO TIERS. That is more than the board needs: on top of the ~4,000 a day
the other sources bring, it would hold well over 2 lakh, more than the
database is sized for. So India and the markets Indian graduates move to
first - the Gulf, Singapore, the UK - are the "core" and run every day, and
Canada, Australia and the USA are a "reserve" that runDaily.js adds only on a
morning the board is below its target (db/boardSize.js).

ON ROBOTS.TXT. Indeed's robots.txt allows search pages to every agent,
Anthropic's included. Naukri, LinkedIn's guest pages, Lever's hosted boards
and Internshala all disallow Claude's crawlers, which is why none of them is
widened here.

Writes JSON to the path given as the first argument rather than stdout: a
day's sweep is tens of thousands of rows, and a file has no buffer limit.

    python scrapers/indeed_wide.py <out.json> [core|reserve]
"""

import json
import sys
from concurrent.futures import ThreadPoolExecutor

# Each search covers the role and every title containing it, so broad words
# ("manager", "executive") carry most of the volume and the specific ones
# reach what the broad ones miss. Mirrors the categories in
# pipeline/taxonomy.js: Tech, Creative, Marketing, Writing, Business and AI.
INDIA_TERMS = [
    # Broad, the bulk of the day.
    "developer",
    "engineer",
    "analyst",
    "executive",
    "manager",
    "associate",
    "consultant",
    "operations",
    "sales",
    "marketing",
    "designer",
    "content",
    "data",
    "customer support",
    "business development",
    "accountant",
    "hr",
    # Entry level: Indian postings say "fresher" and "trainee".
    "fresher",
    "trainee",
    "intern",
    "graduate",
    "management trainee",
    # AI, the reason the board exists.
    "AI",
    "machine learning",
    "generative AI",
    "prompt engineer",
    "automation",
    # Specific titles the broad searches undercount.
    "software developer",
    "full stack developer",
    "python developer",
    "java developer",
    "react developer",
    "web developer",
    "qa engineer",
    "devops",
    "cloud engineer",
    "data analyst",
    "data engineer",
    "business analyst",
    "product manager",
    "project manager",
    "graphic designer",
    "ui ux designer",
    "video editor",
    "content writer",
    "social media",
    "digital marketing",
    "seo",
    "sales executive",
    "relationship manager",
    "customer success",
    "account manager",
    "operations executive",
    "talent acquisition",
    "research analyst",
    "founder's office",
    "chief of staff",
    "freelance",
]

# The rest of the world gets the broad words only: they carry the volume, and
# these jobs rank below India's anyway (pipeline/ranking.js, indiaFit).
BROAD_TERMS = [
    "developer",
    "engineer",
    "analyst",
    "executive",
    "manager",
    "associate",
    "consultant",
    "operations",
    "sales",
    "marketing",
    "designer",
    "content",
    "data",
    "customer support",
    "business development",
    "intern",
    "graduate",
    "entry level",
    "remote",
    "AI",
]

# Where Indian graduates go: the Gulf and Singapore first, then the English-
# speaking markets. JobSpy's own spellings of the country names.
CORE_MARKETS = ["United Arab Emirates", "Singapore", "UK"]
RESERVE_MARKETS = ["Canada", "Australia", "USA"]

# The pipeline runs once a day. Six hours of overlap means a job posted just
# before last morning's run is not lost between the two.
HOURS_OLD = 30

# Indeed's own ceiling for one search. Asking for it costs a few more pages,
# not a refusal.
RESULTS_WANTED = 1000

# Searches in flight at once. Three kept every search answered when measured;
# more is how a rate limit starts.
WORKERS = 3

# Descriptions are read for relevance and seniority, and the first few
# thousand characters carry both. Uncapped, a day's sweep is hundreds of MB.
DESCRIPTION_CHARS = 4000


def search_plan(tier="core"):
    """Every (term, market) this tier asks for. Counted in tests."""
    if tier == "reserve":
        return [(term, market) for market in RESERVE_MARKETS for term in BROAD_TERMS]
    plan = [(term, "India") for term in INDIA_TERMS]
    plan += [(term, market) for market in CORE_MARKETS for term in BROAD_TERMS]
    return plan


def entry_source(market):
    """
    normalize.js reads a "jobspy" entry as Indian by default and a
    "jobspy-indeed" one as international, so the market decides the label.
    """
    return "jobspy" if market == "India" else "jobspy-indeed"


def _search(pair):
    from jobspy import scrape_jobs

    term, market = pair
    entry = {"keyword": term, "market": market, "source": entry_source(market), "jobs": []}
    try:
        frame = scrape_jobs(
            site_name=["indeed"],
            search_term=term,
            country_indeed=market,
            results_wanted=RESULTS_WANTED,
            hours_old=HOURS_OLD,
        )
        jobs = json.loads(frame.to_json(orient="records"))
        for job in jobs:
            if isinstance(job.get("description"), str):
                job["description"] = job["description"][:DESCRIPTION_CHARS]
        entry["jobs"] = jobs
    except Exception as err:  # noqa: BLE001 - one search must not stop the sweep
        entry["error"] = str(err)[:300]
    return entry


def run(tier="core"):
    with ThreadPoolExecutor(WORKERS) as pool:
        return list(pool.map(_search, search_plan(tier)))


def main():
    out_path = sys.argv[1]
    tier = sys.argv[2] if len(sys.argv) > 2 else "core"
    results = run(tier)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False)
    found = sum(len(entry["jobs"]) for entry in results)
    failed = sum(1 for entry in results if entry.get("error"))
    print(f"indeed_wide {tier}: {len(results)} searches, {found} jobs, {failed} failed", file=sys.stderr)


if __name__ == "__main__":
    main()
