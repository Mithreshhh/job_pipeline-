/**
 * The vocabularies a job is tagged with, their display labels, and the
 * aliases that map other systems' spellings onto ours.
 *
 * This file is the contract between the pipeline and everything that reads
 * from it. The classifiers in normalize.js produce these values; the job
 * boards in skeo-lms and menler-lms filter and label by them. When a
 * category is added or renamed, it is added or renamed here first.
 *
 * Why the pipeline's lowercase slugs are canonical rather than the LMS's
 * older `Full-time | Part-time | Internship | Contract` enum: that enum
 * cannot express `freelance` (around 550 listings a run) or `unspecified`
 * (most listings, since a lot of boards simply don't say). Widening the
 * pipeline to fit the enum would mean throwing away tags we already have,
 * so the LMS migrates its four values onto these instead - see
 * LEGACY_WORK_TYPE_ALIASES.
 *
 * Stored values are slugs, not labels. Labels change when someone dislikes
 * the wording; rewriting 9,800 rows because of a copy edit is not a thing
 * that should be possible.
 */

"use strict";

/**
 * What kind of work it is. Order is the order a board should offer them in:
 * the AI categories first, since that is what these students are training
 * for, then the rest by how many listings land in them.
 */
const ROLE_CATEGORIES = [
  {
    value: "AI-Tech",
    label: "AI — Technical",
    blurb: "Building AI systems: ML, MLOps, research, applied engineering.",
  },
  {
    value: "AI-NonTech",
    label: "AI — Non-technical",
    blurb: "Working on AI without writing the models: annotation, evaluation, policy, AI content.",
  },
  {
    value: "Tech",
    label: "Tech",
    blurb: "Software, data and infrastructure roles that aren't AI-specific.",
  },
  {
    value: "Creative",
    label: "Creative",
    blurb: "Design, video, motion, photography.",
  },
  {
    value: "Marketing",
    label: "Marketing",
    blurb: "Growth, social, brand, SEO, communications.",
  },
  {
    value: "Writing",
    label: "Writing",
    blurb: "Content, copy, editorial.",
  },
  {
    value: "Business",
    label: "Business",
    blurb: "Operations, sales, strategy, finance, people.",
  },
];

/**
 * How the work is engaged. Deliberately independent of ROLE_CATEGORIES,
 * because a freelance gig can be technical or not and so can a staff job.
 *
 * `unspecified` is a real answer, not a gap to be filled in. Most boards
 * never state the engagement type, and guessing "full-time" because it is
 * the common case would put wrong information in front of a student.
 */
const WORK_TYPES = [
  { value: "full-time", label: "Full-time" },
  { value: "part-time", label: "Part-time" },
  { value: "contract", label: "Contract" },
  { value: "freelance", label: "Freelance" },
  { value: "internship", label: "Internship" },
  { value: "unspecified", label: "Not specified" },
];

/**
 * How much experience the listing asks for. `graduate` is deliberately not
 * a value: in Indian job ads "any graduate" means "has a degree", not "new
 * grad", so it fired on nearly every listing. New-grad wording lands in
 * `entry` instead.
 */
const EXPERIENCE_LEVELS = [
  { value: "internship", label: "Internship" },
  { value: "entry", label: "Entry level" },
  { value: "mid", label: "Mid level" },
  { value: "senior", label: "Senior" },
  { value: "unspecified", label: "Not specified" },
];

/** The boards a listing can come from, as stored in `source`. */
const SOURCES = [
  { value: "linkedin", label: "LinkedIn" },
  { value: "indeed", label: "Indeed" },
  { value: "ambitionbox", label: "AmbitionBox" },
  { value: "instahyre", label: "Instahyre" },
  { value: "remoteok", label: "RemoteOK" },
  { value: "arbeitnow", label: "Arbeitnow" },
  { value: "jobicy", label: "Jobicy" },
  { value: "himalayas", label: "Himalayas" },
  { value: "weworkremotely", label: "We Work Remotely" },
  { value: "freelancer", label: "Freelancer.com" },
  { value: "greenhouse", label: "Company board" },
  { value: "lever", label: "Company board" },
  { value: "ashby", label: "Company board" },
  { value: "manual", label: "Posted by the team" },
];

const values = (entries) => entries.map((entry) => entry.value);

const ROLE_CATEGORY_VALUES = values(ROLE_CATEGORIES);
const WORK_TYPE_VALUES = values(WORK_TYPES);
const EXPERIENCE_LEVEL_VALUES = values(EXPERIENCE_LEVELS);
const SOURCE_VALUES = values(SOURCES);

/**
 * Other people's spellings for the same thing, mapped onto our values.
 *
 * The capitalised four are the old skeo-lms `JobPosting.type` enum, so a
 * hand-posted opening written before this existed still lands somewhere
 * sensible. The rest are spellings the boards themselves use.
 */
const LEGACY_WORK_TYPE_ALIASES = {
  "full-time": "full-time",
  fulltime: "full-time",
  permanent: "full-time",
  "part-time": "part-time",
  parttime: "part-time",
  contract: "contract",
  contractor: "contract",
  temporary: "contract",
  "fixed-term": "contract",
  freelance: "freelance",
  gig: "freelance",
  internship: "internship",
  intern: "internship",
  trainee: "internship",
};

const labelLookup = (entries) => {
  const byValue = new Map(entries.map((entry) => [entry.value, entry.label]));
  // An unknown value is shown as itself rather than swallowed: a listing
  // tagged with something this table has never heard of is a bug worth
  // seeing on the page, not one worth hiding behind "Other".
  return (value) => byValue.get(value) || value || "";
};

const roleCategoryLabel = labelLookup(ROLE_CATEGORIES);
const workTypeLabel = labelLookup(WORK_TYPES);
const experienceLevelLabel = labelLookup(EXPERIENCE_LEVELS);
const sourceLabel = labelLookup(SOURCES);

/**
 * Folds any of the spellings above onto a canonical work type.
 * Anything unrecognised becomes `unspecified`, which is the honest answer -
 * better than picking the nearest-looking value and being confidently wrong.
 */
function normalizeWorkType(input) {
  if (typeof input !== "string") return "unspecified";

  const key = input.trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (!key) return "unspecified";

  return LEGACY_WORK_TYPE_ALIASES[key] || "unspecified";
}

const isRoleCategory = (value) => ROLE_CATEGORY_VALUES.includes(value);
const isWorkType = (value) => WORK_TYPE_VALUES.includes(value);
const isExperienceLevel = (value) => EXPERIENCE_LEVEL_VALUES.includes(value);

module.exports = {
  ROLE_CATEGORIES,
  WORK_TYPES,
  EXPERIENCE_LEVELS,
  SOURCES,
  ROLE_CATEGORY_VALUES,
  WORK_TYPE_VALUES,
  EXPERIENCE_LEVEL_VALUES,
  SOURCE_VALUES,
  LEGACY_WORK_TYPE_ALIASES,
  roleCategoryLabel,
  workTypeLabel,
  experienceLevelLabel,
  sourceLabel,
  normalizeWorkType,
  isRoleCategory,
  isWorkType,
  isExperienceLevel,
};
