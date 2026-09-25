/**
 * Tests for the domain classifier.
 *
 * First match wins, so almost every failure worth catching is an ordering
 * one: a title that belongs to one domain being claimed by an earlier rule
 * for a word it happens to contain. Each case below is a title shape seen in
 * the stored data.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { classifyDomain, RULES, CATEGORY_FALLBACK } = require("../pipeline/domain.js");
const { DOMAINS, DOMAIN_VALUES, ROLE_CATEGORY_VALUES, isDomain } = require("../pipeline/taxonomy.js");
const { buildJobQuery } = require("../db/readJobs.js");

const expectDomain = (cases) => {
  for (const [title, category, expected] of cases) {
    assert.equal(classifyDomain(title, category), expected, `"${title}"`);
  }
};

test("there are between eight and twelve domains, each with a label", () => {
  assert.ok(DOMAINS.length >= 8 && DOMAINS.length <= 12, `${DOMAINS.length} domains`);
  assert.equal(new Set(DOMAIN_VALUES).size, DOMAIN_VALUES.length, "unique values");
  for (const { value, label } of DOMAINS) assert.ok(label, `${value} needs a label`);
});

test("every domain is reachable from a real title", () => {
  // A domain no title can reach is an empty filter on the board.
  const reached = new Set(
    [
      ["Machine Learning Engineer", "AI-Tech"],
      ["AI Generalist", "AI-NonTech"],
      ["Full Stack Developer", "Tech"],
      ["Data Analyst", "Tech"],
      ["Associate Product Manager", "Business"],
      ["Founder's Office Associate", "Business"],
      ["UI/UX Designer", "Creative"],
      ["Digital Marketing Executive", "Marketing"],
      ["Content Writer", "Writing"],
      ["Business Development Executive", "Business"],
      ["HR Recruiter", "Business"],
    ].map(([title, category]) => classifyDomain(title, category)),
  );

  assert.deepEqual([...reached].sort(), [...DOMAIN_VALUES].sort());
});

test("only ever returns values the taxonomy knows", () => {
  for (const [domain] of RULES) assert.ok(isDomain(domain), `${domain} is not in DOMAINS`);
  for (const domain of Object.values(CATEGORY_FALLBACK)) assert.ok(isDomain(domain), domain);

  for (const title of ["", null, undefined, "???", "Lorem ipsum"]) {
    assert.ok(isDomain(classifyDomain(title, null)), String(title));
  }
});

test("every roleCategory has a fallback, so no job is unreachable", () => {
  // A title nothing matched still has to land somewhere a filter can find.
  for (const category of ROLE_CATEGORY_VALUES) {
    assert.ok(CATEGORY_FALLBACK[category], `${category} has no fallback domain`);
  }
});

test("Founder's Office claims its titles before anything else can", () => {
  expectDomain([
    ["Founder's Office Associate", "Business", "founders-office"],
    ["Founders Office - Growth", "Business", "founders-office"],
    ["Chief of Staff (m/w/d)", "Business", "founders-office"],
    ["Strategy & Operations Lead", "Business", "founders-office"],
    ["BizOps Analyst", "Business", "founders-office"],
    ["Business Operations Graduate", "Business", "founders-office"],
    ["Management Consultant", "Business", "founders-office"],
  ]);
});

test("the AI generalist work is not lost to Software or Content", () => {
  // These contain "Engineer", "Content" and "Automation", which three later
  // rules would otherwise claim.
  expectDomain([
    ["Prompt Engineer", "AI-Tech", "ai-generalist"],
    ["AI Consultant", "AI-NonTech", "ai-generalist"],
    ["Automation Specialist", "Tech", "ai-generalist"],
    ["Workflow Automation Engineer", "Tech", "ai-generalist"],
    ["No-Code Developer", "Tech", "ai-generalist"],
    ["Data Annotation Specialist", "AI-NonTech", "ai-generalist"],
    ["AI Enablement Lead", "AI-NonTech", "ai-generalist"],
    ["Forward Deployed Engineer", "AI-Tech", "ai-generalist"],
  ]);
});

test("QA automation is software testing, not the generalist domain", () => {
  expectDomain([
    ["QA Automation Engineer", "Tech", "software"],
    ["Test Automation Engineer", "Tech", "software"],
  ]);
});

test("design titles beat the Product and Content rules", () => {
  expectDomain([
    ["Product Designer", "Creative", "design"],
    ["Video Editor", "Creative", "design"],
    ["Motion Graphics Designer", "Creative", "design"],
    ["Art Director", "Creative", "design"],
  ]);
});

test("function beats an AI prefix outside engineering", () => {
  // A student browsing Product wants the AI Product Manager role; an AI
  // Content Creator is doing content work. AI-ness still lifts them in the
  // ranking, through relevance.
  expectDomain([
    ["AI Product Manager", "AI-NonTech", "product"],
    ["AI Content Creator", "AI-NonTech", "content"],
    ["Product Marketing Manager", "Marketing", "marketing"],
  ]);
});

test("ML and data science are AI engineering, not generic data or software", () => {
  expectDomain([
    ["Data Scientist", "AI-Tech", "ai-ml"],
    ["AI Software Engineer", "AI-Tech", "ai-ml"],
    ["MLOps Engineer", "AI-Tech", "ai-ml"],
    ["Generative AI Developer", "AI-Tech", "ai-ml"],
  ]);
});

test("sales titles beat the generic Engineer rule, but Salesforce does not", () => {
  expectDomain([
    ["Sales Engineer", "Tech", "sales"],
    ["Customer Success Engineer", "Tech", "sales"],
    ["Client Success Manager", "Business", "sales"],
    ["Work-at-Home Contact Centre Associate", "Business", "sales"],
    ["Senior Manager, Velocity Account Executives, EMEA", "Business", "sales"],
    // \bsales\b does not match inside "Salesforce".
    ["Salesforce Developer", "Tech", "software"],
  ]);
});

test("a bare Consultant or Analyst is filed late, after anything specific", () => {
  // Measured: ~480 stored titles are a bare consultant, ~475 a bare analyst.
  // Checked early, those words would have taken AI Consultant from the AI
  // domain and SAP Consultant from Software.
  expectDomain([
    ["Consultant Public Sector", "Business", "founders-office"],
    ["SAP Consultant", "Business", "software"],
    ["AI Consultant", "AI-NonTech", "ai-generalist"],
    ["Tax Consultant", "Business", "operations"],
    ["Billing Technical Analyst I", "Business", "data"],
    ["Financial Analyst", "Business", "operations"],
  ]);
});

test("nothing matched falls back by category", () => {
  assert.equal(classifyDomain("Kembangkan Blog Pribadi", "Marketing"), "marketing");
  assert.equal(classifyDomain("Lorem ipsum", "Creative"), "design");
  assert.equal(classifyDomain("Lorem ipsum", "AI-NonTech"), "ai-generalist");
  assert.equal(classifyDomain("Lorem ipsum", null), "operations");
});

test("the board filters by domain, and the filter is whitelisted", () => {
  assert.deepEqual(buildJobQuery({ domain: "product,founders-office" }).domain, {
    $in: ["product", "founders-office"],
  });

  // Unknown values drop out rather than narrowing the board to nothing.
  assert.deepEqual(buildJobQuery({ domain: "product,nonsense" }).domain, { $in: ["product"] });

  // ?domain[$ne]=x arrives as an object and must never reach Mongo.
  assert.equal(buildJobQuery({ domain: { $ne: "x" } }).domain, undefined);
});

test("no domain pattern depends on a literal control character", () => {
  // A backslash-b through a template literal is the backspace byte, not a
  // word boundary. That once disabled an entire scoring list in this repo
  // while every ordering test passed.
  const source = require("node:fs").readFileSync(require.resolve("../pipeline/domain.js"), "utf8");
  // eslint-disable-next-line no-control-regex
  const control = source.match(/[\x00-\x08\x0b\x0c\x0e-\x1f]/);
  assert.equal(control, null, `domain.js holds control byte ${control && control[0].charCodeAt(0)}`);
});

test("the four mistakes the live board surfaced stay fixed", () => {
  // Each of these sat at the top of its domain on the real board the first
  // time the filters were run against it.
  expectDomain([
    // The content rule knew "strategist" but not "strategy", so the late
    // generic strategy rule filed this under Founder's Office.
    ["Content Strategy Intern", "Writing", "content"],
    // "product operations" pulled an ML intern into Product.
    ["PhD Intern, Machine Learning: MSI, Product Operation", "AI-Tech", "ai-ml"],
    // Industrial automation - PLCs, SCADA - is not AI generalist work.
    ["Automation Engineer", "Tech", "software"],
    // ...but with a qualifier it is.
    ["AI Automation Engineer", "AI-Tech", "ai-generalist"],
    ["Workflow Automation Engineer", "Tech", "ai-generalist"],
    // The early Founder's Office rule matched "Strategy Intern" before the
    // content rule was reached, so a function word in front now excludes it.
    ["Brand Strategy Manager", "Marketing", "marketing"],
    ["Strategy Intern", "Business", "founders-office"],
  ]);
});
