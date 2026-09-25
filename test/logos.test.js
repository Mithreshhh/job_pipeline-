/**
 * Company logos.
 *
 * Five of the eleven sources ship a logo URL and six ship nothing, so the
 * behaviour worth pinning is that the five are read correctly and that a
 * hostile or missing value never reaches an <img src> on either board.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { normalizeEntry, safeLogoUrl, ambitionBoxLogo } = require("../pipeline/normalize.js");

const logoOf = (source, raw) => {
  const { jobs } = normalizeEntry({ source, jobs: [raw] }, { fetchedAt: "2026-09-25T00:00:00Z" });
  return jobs[0] ? jobs[0].companyLogo : undefined;
};

test("each source that ships a logo has it read", () => {
  assert.equal(
    logoOf("jobspy", {
      title: "AI Engineer",
      company: "X",
      job_url: "https://a.test/1",
      site: "indeed",
      company_logo: "https://d2q79iu7y748jz.cloudfront.net/s/_squarelogo/256x256/abc",
    }),
    "https://d2q79iu7y748jz.cloudfront.net/s/_squarelogo/256x256/abc",
  );

  assert.equal(
    logoOf("jobicy", {
      jobTitle: "AI Engineer",
      companyName: "X",
      url: "https://a.test/2",
      companyLogo: "https://jobicy.com/data/logo.jpeg",
    }),
    "https://jobicy.com/data/logo.jpeg",
  );

  assert.equal(
    logoOf("himalayas", {
      title: "AI Engineer",
      companyName: "X",
      applicationLink: "https://a.test/3",
      companyLogo: "https://himalayas.app/logo.png",
    }),
    "https://himalayas.app/logo.png",
  );

  assert.equal(
    logoOf("instahyre", {
      title: "AI Engineer",
      public_url: "https://a.test/4",
      employer: { company_name: "X", profile_image_src: "https://media.instahyre.com/x.webp" },
    }),
    "https://media.instahyre.com/x.webp",
  );
});

test("AmbitionBox gives a slug, so the URL is built from its own pattern", () => {
  // Verified against a live response: .jpg resolves, .png 404s.
  assert.equal(
    ambitionBoxLogo("ford-motor"),
    "https://static.ambitionbox.com/alpha/company/photos/logos/ford-motor.jpg",
  );

  assert.equal(
    logoOf("ambitionbox", { title: "AI Engineer", jdpUrl: "/j/1", companyLogo: "tata-consultancy" }),
    "https://static.ambitionbox.com/alpha/company/photos/logos/tata-consultancy.jpg",
  );

  for (const empty of [null, undefined, "", "   ", 42]) {
    assert.equal(ambitionBoxLogo(empty), null, String(empty));
  }
});

test("the sources that ship no logo return null rather than something invented", () => {
  // Greenhouse, Lever, Ashby, Arbeitnow and WeWorkRemotely have no such field.
  // Guessing a favicon from the apply URL would give boards.greenhouse.io,
  // which is the ATS, not the employer.
  assert.equal(
    logoOf("greenhouse", {
      title: "AI Engineer",
      company_name: "Groww",
      absolute_url: "https://boards.greenhouse.io/groww/jobs/1",
      location: { name: "Bengaluru" },
    }),
    null,
  );

  assert.equal(
    logoOf("lever", { text: "AI Engineer", hostedUrl: "https://jobs.lever.co/meesho/1", categories: {} }),
    null,
  );
});

test("only http(s) URLs survive, because this ends up in an img src", () => {
  // These are third-party strings rendered on both LMS boards.
  for (const hostile of [
    "javascript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD4=",
    "vbscript:msgbox",
    "  javascript:alert(1)  ",
    "//evil.test/x.png",
    "/relative/path.png",
    "",
    null,
    undefined,
    42,
    {},
  ]) {
    assert.equal(safeLogoUrl(hostile), null, JSON.stringify(hostile));
  }

  assert.equal(safeLogoUrl("https://cdn.test/a.png"), "https://cdn.test/a.png");
  assert.equal(safeLogoUrl("http://cdn.test/a.png"), "http://cdn.test/a.png");
  assert.equal(safeLogoUrl("  https://cdn.test/a.png  "), "https://cdn.test/a.png");
});

test("a hostile logo value is dropped without dropping the job", () => {
  const { jobs } = normalizeEntry(
    {
      source: "jobspy",
      jobs: [
        {
          title: "AI Engineer",
          company: "X",
          job_url: "https://a.test/1",
          site: "indeed",
          company_logo: "javascript:alert(1)",
        },
      ],
    },
    { fetchedAt: "2026-09-25T00:00:00Z" },
  );

  assert.equal(jobs.length, 1, "the listing is still worth showing");
  assert.equal(jobs[0].companyLogo, null);
});

test("companyLogo is on the shared schema, so every job carries the key", () => {
  const { createJob } = require("../pipeline/schema.js");
  assert.ok("companyLogo" in createJob());
  assert.equal(createJob().companyLogo, null);
});
