"""
Runs JobSpy (Indeed + LinkedIn) without restricting to India.

JobSpy's Indeed integration needs one country per call (there is no single
"search everywhere" mode), so this loops over a handful of major
English-speaking job markets instead of every country on earth. LinkedIn does
not need a country param in JobSpy, so it is called once per keyword,
globally.

This is invoked as a subprocess from scrapers/international.js (Node), since
JobSpy is a Python-only library - the same cross-language bridge india.py
uses, in the opposite direction.

WHY INDIA IS IN THE MARKET LIST. The global LinkedIn pass returns worldwide
results with no country filter, and Indian postings lose to American ones on
volume. Naming India as an Indeed market gives the same keyword a second,
India-scoped pass. City-level Indian depth is NOT duplicated here: that is 45
calls and it lives in india.py, which is the file that owns India.
"""

import json

from jobspy import scrape_jobs

# Aligned with pipeline/syllabus.js, for the same reason india.py is: no
# ranking can surface a listing that was never fetched, and the reverse also
# holds - there is no point spending a fifth of the run fetching jobs the
# scorer sends to the bottom of the board.
#
# The list this replaced spent half its slots on MLOps, computer vision, deep
# learning, NLP engineering and AI research. A six-week Claude-first
# programme does not prepare anyone for those, and pipeline/ranking.js now
# scores them accordingly.
KEYWORDS = [
    "AI automation",
    "AI consultant",
    "workflow automation",
    "no code developer",
    "AI agent developer",
    "prompt engineer",
    "AI engineer",
    "generative AI",
    "machine learning engineer",
    "data scientist",
    "AI content",
]

# India last, so a rate limit late in the run costs the market we have the
# most other coverage for rather than the one we have the least.
INDEED_MARKETS = ["USA", "UK", "Canada", "Australia", "India"]

RESULTS_WANTED = 20


def search_plan():
    """Every (keyword, market) pair this run will ask for. Counted in tests."""
    plan = [(keyword, market) for keyword in KEYWORDS for market in INDEED_MARKETS]
    plan += [(keyword, "global") for keyword in KEYWORDS]
    return plan


def run():
    results = []

    for keyword in KEYWORDS:
        for market in INDEED_MARKETS:
            try:
                jobs_df = scrape_jobs(
                    site_name=["indeed"],
                    search_term=keyword,
                    country_indeed=market,
                    results_wanted=RESULTS_WANTED,
                )
                results.append(
                    {
                        "keyword": keyword,
                        "market": market,
                        "source": "jobspy-indeed",
                        "jobs": json.loads(jobs_df.to_json(orient="records")),
                    }
                )
            except Exception as err:  # keep going even if one market fails
                results.append(
                    {
                        "keyword": keyword,
                        "market": market,
                        "source": "jobspy-indeed",
                        "error": str(err),
                        "jobs": [],
                    }
                )

        try:
            jobs_df = scrape_jobs(
                site_name=["linkedin"],
                search_term=keyword,
                results_wanted=RESULTS_WANTED,
            )
            results.append(
                {
                    "keyword": keyword,
                    "market": "global",
                    "source": "jobspy-linkedin",
                    "jobs": json.loads(jobs_df.to_json(orient="records")),
                }
            )
        except Exception as err:
            results.append(
                {
                    "keyword": keyword,
                    "market": "global",
                    "source": "jobspy-linkedin",
                    "error": str(err),
                    "jobs": [],
                }
            )

    return results


if __name__ == "__main__":
    print(json.dumps(run()))
