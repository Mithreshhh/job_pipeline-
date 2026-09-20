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
