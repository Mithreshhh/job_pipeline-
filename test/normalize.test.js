/**
 * Tests for the classification logic.
 *
 * Nearly every case here is a bug that actually shipped and had to be found
 * by eyeballing live output. They're written down so the next change to a
 * keyword list can't quietly bring them back.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");

const {
  classifyRole,
  detectWorkType,
  detectExperienceLevel,
  detectCountry,
  stripHtml,
  toIsoDate,
  normalizeEntry,
} = require("../pipeline/normalize.js");
const { JOB_SCHEMA_FIELDS } = require("../pipeline/schema.js");

test("classifyRole: AI roles split tech from non-tech", () => {
  assert.equal(classifyRole("Machine Learning Engineer", ""), "AI-Tech");
  assert.equal(classifyRole("MLOps Engineer", ""), "AI-Tech");
  assert.equal(classifyRole("AI Content Writer", ""), "AI-NonTech");
  assert.equal(classifyRole("Data Annotator", ""), "AI-NonTech");
  assert.equal(classifyRole("AI Policy Analyst", ""), "AI-NonTech");
});

test("classifyRole: city names must not look like AI keywords", () => {
  // "Mumbai marketing" contains the substring "ai marketing", and
  // "Dubai operations" contains "ai operations". Word boundaries only.
  assert.equal(classifyRole("Mumbai marketing lead", ""), "Marketing");
  assert.equal(classifyRole("Chennai analyst", ""), "Business");
  assert.equal(classifyRole("Dubai operations coordinator", ""), "Business");
});

test("classifyRole: company boilerplate must not create AI roles", () => {
  const boilerplate =
    "We are committed to responsible AI and our AI governance framework guides us.";
  assert.equal(classifyRole("Registered Nurse", boilerplate), null);
  assert.equal(classifyRole("Line Cook", boilerplate), null);
});

test("classifyRole: an engineering title beats a non-tech keyword", () => {
  assert.equal(classifyRole("Senior Software Engineer, AI Operations", ""), "AI-Tech");
  assert.equal(classifyRole("AI Operations Specialist", ""), "AI-NonTech");
});

test("classifyRole: category priority order", () => {
  // "Video Editor" must reach Creative before Writing claims "editor",
  // and "Data Analyst" must reach Tech before Business claims "analyst".
  assert.equal(classifyRole("Video Editor", ""), "Creative");
  assert.equal(classifyRole("Editor", ""), "Writing");
  assert.equal(classifyRole("Data Analyst", ""), "Tech");
  assert.equal(classifyRole("Financial Analyst", ""), "Business");
  assert.equal(classifyRole("Social Media Manager", ""), "Marketing");
  assert.equal(classifyRole("Graphic Designer", ""), "Creative");
});

test("classifyRole: broad pass catches titles no keyword list predicts", () => {
  assert.equal(classifyRole("AI Infrastructure Engineer, Serving Platform", ""), "AI-Tech");
  assert.equal(classifyRole("Forward Deployed Engineer, Gen AI", ""), "AI-Tech");
  assert.equal(classifyRole("AI Advisory Principal", ""), "AI-NonTech");
  assert.equal(classifyRole("Engineering Manager, Infrastructure", ""), "Tech");
  assert.equal(classifyRole("Engagement Manager, Public Sector", ""), "Business");
});

test("classifyRole: unrelated jobs are still excluded", () => {
  for (const title of ["Registered Nurse", "Truck Driver", "Line Cook", "Security Guard"]) {
    assert.equal(classifyRole(title, ""), null, `${title} should not be kept`);
  }
});

test("classifyRole: gig mode uses task language, job boards do not", () => {
  // Clients write "build me an AI chatbot", never "Machine Learning Engineer".
  assert.equal(classifyRole("Build me an AI chatbot", "", { isGig: true }), "AI-Tech");
  assert.equal(classifyRole("Fine-tune an LLM on my data", "", { isGig: true }), "AI-Tech");
  assert.equal(classifyRole("Write blog posts using ChatGPT", "", { isGig: true }), "AI-NonTech");
  assert.equal(classifyRole("Need a logo designed", "", { isGig: true }), "Creative");

  // The gig vocabulary must not leak into job-board matching, where bare
  // "machine learning" appears in half of all job descriptions.
  assert.equal(classifyRole("Office Administrator", "we use machine learning here"), null);
  assert.equal(
    classifyRole("Office Administrator", "we use machine learning here", { isGig: true }),
    "AI-Tech"
  );
});

test("classifyRole: job-board descriptions still match specific tech titles", () => {
  // The full phrase, unlike bare "machine learning", is specific enough to
  // trust in prose.
  assert.equal(classifyRole("Office Administrator", "we are hiring a data scientist"), "AI-Tech");
});

test("detectWorkType: title priority beats a contradicting source tag", () => {
  // RemoteOK tags some freelance posts "full-time".
  assert.equal(detectWorkType("full-time", "Freelance Designer", "remoteok"), "freelance");
  assert.equal(detectWorkType("Full-Time", "Marketing Intern", "remoteok"), "internship");
  assert.equal(detectWorkType("fulltime", "Data Scientist", "remoteok"), "full-time");
  assert.equal(detectWorkType("Contractor", "AI Engineer", "ashby"), "contract");
  assert.equal(detectWorkType("", "Data Scientist", "jobicy"), "unspecified");
});

test("detectWorkType: freelance marketplaces are freelance by definition", () => {
  assert.equal(detectWorkType("fixed", "Anything at all", "freelancer"), "freelance");
});

test("detectExperienceLevel: explicit year ranges bucket by lower bound", () => {
  assert.equal(detectExperienceLevel("Data Scientist", "0-1 Yrs"), "entry");
  assert.equal(detectExperienceLevel("Machine Learning Engineer", "2-4 Yrs"), "mid");
  assert.equal(detectExperienceLevel("AI Engineer", "5-10 Yrs"), "senior");
  assert.equal(detectExperienceLevel("ML Engineer", "8+ years"), "senior");
});

test("detectExperienceLevel: titles outrank description prose", () => {
  // A stray "graduate" in a JD used to outrank "Lead" in the title.
  assert.equal(detectExperienceLevel("Custom Software Engineering Lead", "graduate degree"), "senior");
  assert.equal(detectExperienceLevel("Junior Data Scientist", ""), "entry");
  assert.equal(detectExperienceLevel("ML Intern", ""), "internship");
});

test("detectExperienceLevel: org-chart words in prose are not seniority", () => {
  // "you will lead a team of architects" does not make a job senior.
  assert.equal(detectExperienceLevel("Data Engineer", "you will lead a team of architects"), "unspecified");
  // "any graduate may apply" is an Indian phrasing for "has a degree".
  assert.equal(detectExperienceLevel("Data Scientist", "any graduate may apply"), "unspecified");
  assert.equal(detectExperienceLevel("Data Scientist", ""), "unspecified");
});

test("detectCountry: reads the location, not prose", () => {
  assert.equal(detectCountry({ locationText: "MH, IN", defaultCountry: "International" }), "India");
  assert.equal(detectCountry({ locationText: "Bengaluru, KA", defaultCountry: "International" }), "India");
  assert.equal(detectCountry({ locationText: "Mumbai, India", defaultCountry: "International" }), "India");
  // ", IN" is a country code, so it must be anchored - otherwise the word
  // "in" inside ordinary text matched and US jobs became Indian ones.
  assert.equal(detectCountry({ locationText: "Atlanta, GA, US", defaultCountry: "International" }), "International");
  assert.equal(detectCountry({ locationText: "works closely with teams, in the US", defaultCountry: "International" }), "International");
  assert.equal(detectCountry({ locationText: "Remote", defaultCountry: "India" }), "India");
});

test("toIsoDate: accepts epoch seconds, epoch millis and ISO strings", () => {
  assert.equal(toIsoDate(1789562667), "2026-09-16T12:44:27.000Z");
  assert.equal(toIsoDate(1789562667000), "2026-09-16T12:44:27.000Z");
  assert.equal(toIsoDate("2026-09-17T06:50:36+00:00"), "2026-09-17T06:50:36.000Z");
  assert.equal(toIsoDate(null), null);
  assert.equal(toIsoDate(""), null);
  assert.equal(toIsoDate("not a date"), null);
});

test("stripHtml: removes markup and collapses whitespace", () => {
  assert.equal(stripHtml("<p>Hello&nbsp;<b>world</b></p>"), "Hello world");
  assert.equal(stripHtml(null), "");
});

test("normalizeEntry: jobspy records report the board, not the tool", () => {
  // "jobspy" is the library; Indeed and LinkedIn are the actual sources.
  // Without this, sources: ["indeed", "linkedin"] is impossible.
  const { jobs } = normalizeEntry({
    source: "jobspy",
    jobs: [
      { site: "indeed", title: "Data Scientist", company: "A", location: "KA, IN", job_url: "u1", description: "" },
      { site: "linkedin", title: "ML Engineer", company: "B", location: "Pune", job_url: "u2", description: "" },
    ],
  });

  assert.deepEqual(jobs.map((j) => j.source), ["indeed", "linkedin"]);
  assert.deepEqual(jobs.map((j) => j.country), ["India", "India"]);
});

test("normalizeEntry: international jobspy wrappers are not tagged India", () => {
  // jobspy-indeed and jobspy share a mapper; the country default has to key
  // off the wrapper name, not the mapper name.
  const { jobs } = normalizeEntry({
    source: "jobspy-indeed",
    jobs: [{ site: "indeed", title: "Data Scientist", company: "A", location: "Austin, TX, US", job_url: "u", description: "" }],
  });

  assert.equal(jobs[0].country, "International");
});

test("normalizeEntry: the board's company name is used when the job lacks one", () => {
  const { jobs } = normalizeEntry({
    source: "ashby",
    company: "mercor",
    jobs: [{ title: "AI Trainer", location: "Remote", employmentType: "Contract", jobUrl: "https://x/y", publishedAt: "2026-09-18T00:00:00Z" }],
  });

  assert.equal(jobs[0].company, "mercor");
  assert.equal(jobs[0].roleCategory, "AI-NonTech");
  assert.equal(jobs[0].workType, "contract");
});

test("normalizeEntry: output always matches the shared schema exactly", () => {
  const { jobs, excluded } = normalizeEntry({
    source: "remoteok",
    jobs: [
      { position: "AI Engineer", company: "A", url: "u1", date: "2026-09-16T12:44:27+00:00", description: "" },
      { position: "Line Cook", company: "B", url: "u2", date: "2026-09-16T12:44:27+00:00", description: "" },
    ],
  });

  assert.equal(jobs.length, 1);
  assert.equal(excluded.length, 1);
  assert.equal(excluded[0].roleCategory, null);

  for (const job of [...jobs, ...excluded]) {
    assert.deepEqual(Object.keys(job).sort(), [...JOB_SCHEMA_FIELDS].sort());
  }
});

test("normalizeEntry: an unknown source fails loudly", () => {
  assert.throws(
    () => normalizeEntry({ source: "not-a-real-source", jobs: [{ title: "x" }] }),
    /No mapper for source/
  );
});
