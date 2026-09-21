/**
 * Tests for the shared vocabularies.
 *
 * The point of most of these is drift: taxonomy.js is copied into two
 * other repos and read by the classifiers here, so a category renamed in
 * one place and not the others is the failure mode worth guarding. The
 * classifier tests below pin both sides together - rename a value in the
 * taxonomy without renaming it in normalize.js and they fail.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");

const {
  ROLE_CATEGORIES,
  WORK_TYPES,
  EXPERIENCE_LEVELS,
  ROLE_CATEGORY_VALUES,
  WORK_TYPE_VALUES,
  EXPERIENCE_LEVEL_VALUES,
  normalizeWorkType,
  roleCategoryLabel,
  workTypeLabel,
  isRoleCategory,
  isWorkType,
} = require("../pipeline/taxonomy.js");

const {
  classifyRole,
  scoreRelevance,
  scoreRelevanceDetailed,
  detectWorkType,
  detectExperienceLevel,
} = require("../pipeline/normalize.js");

const SYLLABUS = require("../pipeline/syllabus.js");

test("every entry has a unique value and a label", () => {
  for (const entries of [ROLE_CATEGORIES, WORK_TYPES, EXPERIENCE_LEVELS]) {
    const values = entries.map((entry) => entry.value);
    assert.equal(new Set(values).size, values.length, "values must be unique");

    for (const entry of entries) {
      assert.ok(entry.label, `${entry.value} needs a label`);
    }
  }
});

test("normalizeWorkType folds the old skeo-lms enum onto our values", () => {
  // The four capitalised values are exactly the old JobPosting.type enum.
  assert.equal(normalizeWorkType("Full-time"), "full-time");
  assert.equal(normalizeWorkType("Part-time"), "part-time");
  assert.equal(normalizeWorkType("Internship"), "internship");
  assert.equal(normalizeWorkType("Contract"), "contract");
});

test("normalizeWorkType accepts the spellings the boards use", () => {
  assert.equal(normalizeWorkType("FULLTIME"), "full-time");
  assert.equal(normalizeWorkType("part_time"), "part-time");
  assert.equal(normalizeWorkType("  Permanent  "), "full-time");
  assert.equal(normalizeWorkType("Gig"), "freelance");
});

test("normalizeWorkType says unspecified rather than guessing", () => {
  // Defaulting an unknown value to full-time because it's the common case
  // would put wrong information on a listing.
  assert.equal(normalizeWorkType("seasonal"), "unspecified");
  assert.equal(normalizeWorkType(""), "unspecified");
  assert.equal(normalizeWorkType(null), "unspecified");
  assert.equal(normalizeWorkType(undefined), "unspecified");
  assert.equal(normalizeWorkType(42), "unspecified");
});

test("labels fall back to the raw value instead of hiding it", () => {
  // A listing tagged with something the table has never heard of is a bug
  // worth seeing on the page.
  assert.equal(roleCategoryLabel("AI-Tech"), "AI — Technical");
  assert.equal(roleCategoryLabel("Sasquatch"), "Sasquatch");
  assert.equal(workTypeLabel("freelance"), "Freelance");
  assert.equal(roleCategoryLabel(null), "");
});

test("classifyRole only ever returns values the taxonomy knows", () => {
  const titles = [
    "Machine Learning Engineer",
    "Data Annotator",
    "Video Editor",
    "Social Media Manager",
    "Content Writer",
    "Backend Engineer",
    "Operations Manager",
  ];

  for (const title of titles) {
    const category = classifyRole(title, "");
    assert.ok(
      isRoleCategory(category),
      `${title} produced ${category}, which is not in the taxonomy`,
    );
  }
});

test("every role category is reachable from a real job title", () => {
  // If a category exists in the table but nothing can be classified into
  // it, either the classifier lost a rule or the table has a dead entry.
  const byTitle = {
    "Machine Learning Engineer": "AI-Tech",
    "Data Annotator": "AI-NonTech",
    "Backend Engineer": "Tech",
    "Video Editor": "Creative",
    "Social Media Manager": "Marketing",
    "Content Writer": "Writing",
    "Operations Manager": "Business",
  };

  const reached = new Set();
  for (const [title, expected] of Object.entries(byTitle)) {
    assert.equal(classifyRole(title, ""), expected, title);
    reached.add(expected);
  }

  assert.deepEqual([...reached].sort(), [...ROLE_CATEGORY_VALUES].sort());
});

test("every work type is reachable, and all of them are in the taxonomy", () => {
  const cases = [
    [["Full-time", "Engineer"], "full-time"],
    [["Part-time", "Engineer"], "part-time"],
    [["Contract", "Engineer"], "contract"],
    [["", "Freelance Designer"], "freelance"],
    [["", "Marketing Intern"], "internship"],
    [["", "Engineer"], "unspecified"],
  ];

  const reached = new Set();
  for (const [[typeText, title], expected] of cases) {
    const workType = detectWorkType(typeText, title, "linkedin");
    assert.equal(workType, expected, `${title} / ${typeText}`);
    assert.ok(isWorkType(workType), `${workType} is not in the taxonomy`);
    reached.add(workType);
  }

  assert.deepEqual([...reached].sort(), [...WORK_TYPE_VALUES].sort());
});

test("every experience level is reachable, and all are in the taxonomy", () => {
  const cases = [
    [["Marketing Intern", ""], "internship"],
    [["Junior Developer", ""], "entry"],
    [["Engineer", "3 years of experience"], "mid"],
    [["Senior ML Engineer", ""], "senior"],
    [["Software Engineer", ""], "unspecified"],
  ];

  const reached = new Set();
  for (const [[title, description], expected] of cases) {
    const level = detectExperienceLevel(title, description);
    assert.equal(level, expected, title);
    reached.add(level);
  }

  assert.deepEqual([...reached].sort(), [...EXPERIENCE_LEVEL_VALUES].sort());
});

/* ------------------------------------------------------------------ *
 * Relevance: does the board rank by the Menler syllabus?
 * ------------------------------------------------------------------ */

const rank = (title, category, description = "", experienceLevel = "mid") =>
  scoreRelevance(title, description, category, { experienceLevel });

test("the syllabus outranks the acronym", () => {
  // The failure this replaced: scoring on "does the title say AI" put
  // Distinguished Engineer and VP roles on page one, while the Claude
  // automation role - the single closest match on the whole board - sat at
  // position 33. Both say AI. Only one is a job a graduate can do.
  const claudeOperator = rank("Claude MCP / AI Automation Developer", "AI-Tech");
  const distinguished = rank("VP - Distinguished Engineer of Generative AI", "AI-Tech", "", "senior");
  const researchScientist = rank("AI Research Scientist", "AI-Tech", "PhD required, PyTorch", "senior");

  assert.ok(
    claudeOperator > distinguished,
    `Claude operator (${claudeOperator}) must outrank Distinguished Engineer (${distinguished})`,
  );
  assert.ok(claudeOperator > researchScientist);
});

test("named syllabus tools beat generic AI words", () => {
  // "Generative AI" and "LLM" are roughly twenty times more common in titles
  // than anything the programme actually teaches, so they cannot be worth
  // the same.
  assert.ok(rank("Claude Prompt Engineer", "AI-Tech") > rank("Generative AI Engineer", "AI-Tech"));
  assert.ok(rank("n8n Automation Specialist", "Tech") > rank("LLM Engineer", "AI-Tech"));
});

test("the ordering follows the programme's own weeks", () => {
  // One representative job per Fellowship week, each of which should clear a
  // plain engineering role in the same category.
  const backend = rank("Backend Engineer", "Tech");

  const perWeek = {
    "W2 Claude mastery": rank("Claude Workflow Consultant", "AI-NonTech"),
    "W3 prompt + creative": rank("AI Prompt Designer", "AI-NonTech"),
    "W4 voice + automation": rank("Voice AI Agent Developer", "AI-Tech"),
    "W5 vibecoding": rank("No-Code AI Product Builder", "Tech"),
  };

  for (const [week, score] of Object.entries(perWeek)) {
    assert.ok(score > backend, `${week} scored ${score}, not above a plain backend role (${backend})`);
  }
});

test("seniority and specialist depth push a job down, but only so far", () => {
  const plain = rank("AI Engineer", "AI-Tech");

  assert.ok(rank("Head of AI", "AI-NonTech", "", "senior") < plain);
  assert.ok(rank("MLOps Engineer", "AI-Tech", "", "senior") < plain);
  assert.ok(rank("Principal Engineer, AI", "AI-Tech", "", "senior") < plain);

  // Capped: a posting that trips every warning still lands at zero rather
  // than going negative and breaking the sort.
  const worst = rank("VP, Distinguished Research Scientist", "AI-Tech", "PhD, CUDA, model pre-training", "senior");
  assert.ok(worst >= 0 && worst <= 100, `${worst} out of range`);
});

test("Art Director is a creative job, not an executive one", () => {
  // The bare word "director" is an org rank everywhere except the creative
  // trades, and the syllabus teaches creative direction in Fellowship W3.
  assert.ok(rank("Art Director", "Creative") > rank("Director of Sales", "Business"));
  assert.ok(rank("Creative Director", "Creative") > rank("Managing Director", "Business"));
});

test("a title counts for far more than a description", () => {
  // Almost every company blurb mentions AI somewhere; what the employer
  // chose to call the job is the evidence that means something.
  const inTitle = rank("Claude Automation Specialist", "Tech");
  const inBody = rank("Operations Associate", "Tech", "our team uses Claude and n8n daily");
  const neither = rank("Operations Associate", "Tech");

  assert.ok(inTitle > inBody);
  assert.ok(inBody > neither, "description evidence should still count for something");
});

test("entry-level roles beat identical senior ones", () => {
  // A graduate is looking for a first AI-adjacent job, so reachability is
  // part of what "relevant" means here.
  const junior = rank("AI Automation Specialist", "Tech", "", "entry");
  const senior = rank("AI Automation Specialist", "Tech", "", "senior");
  assert.ok(junior > senior);
});

test("the score reports what it matched", () => {
  // The stored matchedSkills are what makes a position on the board
  // explainable, and what lets a rescore work without the description -
  // which is never stored.
  const { relevance, matchedSkills } = scoreRelevanceDetailed(
    "AI Automation Specialist",
    "you will build in n8n and Zapier alongside Claude",
    "Tech",
    { experienceLevel: "mid" },
  );

  assert.ok(relevance > 0);
  assert.ok(matchedSkills.includes("claude"));
  assert.ok(matchedSkills.includes("n8n"));
  assert.ok(matchedSkills.includes("automation specialist"));
  assert.ok(matchedSkills.length <= 6, "capped so a card stays readable");
  assert.equal(new Set(matchedSkills).size, matchedSkills.length, "deduped");
});

test("every score lands inside the range the sort assumes", () => {
  const samples = [
    ["Claude MCP Automation Developer", "AI-Tech", "entry"],
    ["VP, Distinguished Research Scientist", "AI-Tech", "senior"],
    ["PDF to Word Re-Typing", "Writing", "unspecified"],
    ["Operations Manager", "Business", "mid"],
  ];

  for (const [title, category, level] of samples) {
    const score = rank(title, category, "", level);
    assert.ok(Number.isInteger(score), `${title} scored ${score}, not an integer`);
    assert.ok(score >= 0 && score <= 100, `${title} scored ${score}`);
  }
});

test("no syllabus pattern depends on a literal control character", () => {
  // The word-boundary escapes in the previous scoring list were once written
  // as real backspace bytes - a template literal turned every \b into 0x08 -
  // so every pattern silently matched nothing and every job scored its
  // category base. Relative ordering still looked correct, which is why this
  // checks the bytes rather than the results.
  const source = require("node:fs").readFileSync(
    require.resolve("../pipeline/syllabus.js"),
    "utf8",
  );

  // eslint-disable-next-line no-control-regex
  const control = source.match(/[\x00-\x08\x0b\x0c\x0e-\x1f]/);
  assert.equal(control, null, `pipeline/syllabus.js contains control byte ${control && control[0].charCodeAt(0)}`);

  const lists = [
    SYLLABUS.CORE,
    SYLLABUS.TOOLS,
    SYLLABUS.SHAPE,
    SYLLABUS.ADJACENT,
    SYLLABUS.SENIORITY,
    SYLLABUS.DEEP_SPECIALIST,
  ];

  for (const list of lists) {
    for (const [name, pattern] of list) {
      assert.ok(name && typeof name === "string", "every term needs a name to store");
      // eslint-disable-next-line no-control-regex
      assert.ok(!/[\x00-\x1f]/.test(pattern.source), `${name} has a control byte in its pattern`);
    }
  }

  // And the absolute values, because an ordering-only check passed happily
  // while every pattern was dead.
  assert.equal(scoreRelevance("Claude Prompt Engineer", "", "AI-Tech", { experienceLevel: "mid" }), 78);
  assert.equal(scoreRelevance("Software Engineer", "", "Tech", { experienceLevel: "mid" }), 14);
});

test("every term name is unique across the bands", () => {
  // Names are stored on the job and shown to students; the same word landing
  // in two bands would score twice and read like a duplicate.
  const names = [...SYLLABUS.CORE, ...SYLLABUS.TOOLS, ...SYLLABUS.SHAPE, ...SYLLABUS.ADJACENT].map(
    ([name]) => name,
  );
  assert.equal(new Set(names).size, names.length, "duplicate term name across bands");
});

test("every stored term name re-matches its own pattern", () => {
  // scripts/backfillRelevance.js rescores from the title plus the stored
  // matchedSkills, because the description is never kept. That only works if
  // each stored name is itself matchable - "cursor" would not have matched
  // /cursor\s*(ai|ide)/, so the term is stored as "cursor ai". Without this
  // check a rename here silently makes old rows unrescorable.
  for (const list of [SYLLABUS.CORE, SYLLABUS.TOOLS, SYLLABUS.SHAPE, SYLLABUS.ADJACENT]) {
    for (const [name, pattern] of list) {
      assert.ok(pattern.test(name), `"${name}" does not match its own pattern ${pattern}`);
    }
  }
});

test("a rescore from stored skills recovers the description's evidence", () => {
  // The daily run sees the description; a later rescore does not. What it has
  // instead is matchedSkills, and feeding those back in place of the
  // description has to land on the same score.
  const title = "Operations Associate";
  const description = "you will work in n8n and Zapier with Claude in the loop";

  const live = scoreRelevanceDetailed(title, description, "Tech", { experienceLevel: "mid" });
  const rescored = scoreRelevanceDetailed(title, live.matchedSkills.join(" "), "Tech", {
    experienceLevel: "mid",
  });

  assert.equal(rescored.relevance, live.relevance);
  assert.deepEqual(rescored.matchedSkills, live.matchedSkills);
});

test("one signal is not counted twice under two names", () => {
  // "Claude Code" matches both `claude` and `claude code`. That is one piece
  // of evidence, and scoring it twice would put a job naming Claude Code
  // above one naming Claude and something genuinely different.
  const { matchedSkills } = scoreRelevanceDetailed("Claude Code Engineer", "", "AI-Tech", {
    experienceLevel: "mid",
  });

  assert.ok(matchedSkills.includes("claude code"), "keeps the specific term");
  assert.ok(!matchedSkills.includes("claude"), "drops the one contained in it");
});
