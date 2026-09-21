/**
 * Shared job schema.
 * Every scraper must normalize its raw output into objects matching this shape
 * before handing them to the pipeline, so downstream code never has to guess
 * which fields exist.
 */

const JOB_SCHEMA_FIELDS = [
  "title",
  "company",
  "location",
  "country",
  "isRemote",
  "url",
  "source",
  "roleCategory",
  "workType",
  "relevance",
  "experienceLevel",
  "postedAt",
  "fetchedAt",
];

/**
 * Builds a job object with every schema field present, defaulting missing
 * values to null so all jobs have a consistent set of keys.
 * @param {Partial<Record<typeof JOB_SCHEMA_FIELDS[number], unknown>>} data
 */
function createJob(data = {}) {
  const job = {};
  for (const field of JOB_SCHEMA_FIELDS) {
    job[field] = field in data ? data[field] : null;
  }
  return job;
}

module.exports = { JOB_SCHEMA_FIELDS, createJob };
