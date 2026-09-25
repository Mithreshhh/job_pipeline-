"""
India job scraping, via JobSpy for Indeed + LinkedIn with
country_indeed="India".

Naukri used to be the other half of this file. It was removed and stays
removed: its robots.txt now names claudebot, Claude-User and Claude-SearchBot
under `Disallow: /`, and its search API answers with a reCAPTCHA challenge
regardless. India coverage rides on JobSpy, the Indian company boards in
scrapers/aiCompanies.js, AmbitionBox, and Instahyre.

This script does NOT normalize anything - it writes out the raw response
untouched, so the normalization step later has the original data to work
from. runDaily.js imports run_jobspy() directly rather than running this file.
"""

import json
from pathlib import Path

from jobspy import scrape_jobs

# The nationwide sweep. One call each, no location, country_indeed="India",
# so these reach the whole country.
#
# The list mirrors the categories in pipeline/taxonomy.js. Keep it that way
# when either changes: a category with no keyword here is a category with no
# Indian jobs in it.
KEYWORDS = [
    # The operator roles the syllabus actually trains for. These come first
    # because they are the point of the board: pipeline/syllabus.js ranks a
    # job on how well it matches the Menler curriculum, and no ranking can
    # surface a listing that was never fetched.
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

# Terms that find the jobs a Menler graduate can actually get, which the
# title-led list above mostly misses. Indian postings say "fresher" and
# "graduate engineer trainee" where Western ones say "junior", and searching
# for the role never surfaces them.
#
# Run nationwide, because a fresher will move for a first job.
FRESHER_KEYWORDS = [
    "fresher",
    "trainee",
    "graduate engineer trainee",
    "junior",
    "associate",
    "intern",
    "AI intern",
    "0-1 years",
]

# The metros, plus the tier-2 cities where the salary is lower and the
# competition thinner - which is where a student without a tier-1 degree has
# the better chance.
#
# "India remote" is in the list because remote roles are frequently posted
# with no city at all and are missed by every city search.
CITIES = [
    "Bengaluru, India",
    "Hyderabad, India",
    "Pune, India",
    "Chennai, India",
    "Mumbai, India",
    "Delhi, India",
    "Gurugram, India",
    "Noida, India",
    "Kolkata, India",
    "Ahmedabad, India",
    "Kochi, India",
    "Jaipur, India",
    "Indore, India",
    "Coimbatore, India",
    "India remote",
]

# What gets crossed with every city. Deliberately three terms and not thirty.
#
# The arithmetic is the whole design here. Crossing all 31 keywords with all
# 15 locations is 465 JobSpy calls at 15-25 seconds each, which is three
# hours for a job that has to finish inside a 6am cron. Three broad terms
# against 15 locations is 45 calls, and because they are broad they return
# the city's AI and entry-level postings rather than one narrow title's.
#
# Total plan: 31 nationwide + 8 fresher + 45 city = 84 calls, against 31
# before. Change CITY_KEYWORDS and you change the runtime linearly, so check
# search_plan() before adding to it.
CITY_KEYWORDS = [
    "AI",
    "AI intern",
    "fresher",
]

# Was 20. Indian listings for one title run well past that, and the cost of
# asking for more is a slower run rather than a rejected one.
RESULTS_WANTED = 40

# City searches are narrower, so fewer results are needed per call and the
# extra 45 calls stay affordable.
CITY_RESULTS_WANTED = 25

SCRAPERS_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = SCRAPERS_DIR.parent / "db" / "raw"


def search_plan():
    """
    Every (keyword, location, results_wanted) this run will ask for.

    Separated out so the call budget can be counted without running anything,
    and so a change to the lists shows up as a number rather than as a slower
    morning.
    """
    plan = [(keyword, None, RESULTS_WANTED) for keyword in KEYWORDS]
    plan += [(keyword, None, RESULTS_WANTED) for keyword in FRESHER_KEYWORDS]
    plan += [
        (keyword, city, CITY_RESULTS_WANTED)
        for city in CITIES
        for keyword in CITY_KEYWORDS
    ]
    return plan


def run_jobspy():
    """
    Calls JobSpy once per (keyword, location), for Indeed + LinkedIn, India.

    One failure does not abandon the rest: a single keyword getting rate
    limited should cost that keyword, not the morning's India coverage. The
    error is recorded in the entry so a source going quiet is visible in the
    raw file rather than silent.
    """
    results = []

    for keyword, location, wanted in search_plan():
        entry = {
            "keyword": keyword,
            "location": location,
            "source": "jobspy",
            "jobs": [],
        }

        try:
            kwargs = {
                "site_name": ["indeed", "linkedin"],
                "search_term": keyword,
                "country_indeed": "India",
                "results_wanted": wanted,
            }
            if location:
                kwargs["location"] = location

            jobs_df = scrape_jobs(**kwargs)
            entry["jobs"] = json.loads(jobs_df.to_json(orient="records"))
        except Exception as err:  # noqa: BLE001 - one keyword must not stop the run
            entry["error"] = str(err)

        results.append(entry)

    return results


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    plan = search_plan()
    print(f"Running JobSpy (Indeed + LinkedIn, India): {len(plan)} searches...")

    jobspy_results = run_jobspy()
    jobspy_path = OUTPUT_DIR / "jobspy_india_raw.json"
    with open(jobspy_path, "w", encoding="utf-8") as f:
        json.dump(jobspy_results, f, indent=2, ensure_ascii=False)

    found = sum(len(entry["jobs"]) for entry in jobspy_results)
    failed = sum(1 for entry in jobspy_results if entry.get("error"))
    print(f"JobSpy: {len(jobspy_results)} searches, {found} jobs, {failed} failed -> {jobspy_path}")


if __name__ == "__main__":
    main()
