"""
India job scraping, via JobSpy for Indeed + LinkedIn with
country_indeed="India".

Naukri used to be the other half of this file. It was removed: its internal
search API answers every request with a reCAPTCHA challenge and its public
search pages return 503, so the only way through would be defeating bot
protection. India coverage now rides on JobSpy.

This script does NOT normalize anything - it writes out the raw response
untouched, so the normalization step later has the original data to work
from. runDaily.js calls run_jobspy() directly rather than running this file.
"""

import json
from pathlib import Path

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

SCRAPERS_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = SCRAPERS_DIR.parent / "db" / "raw"


def run_jobspy():
    """Calls JobSpy once per keyword for Indeed + LinkedIn, scoped to India."""
    results = []
    for keyword in KEYWORDS:
        jobs_df = scrape_jobs(
            site_name=["indeed", "linkedin"],
            search_term=keyword,
            country_indeed="India",
            results_wanted=20,
        )
        results.append(
            {
                "keyword": keyword,
                "source": "jobspy",
                "jobs": json.loads(jobs_df.to_json(orient="records")),
            }
        )
    return results


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print("Running JobSpy (Indeed + LinkedIn, India)...")
    jobspy_results = run_jobspy()
    jobspy_path = OUTPUT_DIR / "jobspy_india_raw.json"
    with open(jobspy_path, "w", encoding="utf-8") as f:
        json.dump(jobspy_results, f, indent=2, ensure_ascii=False)
    print(f"JobSpy: {len(jobspy_results)} keyword searches -> {jobspy_path}")


if __name__ == "__main__":
    main()
