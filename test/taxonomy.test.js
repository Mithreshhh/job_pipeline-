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
  detectWorkType,
  detectExperienceLevel,
} = require("../pipeline/normalize.js");

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

test("relevance puts the roles these students train for first", () => {
  // The board carries seven categories and a plain newest-first sort buried
  // the AI roles: Business and Tech are two thirds of the feed.
  const rank = (title, category, description = '') =>
    scoreRelevance(title, description, category);

  const claude = rank('AI Workflow Specialist – Claude Expert', 'AI-NonTech');
  const llm = rank('Senior LLM Engineer', 'AI-Tech');
  const ml = rank('Machine Learning Engineer', 'AI-Tech');
  const generalist = rank('AI Generalist', 'AI-NonTech');
  const automation = rank('Automation Specialist', 'Tech');
  const backend = rank('Backend Engineer', 'Tech');
  const editor = rank('Video Editor', 'Creative');
  const ops = rank('Operations Manager', 'Business');

  // A named tool in the title beats the category alone.
  assert.ok(claude > ml, 'a Claude role should outrank a generic ML one');
  assert.ok(llm > ml);
  assert.ok(generalist > automation);
  assert.ok(automation > backend, 'the generalist shape lifts a plain Tech role');
  assert.ok(backend > editor);
  assert.ok(editor > ops);

  // Everything stays inside the range the sort assumes.
  for (const score of [claude, llm, ml, generalist, automation, backend, editor, ops]) {
    assert.ok(score >= 0 && score <= 100, `${score} out of range`);
  }
});

test("relevance trusts the title far more than the description", () => {
  // Every company blurb mentions AI; what the employer called the job is the
  // evidence that means something.
  const inTitle = scoreRelevance('LLM Engineer', '', 'Tech');
  const inBody = scoreRelevance('Backend Engineer', 'we use LLMs internally', 'Tech');
  const neither = scoreRelevance('Backend Engineer', '', 'Tech');

  assert.ok(inTitle > inBody);
  assert.ok(inBody > neither);
});

test("relevance never depends on a literal control character", () => {
  // The word-boundary escapes in these patterns were once written as real
  // backspace bytes, so every pattern silently matched nothing and every job
  // scored its category base. The scores above would all still have passed
  // relative to each other, so this checks the absolute value.
  assert.equal(scoreRelevance('Claude Prompt Engineer', '', 'AI-Tech'), 85);
  assert.equal(scoreRelevance('Machine Learning Engineer', '', 'AI-Tech'), 60);
});
