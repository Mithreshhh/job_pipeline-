/**
 * Turns the raw output of every scraper into the shared job schema.
 *
 * Each source names its fields differently (RemoteOK calls the title
 * "position", Jobicy calls it "jobTitle", Himalayas calls it "title"), and
 * each has its own idea of a date (epoch seconds, epoch milliseconds, ISO
 * strings). Everything below converges on one shape so nothing downstream
 * has to care where a job came from.
 *
 * In the same pass each job is tagged with roleCategory (AI-Tech /
 * AI-NonTech / not relevant), workType, experienceLevel, and country.
 */

"use strict";

const { createJob } = require("./schema");
const SYLLABUS = require("./syllabus");
const { scoreJobRank } = require("./ranking");
const { classifyDomain } = require("./domain");

/**
 * Technical AI roles, used to classify an incoming title as AI-Tech.
 *
 * This is a classifier list, not a search list - the two used to be the same
 * and no longer are. scrapers/india.py deliberately stopped searching for
 * MLOps, computer vision, deep learning, NLP and AI research, because the
 * syllabus does not teach them and pipeline/syllabus.js ranks them at the
 * bottom. They stay here because such jobs still arrive from the
 * international boards, and one arriving should still be filed as AI-Tech
 * rather than dropped.
 */
const AI_TECH_KEYWORDS = [
  "machine learning engineer",
  "AI engineer",
  "data scientist",
  "NLP engineer",
  "deep learning engineer",
  "generative AI",
  "computer vision engineer",
  "MLOps",
  "AI researcher",
  "prompt engineer",
];

/**
 * AI roles that don't require writing code. These are a separate bucket
 * rather than extra entries in the tech list, because someone browsing for
 * an AI content role shouldn't have to wade through ML engineering posts.
 */
const AI_NONTECH_KEYWORDS = [
  "ai content writer",
  "ai writer",
  "content writer ai",
  "ai trainer",
  "ai tutor",
  "ai instructor",
  "data annotator",
  "data annotation",
  "data labeling",
  "data labelling",
  "annotation specialist",
  "rlhf",
  "ai policy",
  "ai ethics",
  "responsible ai",
  "ai governance",
  "ai product manager",
  "ai program manager",
  "ai project manager",
  "ai marketing",
  "ai sales",
  "ai consultant",
  "ai strategist",
  "ai operations",
  "ai analyst",
  "ai evangelist",
  "conversation designer",
  "conversational designer",
  "ai community manager",
  "ai recruiter",
  "ai curriculum",
  "search quality rater",
  "model evaluator",
  "ai evaluator",
];

/**
 * How a job is engaged, kept separate from roleCategory because the two are
 * independent: a freelance gig can be technical or not, and so can a
 * full-time post.
 *
 * Only ever matched against a source's structured type field plus the title.
 * Descriptions say things like "you'll work with our contractors", which
 * would mislabel half the board.
 */
const WORK_TYPE_PATTERNS = [
  ["freelance", [/\bfreelance(r|rs)?\b/i, /\bgig\b/i, /\bproject[\s-]based\b/i]],
  ["internship", [/\bintern(ship)?\b/i, /\btrainee\b/i]],
  [
    "contract",
    [/\bcontract(or|ors|ual)?\b/i, /\btemporary\b/i, /\bfixed[\s-]term\b/i, /\bc2c\b/i],
  ],
  ["part-time", [/\bpart[\s-]?time\b/i]],
  ["full-time", [/\bfull[\s-]?time\b/i, /\bfulltime\b/i, /\bpermanent\b/i]],
];

/** Sources where every listing is freelance work by definition. */
const FREELANCE_SOURCES = new Set(["freelancer"]);

/**
 * Freelance clients describe a task, not a job title: "build me an AI
 * chatbot", never "Machine Learning Engineer". Matching gigs against the
 * job-title list finds almost nothing, so marketplace listings are matched
 * against these broader skill terms instead. They're deliberately not used
 * for job boards, where "machine learning" appears in half the JDs.
 */
const AI_SKILL_KEYWORDS = [
  "machine learning",
  "artificial intelligence",
  "deep learning",
  "neural network",
  "computer vision",
  "natural language processing",
  "nlp",
  "llm",
  "large language model",
  "generative ai",
  "gen ai",
  "chatbot",
  "openai",
  "gpt",
  "langchain",
  "hugging face",
  "stable diffusion",
  "tensorflow",
  "pytorch",
  "data annotation",
  "data labeling",
  "prompt engineering",
  "ai agent",
  "rag pipeline",
  "chatgpt",
  "ai writing",
  "ai content",
];

/**
 * Gig work that uses AI tools without building them - the freelance half of
 * "non-technical AI roles". Only consulted for marketplace listings, and
 * only once an AI skill term has already matched, so a plain copywriting
 * job doesn't qualify.
 */
const GIG_NONTECH_PATTERNS = [
  /\bblog\b/i,
  /\barticles?\b/i,
  /\bcontent\s+writ/i,
  /\bcopywrit/i,
  /\bghostwrit/i,
  /\btranscription\b/i,
  /\bdata\s+entry\b/i,
  /\bannotation\b/i,
  /\blabell?ing\b/i,
  /\bvirtual\s+assistant\b/i,
  /\bsocial\s+media\b/i,
  /\bseo\b/i,
  /\bvoice\s?over\b/i,
];

/**
 * A title can match the non-tech list and still be an engineering job -
 * "Senior Software Engineer, AI Operations". These nouns break the tie
 * back toward tech.
 */
const TECH_ROLE_NOUNS =
  /\b(engineer|engineering|developer|programmer|architect|scientist|sre|devops)\b/i;

/**
 * Non-AI categories, in priority order. A job is kept if its title matches
 * any of these - the board is no longer AI-only, so the filter's job is to
 * sort jobs into buckets rather than throw most of them away.
 *
 * Order matters: "Video Editor" must reach Creative before Writing claims
 * it for "editor", and "Data Analyst" must reach Tech before Business
 * claims it for "analyst".
 */
const CATEGORY_PATTERNS = [
  [
    "Creative",
    [
      /\bvideo\s?editor\b/i,
      /\bvideo\s+editing\b/i,
      /\bvideographer\b/i,
      /\bmotion\s+(graphics?|designer)\b/i,
      /\banimator\b/i,
      /\banimation\b/i,
      /\bgraphic\s+design(er)?\b/i,
      /\bvisual\s+designer\b/i,
      /\bui\s*\/?\s*ux\b/i,
      /\b(ui|ux|product|web)\s+designer\b/i,
      /\billustrator\b/i,
      /\bphotographer\b/i,
      /\bphoto\s+edit(or|ing)\b/i,
      /\bcreative\s+(director|lead)\b/i,
      /\b3d\s+artist\b/i,
      /\bvfx\b/i,
      /\bafter\s+effects\b/i,
      /\bpremiere\s+pro\b/i,
      /\bthumbnail\b/i,
      /\bart\s+director\b/i,
    ],
  ],
  [
    "Marketing",
    [
      /\bsocial\s+media\b/i,
      /\bdigital\s+marketing\b/i,
      /\bmarketing\s+(manager|associate|executive|specialist|lead|coordinator)\b/i,
      /\bseo\b/i,
      /\bsem\b/i,
      /\bppc\b/i,
      /\bgrowth\s+(marketer|manager|hacker|lead)\b/i,
      /\bcommunity\s+manager\b/i,
      /\bbrand\s+(manager|strategist)\b/i,
      /\binfluencer\b/i,
      /\bperformance\s+marketing\b/i,
      /\bemail\s+marketing\b/i,
      /\bcontent\s+marketing\b/i,
      /\bmedia\s+buyer\b/i,
      /\bpaid\s+(ads|media|social)\b/i,
    ],
  ],
  [
    "Writing",
    [
      /\bcontent\s+writer\b/i,
      /\bcopywriter\b/i,
      /\bcopywriting\b/i,
      /\btechnical\s+writer\b/i,
      /\bghostwriter\b/i,
      /\bscript\s?writer\b/i,
      /\bblogger\b/i,
      /\bjournalist\b/i,
      /\btranslator\b/i,
      /\btranscription(ist)?\b/i,
      /\bproofread(er|ing)\b/i,
      /\beditor\b/i,
    ],
  ],
  [
    "Tech",
    [
      /\bsoftware\s+(engineer|developer)\b/i,
      /\b(frontend|front-end|backend|back-end|full\s?stack)\b/i,
      /\bweb\s+developer\b/i,
      /\b(mobile|android|ios|flutter|react\s+native)\s+(developer|engineer)\b/i,
      /\bdevops\b/i,
      /\bsite\s+reliability\b/i,
      /\bcloud\s+(engineer|architect)\b/i,
      /\b(qa|test|automation)\s+engineer\b/i,
      /\bdata\s+(engineer|analyst)\b/i,
      /\bbusiness\s+intelligence\b/i,
      /\bsecurity\s+(engineer|analyst)\b/i,
      /\b(platform|systems?|network|embedded)\s+engineer\b/i,
      /\b(python|java|javascript|node|react|angular|php|ruby|golang|\.net)\s+developer\b/i,
      /\bwordpress\b/i,
      /\bshopify\b/i,
      /\bdatabase\s+(administrator|developer)\b/i,
    ],
  ],
  [
    "Business",
    [
      /\b(sales|account)\s+(executive|manager|representative|associate)\b/i,
      /\bbusiness\s+development\b/i,
      /\bcustomer\s+(success|support|service)\b/i,
      /\b(operations|project|program|product)\s+manager\b/i,
      /\bhuman\s+resources\b/i,
      /\brecruiter\b/i,
      /\btalent\s+acquisition\b/i,
      /\baccountant\b/i,
      /\bbookkeep(er|ing)\b/i,
      /\bfinancial\s+analyst\b/i,
      /\b(virtual|executive|administrative)\s+assistant\b/i,
      /\bdata\s+entry\b/i,
      /\boffice\s+manager\b/i,
      /\bconsultant\b/i,
      /\banalyst\b/i,
    ],
  ],
];

/** Any mention of AI in a title, however the company phrases it. */
const AI_MENTION =
  /\b(ai|a\.i\.|ml|genai|gen\s?ai|llms?|machine\s+learning|artificial\s+intelligence|deep\s+learning|generative)\b/i;

/**
 * A deliberately broad second pass, run only after the specific lists miss.
 *
 * Real titles are endlessly varied - "AI Infrastructure Engineer",
 * "Forward Deployed Engineer, GenAI", "Engagement Manager" - and an exact
 * keyword list will never cover them. Without this tier roughly half of
 * every company board was being discarded. Matching on the role noun keeps
 * those jobs and files them somewhere sensible.
 */
const BROAD_CATEGORY_PATTERNS = [
  // design/designed/designing - gig titles say "need a logo designed".
  ["Creative", [/\b(design(er|ed|ing)?|video|creative|artist|animation|photo)\b/i]],
  ["Marketing", [/\b(marketing|growth|communications?|social|brand|advertis)\b/i]],
  ["Writing", [/\b(writer|writing|content|editorial|editor)\b/i]],
  [
    "Business",
    [
      /\b(manager|director|head|lead|principal|strategist|analyst|associate|specialist|coordinator|consultant|counsel|operations|sales|recruit|finance|accounting|partnerships?|success|support|advisor|advisory|fellow|intern)\b/i,
      /\bchief\s+of\s+staff\b/i,
    ],
  ],
];

// Only ever tested against a location field. "IN" is anchored to the end
// because it's a country code ("MH, IN") - unanchored it matches the word
// "in" in ordinary prose.
const INDIA_LOCATION_PATTERNS = [
  /\bindia\b/i,
  /,\s*in\s*$/i,
  /\bbengaluru\b/i,
  /\bbangalore\b/i,
  /\bhyderabad\b/i,
  /\bpune\b/i,
  /\bmumbai\b/i,
  /\bdelhi\b/i,
  /\bnoida\b/i,
  /\bgurgaon\b/i,
  /\bgurugram\b/i,
  /\bchennai\b/i,
  /\bkolkata\b/i,
  /\bahmedabad\b/i,
];

/**
 * Word signals that only mean something in a job *title*. In description
 * prose "lead", "architect" and "senior" usually describe the team or who
 * you report to ("lead a team", "reports to senior management"), not the
 * seniority of the role, so scanning descriptions with these tags most
 * jobs as senior.
 */
const TITLE_EXPERIENCE_PATTERNS = [
  ["internship", [/\bintern(ship)?\b/i, /\btrainee\b/i, /\bapprentice(ship)?\b/i]],
  [
    "entry",
    [
      /\bfresher?s?\b/i,
      /\bentry[\s-]?level\b/i,
      /\bjunior\b/i,
      /\bjr\.?\b/i,
      // Not a bare "graduate": in Indian job ads "any graduate" means
      // "has a degree", not "new grad", and it fires on almost every JD.
      /\b(new|fresh)\s+grad(uate)?s?\b/i,
      /\bcampus\s+hire\b/i,
    ],
  ],
  [
    "senior",
    [
      /\bsenior\b/i,
      /\bsr\.?\b/i,
      /\bstaff\b/i,
      /\bprincipal\b/i,
      /\blead\b/i,
      /\barchitect\b/i,
      /\bhead\s+of\b/i,
    ],
  ],
  ["mid", [/\bmid[\s-]?(level|senior)\b/i]],
];

/**
 * Safe to scan description text with: these state a requirement of the
 * candidate rather than describing the surrounding org.
 */
const DESCRIPTION_EXPERIENCE_PATTERNS = [
  ["internship", [/\bintern(ship)?\b/i, /\btrainee\b/i, /\bapprentice(ship)?\b/i]],
  [
    "entry",
    [
      /\bfresher?s?\b/i,
      /\bentry[\s-]?level\b/i,
      /\b(new|fresh)\s+grad(uate)?s?\b/i,
      /\bcampus\s+hire\b/i,
    ],
  ],
];

/**
 * Buckets an explicit experience requirement by its lower bound, so
 * Naukri's "2-4 Yrs", Indeed's "5+ years" and "0-1 years" all land
 * somewhere sensible.
 */
function levelFromYears(text) {
  const bucket = (lower) => {
    if (lower <= 1) return "entry";
    if (lower <= 4) return "mid";
    return "senior";
  };

  const range = text.match(
    /\b(\d{1,2})\s*(?:[-–—]|\s+to\s+)\s*\d{1,2}\s*\+?\s*(?:years?|yrs?)\b/i
  );
  if (range) return bucket(Number(range[1]));

  const plus = text.match(/\b(\d{1,2})\s*\+\s*(?:years?|yrs?)\b/i);
  if (plus) return bucket(Number(plus[1]));

  const single = text.match(
    /\b(\d{1,2})\s*(?:years?|yrs?)\s+(?:of\s+)?experience\b/i
  );
  if (single) return bucket(Number(single[1]));

  return null;
}

function stripHtml(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Flattens whatever a source gives us (string, array, null) into text. */
function toText(...values) {
  return values
    .flat()
    .filter((v) => v !== null && v !== undefined)
    .map((v) => (typeof v === "string" ? v : String(v)))
    .join(" ");
}

/**
 * Sources mix epoch seconds, epoch milliseconds and ISO strings, so the
 * magnitude of a number is what tells them apart.
 */
function toIsoDate(value) {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "number") {
    const ms = value > 1e12 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Word-boundary matching, not substring: plain `includes` makes "Mumbai
 * marketing" match "ai marketing" and "Dubai operations" match "ai
 * operations", which quietly tags Indian and Gulf listings as AI roles.
 */
function toKeywordPattern(keyword) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped.replace(/\s+/g, "\\s+")}\\b`, "i");
}

const AI_TECH_PATTERNS = AI_TECH_KEYWORDS.map(toKeywordPattern);
const AI_NONTECH_PATTERNS = AI_NONTECH_KEYWORDS.map(toKeywordPattern);
const AI_SKILL_PATTERNS = AI_SKILL_KEYWORDS.map(toKeywordPattern);

function matchesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

/**
 * Returns "AI-Tech", "AI-NonTech", or null when the job isn't AI work.
 *
 * The title decides whenever it can. Only the tech list falls back to the
 * description, because the non-tech phrases ("responsible ai", "ai
 * governance") turn up in ordinary company boilerplate - matching those in
 * prose files HR and security roles into the AI bucket.
 */
/**
 * The broad pass: does this title mention AI, and is it an engineering
 * role? Those two questions sort most of what the specific lists miss.
 */
function classifyBroadly(text) {
  const mentionsAi = AI_MENTION.test(text);
  const isTechnical = TECH_ROLE_NOUNS.test(text);

  if (mentionsAi) return isTechnical ? "AI-Tech" : "AI-NonTech";
  if (isTechnical) return "Tech";

  for (const [category, patterns] of BROAD_CATEGORY_PATTERNS) {
    if (patterns.some((pattern) => pattern.test(text))) return category;
  }

  return null;
}

function classifyRole(titleText, descriptionText = "", { isGig = false } = {}) {
  if (titleText) {
    if (matchesAny(titleText, AI_TECH_PATTERNS)) return "AI-Tech";
    if (matchesAny(titleText, AI_NONTECH_PATTERNS)) {
      return TECH_ROLE_NOUNS.test(titleText) ? "AI-Tech" : "AI-NonTech";
    }

    for (const [category, patterns] of CATEGORY_PATTERNS) {
      if (patterns.some((pattern) => pattern.test(titleText))) return category;
    }

    // Gigs skip the broad pass here and get their own vocabulary below.
    // Otherwise "Build me an AI chatbot" is read as a non-technical AI job,
    // because the broad pass sees "AI" and no engineering noun.
    if (!isGig) {
      const broad = classifyBroadly(titleText);
      if (broad) return broad;
    }
  }

  if (descriptionText && matchesAny(descriptionText, AI_TECH_PATTERNS)) {
    return "AI-Tech";
  }

  // Marketplace gigs describe a task, so both title and brief are scanned,
  // against the skill vocabulary as well as the category lists.
  if (isGig) {
    const gigText = toText(titleText, descriptionText);

    if (matchesAny(gigText, AI_SKILL_PATTERNS)) {
      const nonTechGig =
        matchesAny(gigText, AI_NONTECH_PATTERNS) ||
        matchesAny(gigText, GIG_NONTECH_PATTERNS);

      // A tech role noun in the title still wins - "AI content engineer".
      if (nonTechGig && !TECH_ROLE_NOUNS.test(titleText)) return "AI-NonTech";
      return "AI-Tech";
    }

    for (const [category, patterns] of CATEGORY_PATTERNS) {
      if (patterns.some((pattern) => pattern.test(gigText))) return category;
    }

    const broad = classifyBroadly(gigText);
    if (broad) return broad;
  }

  return null;
}

/* ------------------------------------------------------------------ *
 * Relevance
 *
 * The board carries seven categories, and a plain newest-first sort buries
 * the roles these students are training for: on a live run, Business and
 * Tech were 4,100 of 6,500 listings, so page one was sales and ops while
 * the AI roles sat pages deep.
 *
 * Every job therefore gets a score, computed once when it is stored, and
 * the board sorts by it before date. Three things feed it, in order of how
 * much they are trusted:
 *
 *   category      what the classifier already decided the job is
 *   title         the strongest evidence, and the hardest to fake
 *   description   the weakest - every company's boilerplate mentions AI
 * ------------------------------------------------------------------ */

/** What the classifier already concluded, as a starting point. */
/**
 * Which syllabus terms a posting actually evidences.
 *
 * Returns the matched term names, most valuable first, along with the score
 * they earned. The names are what gets stored on the job: they are what make
 * a position on the board explainable ("matched Claude, n8n, prompt
 * engineering") and they are what lets the score be recomputed later without
 * the description, which is never stored.
 */
function collectSyllabusEvidence(titleText, descriptionText) {
  const title = toText(titleText);
  const description = toText(descriptionText);

  const hits = [];

  for (const band of SYLLABUS.BANDS) {
    for (const [name, pattern] of band.terms) {
      // A term found in the title counts at the title rate; the same term in
      // the description counts once, at the lower one. Never both - a title
      // word almost always reappears in the body.
      if (pattern.test(title)) hits.push({ name, band: band.key, value: band.title });
      else if (pattern.test(description)) hits.push({ name, band: band.key, value: band.text });
    }
  }

  // "Claude Code" matches both `claude` and `claude code`, which is one
  // signal, not two - counting both inflates the score and reads as a
  // duplicate on the card. Where one matched name contains another, only the
  // more specific survives.
  const names = hits.map((hit) => hit.name);
  const specific = hits.filter(
    (hit) => !names.some((other) => other !== hit.name && other.includes(hit.name)),
  );

  specific.sort((a, b) => b.value - a.value);

  const score = specific.reduce(
    (total, hit, index) => total + hit.value * SYLLABUS.decayAt(index),
    0,
  );

  return { hits: specific, score };
}

/**
 * What a posting loses for asking for things the programme does not supply:
 * seniority it cannot bridge, or specialist depth it never teaches.
 *
 * Capped, because the point is to move these down the board rather than to
 * bury them. A Menler graduate reading about a Director of AI role is not
 * harmed by seeing it on page four; they are harmed by not finding the
 * automation role on page one.
 */
function syllabusPenalty(titleText, descriptionText) {
  const title = toText(titleText);
  const description = toText(descriptionText);

  const reasons = [];
  let penalty = 0;

  for (const list of [SYLLABUS.SENIORITY, SYLLABUS.DEEP_SPECIALIST]) {
    for (const [name, pattern] of list) {
      if (pattern.test(title)) {
        reasons.push(name);
        penalty += SYLLABUS.TITLE_PENALTY;
      } else if (pattern.test(description)) {
        reasons.push(name);
        penalty += SYLLABUS.TEXT_PENALTY;
      }
    }
  }

  return { reasons, penalty: Math.min(penalty, SYLLABUS.MAX_PENALTY) };
}

/**
 * How well a job matches what Menler actually teaches, 0-100.
 *
 * Four things decide it, in descending order of weight:
 *
 *   1. named syllabus terms in the title   pipeline/syllabus.js, by band
 *   2. the same terms in the description   worth roughly a third as much
 *   3. the role's own category              a floor, not the answer
 *   4. reachability                         entry-level up, senior down
 *
 * minus what the posting asks for that the programme does not supply.
 *
 * The earlier version of this scored "does the title say AI", which put
 * Distinguished Engineer and VP roles above "Claude MCP / AI Automation
 * Developer" and produced seven distinct scores across ten thousand jobs -
 * so the sort was really seven buckets, ordered by date inside each. Counting
 * evidence with decay both ranks on the right thing and spreads the scores
 * far enough for the ordering to mean something.
 */
function scoreRelevance(titleText, descriptionText, roleCategory, { experienceLevel } = {}) {
  return scoreRelevanceDetailed(titleText, descriptionText, roleCategory, { experienceLevel }).relevance;
}

/** The same scoring, with its workings - used by the pipeline and by tests. */
function scoreRelevanceDetailed(titleText, descriptionText, roleCategory, { experienceLevel } = {}) {
  const base = SYLLABUS.CATEGORY_BASE[roleCategory] ?? 0;
  const { hits, score } = collectSyllabusEvidence(titleText, descriptionText);
  const { reasons, penalty } = syllabusPenalty(titleText, descriptionText);
  const reach = SYLLABUS.LEVEL_ADJUSTMENT[experienceLevel] ?? 0;

  const relevance = Math.max(0, Math.min(100, Math.round(base + score + reach - penalty)));

  return {
    relevance,
    // Deduped and capped: this is stored on every job, and six terms is
    // already more than anyone reads off a card.
    matchedSkills: [...new Set(hits.map((hit) => hit.name))].slice(0, 6),
    penalisedFor: [...new Set(reasons)],
  };
}

/** Scans the source's own type field and the title - never the description. */
function detectWorkType(typeText, titleText, source) {
  if (FREELANCE_SOURCES.has(source)) return "freelance";

  // Priority runs outermost: a title saying "Freelance" must beat a source
  // tag saying "full-time", which is how RemoteOK labels freelance posts.
  for (const [workType, patterns] of WORK_TYPE_PATTERNS) {
    for (const text of [typeText, titleText]) {
      if (!text) continue;
      if (patterns.some((pattern) => pattern.test(text))) return workType;
    }
  }
  return "unspecified";
}

/**
 * The title (plus any structured level field) is checked before the
 * description, because a stray "10+ years of combined team experience" in
 * a JD otherwise outranks the word "Lead" in the actual job title.
 */
function detectExperienceLevel(titleText, descriptionText = "") {
  const passes = [
    [titleText, TITLE_EXPERIENCE_PATTERNS],
    [descriptionText, DESCRIPTION_EXPERIENCE_PATTERNS],
  ];

  for (const [text, patternSets] of passes) {
    if (!text) continue;
    for (const [level, patterns] of patternSets) {
      if (patterns.some((pattern) => pattern.test(text))) return level;
    }
    const fromYears = levelFromYears(text);
    if (fromYears) return fromYears;
  }
  return "unspecified";
}

function detectCountry({ locationText, defaultCountry }) {
  if (INDIA_LOCATION_PATTERNS.some((pattern) => pattern.test(locationText))) {
    return "India";
  }
  return defaultCountry;
}

/**
 * Per-source mappers. Each returns the fields it can pull out plus the text
 * the tagging steps scan: matchText for relevance, and levelTitle /
 * levelText (title-side vs description-side) for seniority.
 */
/**
 * AmbitionBox gives a company slug rather than a URL. This is the pattern its
 * own pages use, verified against a live response: .jpg only, .png 404s.
 */
function ambitionBoxLogo(slug) {
  if (typeof slug !== "string" || !slug.trim()) return null;
  return `https://static.ambitionbox.com/alpha/company/photos/logos/${slug.trim()}.jpg`;
}

/**
 * Only http(s) URLs reach the schema.
 *
 * These are third-party strings that end up in an <img src> on both LMS
 * boards, so a `javascript:` or `data:` value must not survive the mapper.
 */
function safeLogoUrl(value) {
  if (typeof value !== "string") return null;
  const url = value.trim();
  return /^https?:\/\//i.test(url) ? url : null;
}

const MAPPERS = {
  jobspy(raw) {
    const description = stripHtml(raw.description);
    const location = raw.location || null;

    return {
      // JobSpy is the tool, not the job board - each record says which
      // board it actually came from, so dedupe can tell Indeed and
      // LinkedIn apart instead of lumping both under "jobspy".
      sourceName: raw.site || null,
      title: raw.title || null,
      company: raw.company || null,
      location,
      isRemote: Boolean(raw.is_remote),
      url: raw.job_url || raw.job_url_direct || null,
      postedAt: toIsoDate(raw.date_posted),
      companyLogo: safeLogoUrl(raw.company_logo),
      matchText: toText(raw.title, description),
      typeText: toText(raw.job_type),
      levelTitle: toText(raw.title, raw.job_level, raw.experience_range),
      levelText: description,
    };
  },

  remoteok(raw) {
    const description = stripHtml(raw.description);

    return {
      title: raw.position || null,
      company: raw.company || null,
      // RemoteOK often leaves location blank because everything is remote.
      location: raw.location || "Remote",
      isRemote: true,
      url: raw.url || raw.apply_url || null,
      postedAt: toIsoDate(raw.date || raw.epoch),
      matchText: toText(raw.position, description, raw.tags),
      // RemoteOK has no type field; contract/full-time show up as tags.
      typeText: toText(raw.tags),
      levelTitle: toText(raw.position),
      levelText: description,
    };
  },

  arbeitnow(raw) {
    const description = stripHtml(raw.description);

    return {
      title: raw.title || null,
      company: raw.company_name || null,
      location: raw.location || null,
      isRemote: Boolean(raw.remote),
      url: raw.url || null,
      postedAt: toIsoDate(raw.created_at),
      matchText: toText(raw.title, description, raw.tags),
      typeText: toText(raw.job_types),
      levelTitle: toText(raw.title, raw.job_types),
      levelText: description,
    };
  },

  jobicy(raw) {
    const description = stripHtml(raw.jobDescription || raw.jobExcerpt);

    return {
      title: raw.jobTitle || null,
      company: raw.companyName || null,
      location: raw.jobGeo || "Remote",
      isRemote: true,
      url: raw.url || null,
      companyLogo: safeLogoUrl(raw.companyLogo),
      postedAt: toIsoDate(raw.pubDate),
      matchText: toText(raw.jobTitle, description, raw.jobIndustry),
      typeText: toText(raw.jobType),
      // jobLevel is a structured hint ("Senior", "Entry-level", "Any").
      levelTitle: toText(raw.jobTitle, raw.jobLevel),
      levelText: description,
    };
  },

  himalayas(raw) {
    const description = stripHtml(raw.description || raw.excerpt);
    const locations = Array.isArray(raw.locationRestrictions)
      ? raw.locationRestrictions
      : [];

    return {
      title: raw.title || null,
      company: raw.companyName || null,
      location: locations.length > 0 ? locations.join(", ") : "Remote",
      isRemote: true,
      url: raw.applicationLink || raw.guid || null,
      companyLogo: safeLogoUrl(raw.companyLogo),
      postedAt: toIsoDate(raw.pubDate),
      matchText: toText(raw.title, description, raw.categories),
      typeText: toText(raw.employmentType),
      levelTitle: toText(raw.title, raw.seniority, raw.employmentType),
      levelText: description,
    };
  },

  freelancer(raw) {
    const description = stripHtml(raw.description || raw.preview_description);
    // The API gives a relative slug, not a full link.
    const url = raw.seo_url ? `https://www.freelancer.com/projects/${raw.seo_url}` : null;
    const skills = Array.isArray(raw.jobs)
      ? raw.jobs.map((skill) => (skill && skill.name) || "")
      : [];

    return {
      title: raw.title || null,
      // Unauthenticated responses expose only an owner_id, never a name.
      company: null,
      location: "Remote",
      isRemote: true,
      url,
      postedAt: toIsoDate(raw.submitdate || raw.time_submitted),
      matchText: toText(raw.title, description, skills),
      typeText: toText(raw.type),
      levelTitle: toText(raw.title),
      levelText: description,
    };
  },

  greenhouse(raw) {
    const location = (raw.location && raw.location.name) || null;

    return {
      title: raw.title || null,
      company: raw.company_name || null,
      location,
      isRemote: /\bremote\b/i.test(toText(location, raw.title)),
      url: raw.absolute_url || null,
      postedAt: toIsoDate(raw.first_published || raw.updated_at),
      // The board endpoint lists jobs without descriptions, so matching is
      // title-only here - which is stricter, and fine.
      matchText: toText(raw.title),
      typeText: "",
      levelTitle: toText(raw.title),
      levelText: "",
    };
  },

  weworkremotely(raw) {
    const description = stripHtml(raw.description);
    // Titles arrive as "Company: Job Title" - the only place the company
    // name appears in the feed.
    const rawTitle = typeof raw.title === "string" ? raw.title : "";
    const splitAt = rawTitle.indexOf(":");
    const company = splitAt > 0 ? rawTitle.slice(0, splitAt).trim() : null;
    const title = splitAt > 0 ? rawTitle.slice(splitAt + 1).trim() : rawTitle || null;

    return {
      title: title || null,
      company,
      location: raw.region || "Remote",
      isRemote: true,
      url: raw.link || raw.guid || null,
      postedAt: toIsoDate(raw.pubDate),
      matchText: toText(title, description, raw.category, raw.skills),
      typeText: toText(raw.type),
      levelTitle: toText(title),
      levelText: description,
    };
  },

  /**
   * Lever, the third keyless ATS. Added for India coverage: most Indian
   * startups that publish a machine-readable board are on Lever rather than
   * Greenhouse or Ashby, so without this they were invisible to us.
   *
   * Like Ashby, a Lever job carries no company name - only the board does -
   * so normalizeJob falls back to the board token.
   */
  /**
   * AmbitionBox. Indian listings, mostly re-published from Naukri, read out
   * of the page's server-rendered JSON. Its experience range (minExp/maxExp)
   * is handed to the level detector as "2-7 Yrs", which the year-range
   * parser already understands - so seniority comes from a real number here
   * rather than from guessing at the title.
   */
  ambitionbox(raw) {
    const locations = Array.isArray(raw.locations) ? raw.locations : [];
    const location = locations.join(", ") || null;
    const skills = Array.isArray(raw.skills) ? raw.skills.join(", ") : "";

    const years =
      Number.isFinite(raw.minExp) && Number.isFinite(raw.maxExp)
        ? `${raw.minExp}-${raw.maxExp} Yrs`
        : "";

    return {
      title: raw.title || null,
      company: raw.company || raw.shortName || null,
      location,
      defaultCountry: "India",
      isRemote: /\bremote\b/i.test(toText(location, raw.title, raw.workMode)),
      // jdpUrl is a path, not a URL.
      url: raw.jdpUrl ? `https://www.ambitionbox.com${raw.jdpUrl}` : null,
      companyLogo: safeLogoUrl(ambitionBoxLogo(raw.companyLogo)),
      postedAt: toIsoDate(raw.postedAtIso),
      matchText: toText(raw.title, raw.jobProfile, skills),
      typeText: "",
      levelTitle: toText(raw.title),
      levelText: years,
    };
  },
  instahyre(raw) {
    const employer = raw.employer || {};
    // A skill array, not prose. It is all the text this source gives, so it
    // stands in for the description everywhere one is read - and because it
    // is short, jobs from here score lower than jobs that ship a real JD.
    const skills = Array.isArray(raw.keywords) ? raw.keywords.join(", ") : "";
    const location = raw.locations || null;

    return {
      title: raw.title || null,
      company: employer.company_name || null,
      location,
      defaultCountry: "India",
      // Instahyre's own word for remote, and the only place it appears.
      isRemote: /work from home|remote/i.test(String(location)),
      companyLogo: safeLogoUrl(employer.profile_image_src),
      url: raw.public_url || null,
      // The API carries no posting date at all. Left null deliberately rather
      // than defaulted to today, which would present a six-month-old listing
      // as this morning's; the read-time window falls back to fetchedAt.
      postedAt: null,
      matchText: toText(raw.title, skills),
      typeText: "",
      levelTitle: toText(raw.title),
      levelText: "",
    };
  },

  lever(raw) {
    const categories = raw.categories || {};
    const location = categories.location || null;
    const description = toText(raw.descriptionPlain, raw.additionalPlain);

    return {
      title: raw.text || null,
      company: null,
      location,
      isRemote:
        raw.workplaceType === "remote" ||
        /\bremote\b/i.test(toText(location, raw.text)),
      url: raw.hostedUrl || raw.applyUrl || null,
      // Epoch milliseconds; toIsoDate already tells ms from seconds.
      postedAt: toIsoDate(raw.createdAt),
      matchText: toText(raw.text, categories.department, categories.team, description),
      // "Full-time", "Contract", "Intern" - Lever's own commitment field.
      typeText: toText(categories.commitment),
      levelTitle: toText(raw.text),
      levelText: description,
    };
  },

  ashby(raw) {
    const location = raw.location || null;

    return {
      title: raw.title || null,
      company: null,
      location,
      isRemote: Boolean(raw.isRemote),
      url: raw.jobUrl || raw.applyUrl || null,
      postedAt: toIsoDate(raw.publishedAt),
      matchText: toText(raw.title, raw.department, raw.team),
      typeText: toText(raw.employmentType),
      levelTitle: toText(raw.title),
      levelText: "",
    };
  },
};

/** Wrapper `source` values the scrapers write, mapped to their mapper. */
const SOURCE_ALIASES = {
  jobspy: "jobspy",
  "jobspy-indeed": "jobspy",
  "jobspy-linkedin": "jobspy",
  remoteok: "remoteok",
  arbeitnow: "arbeitnow",
  jobicy: "jobicy",
  himalayas: "himalayas",
  freelancer: "freelancer",
  greenhouse: "greenhouse",
  ashby: "ashby",
  lever: "lever",
  ambitionbox: "ambitionbox",
  instahyre: "instahyre",
  weworkremotely: "weworkremotely",
};

// Matched against the wrapper's own source string, not the mapper alias:
// india.py writes "jobspy", jobspy_global.py writes "jobspy-indeed" /
// "jobspy-linkedin", and all three share the same mapper.
const INDIA_SOURCES = new Set(["jobspy", "ambitionbox", "instahyre"]);

function normalizeJob(rawJob, { source, defaultCountry, fetchedAt, entryCompany }) {
  const mapperName = SOURCE_ALIASES[source];
  if (!mapperName) throw new Error(`No mapper for source "${source}"`);

  const mapped = MAPPERS[mapperName](rawJob);
  const sourceName = mapped.sourceName || source;

  // Classified once and reused: relevance is scored partly from the category,
  // and running the classifier twice per job costs a second pass over every
  // keyword list for an answer we already have.
  const roleCategory = classifyRole(toText(mapped.title), mapped.matchText, {
    isGig: FREELANCE_SOURCES.has(sourceName),
  });

  // Seniority feeds the score, so it has to be known before scoring rather
  // than assembled alongside it.
  const experienceLevel = detectExperienceLevel(mapped.levelTitle, mapped.levelText);
  const scored = scoreRelevanceDetailed(mapped.title, mapped.matchText, roleCategory, {
    experienceLevel,
  });

  const country = detectCountry({
    locationText: toText(mapped.location),
    defaultCountry: mapped.defaultCountry || defaultCountry,
  });

  // Reachability: can this student get it, is it open to them, and can they
  // apply today. Scored here rather than at read time for the same reason
  // relevance is - it never changes for a stored job, and the board sorts on
  // it. Reads the description, which is the only moment we have it.
  const rank = scoreJobRank({
    title: mapped.title,
    description: mapped.matchText,
    location: mapped.location,
    country,
    isRemote: mapped.isRemote,
    url: mapped.url,
    source: sourceName,
    experienceLevel,
    relevance: scored.relevance,
    matchedSkills: scored.matchedSkills,
  });

  return createJob({
    title: mapped.title,
    // Ashby job objects carry no company name - only the board does.
    company: mapped.company || entryCompany || null,
    location: mapped.location,
    country,
    isRemote: mapped.isRemote,
    url: mapped.url,
    source: sourceName,
    // Only five of the eleven sources ship one. The boards fall back to a
    // monogram rather than leaving a hole, so a null here is normal.
    companyLogo: mapped.companyLogo || null,
    roleCategory,
    // The job's function, for browsing. Title plus category only, so a
    // backfill reproduces it exactly - see pipeline/domain.js.
    domain: classifyDomain(mapped.title, roleCategory),
    workType: detectWorkType(mapped.typeText, toText(mapped.title), sourceName),
    relevance: scored.relevance,
    // Stored because the description is not: without it, a later rescore
    // could only ever see the title, and 99% of syllabus evidence lives in
    // the body text.
    matchedSkills: scored.matchedSkills,
    achievability: rank.achievability,
    indiaFit: rank.indiaFit,
    easeOfApply: rank.easeOfApply,
    rankScore: rank.rankScore,
    rankReasons: rank.rankReasons,
    experienceLevel,
    postedAt: mapped.postedAt,
    fetchedAt,
  });
}

/**
 * Normalizes one raw wrapper entry, e.g. {source, keyword, city, jobs:[...]}.
 * Jobs that don't match the AI keyword list come back under `excluded`
 * rather than being dropped, so a filter that's too strict is visible
 * instead of silent.
 */
function normalizeEntry(entry, { fetchedAt = new Date().toISOString() } = {}) {
  const source = entry.source;
  const rawJobs = Array.isArray(entry.jobs) ? entry.jobs : [];

  // international.js pulls whole remote-board feeds, which are worldwide
  // unless a job's own location says India.
  const defaultCountry = INDIA_SOURCES.has(source) ? "India" : "International";

  const jobs = [];
  const excluded = [];

  for (const rawJob of rawJobs) {
    const job = normalizeJob(rawJob, {
      source,
      defaultCountry,
      fetchedAt,
      entryCompany: entry.company,
    });
    if (job.roleCategory) jobs.push(job);
    else excluded.push(job);
  }

  return { jobs, excluded };
}

/** Accepts a single wrapper or the arrays the scrapers write to db/raw/. */
function normalizeRaw(raw, options = {}) {
  const entries = Array.isArray(raw) ? raw : [raw];
  const jobs = [];
  const excluded = [];

  for (const entry of entries) {
    const result = normalizeEntry(entry, options);
    jobs.push(...result.jobs);
    excluded.push(...result.excluded);
  }

  return { jobs, excluded };
}

module.exports = {
  AI_TECH_KEYWORDS,
  AI_NONTECH_KEYWORDS,
  FREELANCE_SOURCES,
  normalizeRaw,
  normalizeEntry,
  normalizeJob,
  classifyRole,
  scoreRelevance,
  scoreRelevanceDetailed,
  scoreJobRank,
  ambitionBoxLogo,
  safeLogoUrl,
  collectSyllabusEvidence,
  detectWorkType,
  detectExperienceLevel,
  detectCountry,
  stripHtml,
  toIsoDate,
};
