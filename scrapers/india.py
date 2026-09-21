"""
India job scraping, via JobSpy for Indeed + LinkedIn with
country_indeed="India".

Naukri used to be the other half of this file. It was removed: its internal
search API answers every request with a reCAPTCHA challenge and its public
search pages return 503, so the only way through would be defeating bot
protection. India coverage rides on JobSpy plus the Indian company boards in
scrapers/aiCompanies.js.

This script does NOT normalize anything - it writes out the raw response
untouched, so the normalization step later has the original data to work
from. runDaily.js calls run_jobspy() directly rather than running this file.
"""

import json
from pathlib import Path

from jobspy import scrape_jobs

# India was 7.7% of everything the pipeline stored, and this file was most of
# the reason: it searched ten AI job titles while the board itself carries
# seven categories. An Indian student looking for a design or marketing role
# saw international listings only, because nothing was asking India for them.
#
# The list now mirrors the categories in pipeline/taxonomy.js. Keep it that
# way when either changes - a category with no keyword here is a category with
# no Indian jobs in it.
KEYWORDS = [
    # The operator roles the syllabus actually trains for. These come first
    # because they are the point of the board: pipeline/syllabus.js ranks a
    # job on how well it matches the Menler curriculum, and no ranking can
    # surface a listing that was never fetched. The searches used to spend
    # five slots on MLOps, computer vision, deep learning, NLP and AI
    # research - all things the programme explicitly does not teach, and all
    # of which the scorer now pushes to the bottom of the board.
    "AI automation",
    "AI consultant",
    "workflow automation",
    "no code developer",
    "AI agent developer",
    "conversational AI",
    "prompt engineer",
    # AI-Tech, the reachable end of it.
    "AI engineer",
    "machine learning engineer",
    "generative AI",
    "data scientist",
    # AI-NonTech: barely exists as a job title on general boards, but the
    # few that do post here are exactly the entry-level roles students want.
    "AI trainer",
    "data annotation",
    "AI content",
    # Tech
    "software engineer",
    "backend developer",
    "frontend developer",
    "data analyst",
    "devops engineer",
    # Creative
    "video editor",
    "graphic designer",
    "motion graphics",
    "UI UX designer",
    # Marketing
    "digital marketing",
    "social media manager",
    "performance marketing",
    "SEO specialist",
    # Writing
    "content writer",
    "copywriter",
    # Business
    "business analyst",
    "product manager",
]

# Was 20. Indian listings for one title run well past that, and the cost of
# asking for more is a slower run rather than a rejected one.
RESULTS_WANTED = 40

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
            results_wanted=RESULTS_WANTED,
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
