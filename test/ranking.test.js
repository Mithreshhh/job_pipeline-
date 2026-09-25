/**
 * Tests for the four scores that order the board.
 *
 * These matter more than most tests here, because this is the code that
 * decides what a student sees on page one. Every case below is written from a
 * real posting shape rather than a minimal fixture: the failures worth
 * catching are the ones where a rule reads a title correctly and still gets
 * the job wrong.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");

const {
  RANK_WEIGHTS,
  yearsRequired,
  scoreAchievability,
  scoreIndiaFit,
  scoreEaseOfApply,
  combineRank,
  scoreJobRank,
  MAX_REASONS,
  OFF_TOPIC_DAMPING,
} = require("../pipeline/ranking.js");

const achievability = (job) => scoreAchievability(job).score;
const indiaFit = (job) => scoreIndiaFit(job).score;
const easeOfApply = (job) => scoreEaseOfApply(job).score;

/* ------------------------------------------------------------------ *
 * Achievability
 * ------------------------------------------------------------------ */

test("achievability follows the stated experience level", () => {
  // A title with no seniority signal either way, so the level field is the
  // only evidence in play.
  const base = { title: "AI Engineer", description: "" };

  assert.ok(achievability({ ...base, experienceLevel: "internship" }) > 80);
  assert.ok(achievability({ ...base, experienceLevel: "entry" }) > 80);
  assert.ok(
    achievability({ ...base, experienceLevel: "mid" }) >
      achievability({ ...base, experienceLevel: "senior" }),
  );
});

test("a senior title sinks a job even when the level field says otherwise", () => {
  // Sources disagree with themselves constantly. LinkedIn will label a
  // "Principal Engineer" as mid-level because of how the poster filled a
  // dropdown; the title is the better evidence.
  const score = achievability({
    title: "Principal Machine Learning Engineer",
    experienceLevel: "mid",
    description: "",
  });

  assert.ok(score < 25, `scored ${score}`);
});

test('"Senior" inside an intern title does not sink it', () => {
  // The edge case that made the junior list override the senior one. Both of
  // these are entry-level jobs whose titles happen to contain a senior word,
  // and both are exactly what this board exists to surface.
  const cases = [
    "AI Intern - Supporting Senior Engineers",
    "Graduate Engineer Trainee (reports to Lead Data Scientist)",
    "Junior Developer - Senior Team",
    "Apprentice, Senior Analytics Group",
  ];

  for (const title of cases) {
    const { score, reasons } = scoreAchievability({ title, experienceLevel: "unspecified" });
    assert.ok(score > 80, `"${title}" scored ${score}`);
    assert.ok(
      !reasons.some((r) => r.endsWith("role")),
      `"${title}" was penalised as senior: ${reasons.join(", ")}`,
    );
  }
});

test("years of experience are read from the requirement, not from prose", () => {
  assert.equal(yearsRequired("we need 5+ years of experience with python"), 5);
  assert.equal(yearsRequired("experience: 8-10 years in the field"), 10);
  assert.equal(yearsRequired("minimum 3 years relevant experience"), 3);
  assert.equal(yearsRequired("0-1 years of experience, freshers welcome"), 1);

  // The number has to be attached to an experience phrase. A company's age,
  // a product's age and a funding round are all irrelevant.
  assert.equal(yearsRequired("we were founded 12 years ago"), null);
  assert.equal(yearsRequired("a 10 year old product used by millions"), null);
  assert.equal(yearsRequired("no numbers at all here"), null);
});

test("a long experience requirement outweighs a friendly title", () => {
  const friendly = scoreAchievability({
    title: "AI Engineer",
    experienceLevel: "unspecified",
    description: "You will love it here. Requires 8+ years of experience building ML systems.",
  });

  const same = achievability({ title: "AI Engineer", experienceLevel: "unspecified", description: "" });

  assert.ok(friendly.score < same, `${friendly.score} should be under ${same}`);
  assert.ok(friendly.reasons.some((r) => r.includes("8")), friendly.reasons.join(", "));
});

test("the range is taken at its top, because that is what gets hired", () => {
  // "3-8 years" is an eight-year job advertised optimistically.
  assert.equal(yearsRequired("3-8 years of experience"), 8);
});

test("freshers language lifts a job with no level stated", () => {
  const plain = achievability({ title: "Data Annotator", experienceLevel: "unspecified" });
  const open = achievability({
    title: "Data Annotator",
    experienceLevel: "unspecified",
    description: "Freshers welcome. Training will be provided.",
  });

  assert.ok(open > plain);
});

/* ------------------------------------------------------------------ *
 * India fit
 * ------------------------------------------------------------------ */

test("an Indian job scores high and says which city", () => {
  const { score, reasons } = scoreIndiaFit({
    country: "India",
    location: "Bengaluru, Karnataka",
    isRemote: false,
  });

  assert.ok(score > 85);
  assert.ok(reasons.includes("Bengaluru"));
});

test("every city the scrapers search is recognised", () => {
  // If a city is worth a search in scrapers/india.py it is worth naming back
  // to the student, and a mismatch between the two lists is silent.
  const cities = {
    "Bangalore, India": "Bengaluru",
    "Hyderabad, Telangana": "Hyderabad",
    "Pune, Maharashtra": "Pune",
    "Chennai, Tamil Nadu": "Chennai",
    "Navi Mumbai": "Mumbai",
    "New Delhi": "Delhi NCR",
    "Gurgaon, Haryana": "Gurugram",
    "Noida, Uttar Pradesh": "Noida",
    "Kolkata, West Bengal": "Kolkata",
    "Ahmedabad, Gujarat": "Ahmedabad",
    "Kochi, Kerala": "Kochi",
    "Jaipur, Rajasthan": "Jaipur",
    "Indore, Madhya Pradesh": "Indore",
    "Coimbatore, Tamil Nadu": "Coimbatore",
  };

  for (const [location, expected] of Object.entries(cities)) {
    const { reasons } = scoreIndiaFit({ country: "India", location, isRemote: false });
    assert.ok(reasons.includes(expected), `${location} -> ${reasons.join(", ")}`);
  }
});

test("remote that names India beats remote that says nothing", () => {
  const named = indiaFit({
    country: "International",
    location: "Remote",
    isRemote: true,
    description: "This role is remote in India, working IST hours.",
  });
  const silent = indiaFit({
    country: "International",
    location: "Remote",
    isRemote: true,
    description: "This role is fully remote.",
  });
  const onsite = indiaFit({ country: "International", location: "Berlin", isRemote: false });

  assert.ok(named > silent, `${named} should beat ${silent}`);
  assert.ok(silent > onsite);
});

test('a "remote" role that needs US authorization is not open', () => {
  // The case the brief called out. These read as open and are not, and a
  // student who applies has wasted an afternoon.
  const cases = [
    "Fully remote. Must be authorized to work in the United States.",
    "Remote (US only). We cannot provide visa sponsorship.",
    "Remote role. Active security clearance required, TS/SCI preferred.",
    "Remote within the EU. Right to work in the UK required.",
    "Green card or US citizen required.",
  ];

  for (const description of cases) {
    const { score, reasons } = scoreIndiaFit({
      country: "International",
      location: "Remote",
      isRemote: true,
      description,
    });

    assert.ok(score <= 10, `"${description.slice(0, 40)}" scored ${score}`);
    assert.ok(reasons.some((r) => r.startsWith("needs ")), reasons.join(", "));
  }
});

test("a job physically in India keeps its score despite US-sounding text", () => {
  // A Bengaluru role at a US defence contractor is still a job in Bengaluru.
  // Applying the visa gate to it would bury real Indian listings.
  const score = indiaFit({
    country: "India",
    location: "Bengaluru, India",
    isRemote: false,
    description: "You will support US clients who hold a security clearance.",
  });

  assert.ok(score > 85, `scored ${score}`);
});

test("an Indian job quoted in USD is still an Indian job", () => {
  // The brief's third edge case. Remote Indian roles at foreign companies
  // routinely quote dollars, and currency says nothing about eligibility.
  const score = indiaFit({
    country: "India",
    location: "Remote, India",
    isRemote: true,
    description: "Compensation: $45,000 - $60,000 USD per year, paid monthly.",
  });

  assert.ok(score > 85, `scored ${score}`);
});

/* ------------------------------------------------------------------ *
 * Ease of applying
 * ------------------------------------------------------------------ */

test("a direct employer form beats an aggregator", () => {
  const direct = easeOfApply({ url: "https://boards.greenhouse.io/x/jobs/1", source: "greenhouse" });
  const aggregated = easeOfApply({ url: "https://linkedin.com/jobs/view/1", source: "linkedin" });

  assert.ok(direct > aggregated);
});

test("a job with no link cannot be applied to at all", () => {
  const { score, reasons } = scoreEaseOfApply({ url: "", source: "greenhouse" });

  assert.equal(score, 0);
  assert.deepEqual(reasons, ["no apply link"]);
});

test("hurdles in the description cost a job its place", () => {
  const plain = easeOfApply({ url: "https://x.test/1", source: "lever" });

  const hurdles = [
    "There is a take-home assignment before the first call.",
    "Candidates complete an online assessment on HackerRank.",
    "Our process has 5 rounds including a panel.",
    "A cover letter is required with every application.",
  ];

  for (const description of hurdles) {
    const score = easeOfApply({ url: "https://x.test/1", source: "lever", description });
    assert.ok(score < plain, `"${description.slice(0, 30)}" scored ${score}, not below ${plain}`);
  }
});

test("degree gates are the heaviest penalty here", () => {
  // These rule a student out on paper before anything they built is looked
  // at, which is the opposite of what the programme is for.
  const plain = easeOfApply({ url: "https://x.test/1", source: "lever" });

  for (const description of [
    "IIT/NIT graduates only.",
    "A Master's degree is required.",
    "PhD required in a quantitative field.",
  ]) {
    const { score, reasons } = scoreEaseOfApply({ url: "https://x.test/1", source: "lever", description });
    assert.ok(score < plain - 15, `"${description}" scored ${score}`);
    assert.ok(reasons.length > 1, reasons.join(", "));
  }
});

test("an explicitly short application is rewarded", () => {
  const plain = easeOfApply({ url: "https://x.test/1", source: "linkedin" });
  const easy = easeOfApply({
    url: "https://x.test/1",
    source: "linkedin",
    description: "Easy apply, no cover letter needed. No degree required.",
  });

  assert.ok(easy > plain);
});

/* ------------------------------------------------------------------ *
 * The combination
 * ------------------------------------------------------------------ */

test("the weights sum to one, so rankScore stays on the 0-100 scale", () => {
  const total = Object.values(RANK_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `weights sum to ${total}`);

  assert.equal(combineRank({ achievability: 100, indiaFit: 100, easeOfApply: 100, relevance: 100 }), 100);
  assert.equal(combineRank({ achievability: 0, indiaFit: 0, easeOfApply: 0, relevance: 0 }), 0);
  assert.equal(combineRank({}), 0);
});

test("the weights hold the priority order the board promises", () => {
  // Achievable over Indian over easy over relevant.
  assert.ok(RANK_WEIGHTS.achievability > RANK_WEIGHTS.indiaFit);
  assert.ok(RANK_WEIGHTS.indiaFit > RANK_WEIGHTS.easeOfApply);
  assert.ok(RANK_WEIGHTS.easeOfApply > RANK_WEIGHTS.relevance);

  // And combineRank actually honours them. Relevance is held above the
  // damping threshold throughout, so this measures the weights rather than
  // the damping - holding it at 0 would have three axes scaled and the
  // fourth not, which compares nothing useful.
  const on = OFF_TOPIC_DAMPING.threshold + 10;
  const base = { achievability: 0, indiaFit: 0, easeOfApply: 0, relevance: on };
  const lift = (key) => combineRank({ ...base, [key]: 100 }) - combineRank(base);

  assert.ok(lift("achievability") > lift("indiaFit"));
  assert.ok(lift("indiaFit") > lift("easeOfApply"));
});

test("the reachable Indian job beats the perfect unreachable one", () => {
  // The whole point of the change, as one assertion.
  const reachable = scoreJobRank({
    title: "AI Automation Intern",
    description: "Work with n8n and Claude. Freshers welcome, no cover letter.",
    location: "Pune, Maharashtra",
    country: "India",
    isRemote: false,
    url: "https://boards.greenhouse.io/x/1",
    source: "greenhouse",
    experienceLevel: "internship",
    relevance: 58,
    matchedSkills: ["claude", "n8n"],
  });

  const unreachable = scoreJobRank({
    title: "Staff AI Engineer, Claude Platform",
    description:
      "10+ years of experience. Must be authorized to work in the United States. PhD required. Five rounds.",
    location: "San Francisco, CA",
    country: "International",
    isRemote: false,
    url: "https://boards.greenhouse.io/x/2",
    source: "greenhouse",
    experienceLevel: "senior",
    relevance: 90,
    matchedSkills: ["claude", "anthropic"],
  });

  assert.ok(
    reachable.rankScore > unreachable.rankScore,
    `intern ${reachable.rankScore} vs staff ${unreachable.rankScore}`,
  );
  assert.ok(unreachable.relevance === undefined, "relevance is read, not rewritten");
});

test("every job carries a short, deduped reason list", () => {
  const { rankReasons } = scoreJobRank({
    title: "Junior AI Automation Associate",
    description: "Freshers welcome. Easy apply, no cover letter. Remote in India.",
    location: "Remote, India",
    country: "India",
    isRemote: true,
    url: "https://x.test/1",
    source: "greenhouse",
    experienceLevel: "entry",
    relevance: 55,
    matchedSkills: ["claude"],
  });

  assert.ok(rankReasons.length > 0);
  assert.ok(rankReasons.length <= MAX_REASONS, `${rankReasons.length} reasons is too many to read`);
  assert.equal(new Set(rankReasons).size, rankReasons.length, "deduped");
  for (const reason of rankReasons) {
    assert.equal(typeof reason, "string");
    assert.ok(reason.length <= 40, `"${reason}" is too long for a card`);
  }
});

test("every score is an integer inside 0-100", () => {
  const samples = [
    {},
    { title: "VP of AI", experienceLevel: "senior", description: "15+ years of experience" },
    { title: "Intern", country: "India", url: "https://x.test", source: "greenhouse", relevance: 100 },
    { title: null, description: null, location: null, url: null },
  ];

  for (const sample of samples) {
    const r = scoreJobRank(sample);
    for (const key of ["achievability", "indiaFit", "easeOfApply", "rankScore"]) {
      assert.ok(Number.isInteger(r[key]), `${key} = ${r[key]}`);
      assert.ok(r[key] >= 0 && r[key] <= 100, `${key} = ${r[key]}`);
    }
  }
});

test("no ranking pattern depends on a literal control character", () => {
  // A backslash-b written through a template literal is the backspace byte,
  // not a word boundary. That mistake once disabled every pattern in this
  // repo's relevance scoring while every ordering test still passed, so this
  // checks the bytes rather than the behaviour.
  const source = require("node:fs").readFileSync(require.resolve("../pipeline/ranking.js"), "utf8");

  // eslint-disable-next-line no-control-regex
  const control = source.match(/[\x00-\x08\x0b\x0c\x0e-\x1f]/);
  assert.equal(control, null, `ranking.js holds control byte ${control && control[0].charCodeAt(0)}`);

  // And an absolute value, because relative checks all passed last time.
  assert.equal(
    scoreAchievability({ title: "Senior Data Scientist", experienceLevel: "senior" }).score,
    12,
  );
});

test("an Associate Director is not a junior role", () => {
  // "Associate" wins over the seniority list, which is right for "Associate
  // Software Engineer" and badly wrong for these. Caught by a test fixture
  // that happened to use the word.
  for (const title of [
    "Associate Director, AI Platform",
    "Associate Vice President, Data Science",
    "Associate Partner - Technology",
    "Associate Manager - AI / ML",
  ]) {
    const { score } = scoreAchievability({ title, experienceLevel: "senior" });
    assert.ok(score < 30, `"${title}" scored ${score}`);
  }

  // Still junior where it should be.
  assert.ok(
    scoreAchievability({ title: "Associate Software Engineer", experienceLevel: "unspecified" }).score > 80,
  );
});

/* ------------------------------------------------------------------ *
 * The backfill's two modes
 * ------------------------------------------------------------------ */

const { nextRankFor, hasComponents, changed } = require("../scripts/backfillRankScore.js");

test("recombining is exact after a weight change, and keeps the reasons", () => {
  // The common case: the weights moved, the facts about the posting did not.
  // Re-deriving the components from a title we no longer have the
  // description for would throw away information for no reason.
  const stored = {
    title: "AI Automation Associate",
    achievability: 88,
    indiaFit: 92,
    easeOfApply: 70,
    relevance: 58,
    rankScore: 1,
    rankReasons: ["entry level", "Pune", "direct apply"],
  };

  const next = nextRankFor(stored);

  assert.equal(next.mode, "recombined");
  assert.equal(next.achievability, 88);
  assert.equal(next.easeOfApply, 70);
  assert.equal(next.rankScore, combineRank(stored));
  assert.deepEqual(next.rankReasons, stored.rankReasons);
});

test("--rescore recomputes the components instead", () => {
  const stored = {
    title: "Senior Staff Engineer",
    achievability: 88,
    indiaFit: 92,
    easeOfApply: 70,
    relevance: 58,
    experienceLevel: "senior",
  };

  const next = nextRankFor(stored, { rescore: true });

  assert.equal(next.mode, "rescored");
  assert.ok(next.achievability < 30, `stale 88 should be corrected, got ${next.achievability}`);
});

test("a row that was never ranked is scored from the title either way", () => {
  const fresh = { title: "AI Intern", country: "India", url: "https://x.test", source: "greenhouse" };

  assert.equal(hasComponents(fresh), false);
  assert.equal(nextRankFor(fresh).mode, "first scoring");
  assert.ok(nextRankFor(fresh).rankScore > 0);
});

test("a zero score still counts as having been ranked", () => {
  // 0 is a real score. Treating it as missing would rescore every genuinely
  // hopeless listing on every run, and quietly overwrite good components.
  assert.equal(hasComponents({ achievability: 0, indiaFit: 0, easeOfApply: 0 }), true);
  assert.equal(nextRankFor({ achievability: 0, indiaFit: 0, easeOfApply: 0 }).mode, "recombined");
});

test("the backfill only writes rows that actually differ", () => {
  const job = {
    achievability: 88,
    indiaFit: 92,
    easeOfApply: 70,
    relevance: 58,
    rankReasons: ["entry level"],
  };
  const next = nextRankFor(job);

  assert.ok(changed(job, next), "rankScore was stale, so this row needs writing");
  assert.equal(changed({ ...job, rankScore: next.rankScore }, next), false);
});

/* ------------------------------------------------------------------ *
 * Off-topic damping
 * ------------------------------------------------------------------ */

test("a reachable job with nothing to do with the course cannot lead the board", () => {
  // Measured on a real sample before this rule existed: a bank's walk-in
  // hiring drive for a customer service executive in Chennai scored 74 and
  // ranked third, because entry level plus India plus easy to apply is
  // trivially maxed. Relevance at 0.12 could never have caught it.
  const walkIn = { achievability: 88, indiaFit: 92, easeOfApply: 54, relevance: 12 };
  const onTopic = { achievability: 88, indiaFit: 92, easeOfApply: 54, relevance: 50 };

  assert.ok(
    combineRank(walkIn) < combineRank(onTopic) - 20,
    `walk-in ${combineRank(walkIn)} vs on-topic ${combineRank(onTopic)}`,
  );
});

test("damping catches the no-match floor and nothing above it", () => {
  // The threshold has to sit above a category floor with no syllabus match
  // and below every category that has one, or it starts burying legitimate
  // Tech and Creative listings.
  assert.ok(OFF_TOPIC_DAMPING.threshold > 12, "Business with no match scores 12");
  assert.ok(OFF_TOPIC_DAMPING.threshold <= 18, "Creative, Writing and Marketing score 18");

  const reachable = { achievability: 88, indiaFit: 92, easeOfApply: 54 };
  const damped = combineRank({ ...reachable, relevance: OFF_TOPIC_DAMPING.threshold - 1 });
  const undamped = combineRank({ ...reachable, relevance: OFF_TOPIC_DAMPING.threshold });

  assert.ok(undamped > damped, `${undamped} should clear ${damped}`);
});

test("damping can be switched off without touching the scoring", () => {
  // It is the one rule that is not a weighted average, so it has to be easy
  // to remove if the weights alone are wanted.
  const job = { achievability: 88, indiaFit: 92, easeOfApply: 54, relevance: 10 };
  const weighted =
    88 * RANK_WEIGHTS.achievability +
    92 * RANK_WEIGHTS.indiaFit +
    54 * RANK_WEIGHTS.easeOfApply +
    10 * RANK_WEIGHTS.relevance;

  assert.equal(combineRank(job), Math.round(weighted * OFF_TOPIC_DAMPING.multiplier));
});
