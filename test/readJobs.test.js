/**
 * Tests for the board's query, which is the part of the read path the two
 * LMSes copy. Everything here is pure query building - no database - so
 * `npm test` stays dependency-free.
 *
 * The filter values these functions receive come straight off a URL query
 * string, so several of these are about what happens when that string is
 * hostile rather than merely wrong.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");

const {
  buildJobQuery,
  buildJobSort,
  buildPagination,
  freshnessFilter,
  FRESH_DAYS,
  MAX_LIMIT,
  DEFAULT_LIMIT,
} = require("../db/readJobs.js");

/** The window is time-based, so tests compare the rest of the query to it. */
const withoutWindow = (query) => {
  const { $and, ...rest } = query;
  return rest;
};

test("a bare query still scopes to live listings", () => {
  // Nobody should have to remember to add isActive; forgetting it would
  // put retired links in front of a student.
  assert.deepEqual(withoutWindow(buildJobQuery()), { isActive: true });
  assert.deepEqual(withoutWindow(buildJobQuery({})), { isActive: true });
});

test("the ten-day window is on by default and can be widened or waived", () => {
  // The rolling board: a job shows for its first FRESH_DAYS days and then
  // falls off the back, so day 11 drops what arrived on day 1.
  assert.equal(FRESH_DAYS, 10);

  const cutoffOf = (query) => query.$and[0].$or[0].postedAt.$gte.getTime();
  const now = Date.now();

  const byDefault = cutoffOf(buildJobQuery({}));
  const wider = cutoffOf(buildJobQuery({ freshDays: 30 }));

  // Roughly, because the two queries are built microseconds apart.
  assert.ok(Math.abs(now - byDefault - 10 * 86400000) < 5000);
  assert.ok(wider < byDefault, "a wider window reaches further back");

  // freshDays: 0 is the admin view - everything ever stored.
  assert.ok(!("$and" in buildJobQuery({ freshDays: 0 })));
});

test("the window falls back to first-seen only where there is no posting date", () => {
  // 99.9% of stored jobs carry a real postedAt, so the fallback is for the
  // handful whose source gave none - not the common path.
  const [byPosted, byFetched] = freshnessFilter(10).$or;

  assert.ok("postedAt" in byPosted);
  assert.equal(byFetched.postedAt, null);
  assert.ok("fetchedAt" in byFetched);
});

test("includeInactive is the only way to see retired listings", () => {
  const query = buildJobQuery({ includeInactive: true });
  assert.ok(!("isActive" in query));
});

test("facets accept repeated params, comma lists and single values", () => {
  assert.deepEqual(buildJobQuery({ category: "AI-Tech" }).roleCategory, {
    $in: ["AI-Tech"],
  });
  assert.deepEqual(buildJobQuery({ category: "AI-Tech,Tech" }).roleCategory, {
    $in: ["AI-Tech", "Tech"],
  });
  assert.deepEqual(
    buildJobQuery({ category: ["AI-Tech", "Creative"] }).roleCategory,
    { $in: ["AI-Tech", "Creative"] },
  );
});

test("unknown facet values are dropped, not passed through", () => {
  // A typo should narrow nothing rather than silently return zero rows.
  const query = buildJobQuery({ category: "AI-Tech,Nonsense", workType: "seasonal" });
  assert.deepEqual(query.roleCategory, { $in: ["AI-Tech"] });
  assert.ok(!("workType" in query));
});

test("duplicate values collapse", () => {
  const query = buildJobQuery({ category: "Tech,Tech,Tech" });
  assert.deepEqual(query.roleCategory, { $in: ["Tech"] });
});

test("a query string cannot smuggle a Mongo operator in", () => {
  // ?category[$ne]=x arrives as an object. Whitelisting against the
  // taxonomy is what stops it reaching the driver.
  const query = buildJobQuery({
    category: { $ne: "AI-Tech" },
    workType: { $gt: "" },
    country: { $ne: null },
    remote: { $ne: false },
  });

  assert.deepEqual(withoutWindow(query), { isActive: true });
});

test("remote distinguishes 'not asked' from 'asked for false'", () => {
  assert.equal(buildJobQuery({ remote: "true" }).isRemote, true);
  assert.equal(buildJobQuery({ remote: "false" }).isRemote, false);
  assert.equal(buildJobQuery({ remote: true }).isRemote, true);
  assert.ok(!("isRemote" in buildJobQuery({ remote: "maybe" })));
  assert.ok(!("isRemote" in buildJobQuery({})));
});

test("country is length-capped rather than whitelisted", () => {
  // It has no fixed list - it's whatever detectCountry read off a location.
  assert.equal(buildJobQuery({ country: "India" }).country, "India");
  assert.equal(buildJobQuery({ country: "   " }).country, undefined);
  assert.equal(buildJobQuery({ country: "x".repeat(200) }).country.length, 60);
});

test("search becomes a text query and takes over the sort", () => {
  assert.deepEqual(buildJobQuery({ search: "prompt engineer" }).$text, {
    $search: "prompt engineer",
  });

  // Relevance first: searching "prompt engineer" should surface prompt
  // engineering roles, not whatever was posted most recently.
  assert.deepEqual(buildJobSort({ search: "prompt engineer" }), {
    score: { $meta: "textScore" },
    postedAt: -1,
  });
  // Without a search term the board leads on rankScore: reachable first,
  // then India, then easy to apply, then on-topic.
  assert.deepEqual(buildJobSort({}), { rankScore: -1, postedAt: -1 });
  assert.deepEqual(buildJobSort({ search: "   " }), { rankScore: -1, postedAt: -1 });
});

test("the dashboard can still ask for syllabus relevance alone", () => {
  // Useful for checking the syllabus scoring on its own, without the
  // reachability weights sitting on top of it.
  assert.deepEqual(buildJobSort({ sort: "relevance" }), { relevance: -1, postedAt: -1 });

  // Anything else falls back to the board's own order rather than being
  // passed through to Mongo as a field name.
  assert.deepEqual(buildJobSort({ sort: "; drop" }), { rankScore: -1, postedAt: -1 });
  assert.deepEqual(buildJobSort({ sort: { $ne: 1 } }), { rankScore: -1, postedAt: -1 });
});

test("a search term overrides the ranking", () => {
  // The reader has said what they want. Ranking AI roles above their own
  // query would be the board arguing with them.
  const sort = buildJobSort({ search: "video editor" });

  assert.ok(!("relevance" in sort));
  assert.ok(!("rankScore" in sort));
  assert.deepEqual(sort, { score: { $meta: "textScore" }, postedAt: -1 });
});

test("pagination clamps so nobody can ask for all 9,800 rows", () => {
  assert.deepEqual(buildPagination({ page: "3", limit: "10" }), {
    page: 3,
    limit: 10,
    skip: 20,
  });
  assert.equal(buildPagination({ limit: "5000" }).limit, MAX_LIMIT);
  assert.equal(buildPagination({}).limit, DEFAULT_LIMIT);
});

test("nonsense pagination falls back instead of producing NaN", () => {
  // skip: NaN throws at the driver; page 0 would give a negative skip.
  for (const params of [{ page: "0" }, { page: "-4" }, { page: "abc" }, { page: null }]) {
    const { page, skip } = buildPagination(params);
    assert.equal(page, 1, JSON.stringify(params));
    assert.equal(skip, 0);
  }

  assert.equal(buildPagination({ limit: "0" }).limit, DEFAULT_LIMIT);
  assert.equal(buildPagination({ limit: "-10" }).limit, DEFAULT_LIMIT);
});
