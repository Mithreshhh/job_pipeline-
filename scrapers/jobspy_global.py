"""
Runs JobSpy (Indeed + LinkedIn) for the same AI keyword list used for India,
but without restricting to India.

JobSpy's Indeed integration needs one country per call (there's no single
"search everywhere" mode), so this loops over a handful of major
English-speaking job markets instead of every country on earth. LinkedIn
doesn't need a country param in JobSpy, so it's called once per keyword,
globally.

This is invoked as a subprocess from scrapers/international.js (Node),
since JobSpy is a Python-only library - the same cross-language bridge
india.py uses, just in the opposite direction.
"""

import json

from jobspy import scrape_jobs

KEYWORDS = [
    "machine learning engineer",
    "AI engineer",
    "data scientist",
    "NLP engineer",
    "deep learning engineer",
    "generative AI",
    "computer vision engineer",
    "MLOps",
    "AI researcher",
    "prompt engineer",
]

INDEED_MARKETS = ["USA", "UK", "Canada", "Australia"]


def run():
    results = []

    for keyword in KEYWORDS:
        for market in INDEED_MARKETS:
            try:
                jobs_df = scrape_jobs(
                    site_name=["indeed"],
                    search_term=keyword,
                    country_indeed=market,
                    results_wanted=20,
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
                results_wanted=20,
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
