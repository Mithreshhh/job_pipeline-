/**
 * How the board decides what a student sees first.
 *
 * `relevance` (pipeline/syllabus.js) answers "does this job match what we
 * teach". It does not answer "could this student get it", and those are
 * different questions. A Staff Engineer role in San Francisco asking for ten
 * years and a US work visa can match the syllabus perfectly and still be
 * useless to somebody finishing a six-week programme in Coimbatore.
 *
 * So three more scores sit alongside it, and one combined `rankScore` orders
 * the board:
 *
 *   achievability  can they realistically get it? Experience level, seniority
 *                  in the title, and the years the description asks for.
 *   indiaFit       is it open to them? India-based, or remote that actually
 *                  hires from India, and not gated on a US/EU visa.
 *   easeOfApply    can they apply today? A direct link, no take-home, no
 *                  five-round process, no degree gate.
 *   relevance      does it match the syllabus? Scored elsewhere, read here.
 *
 * All four are 0-100 and rule-based. No model calls: the ordering of a job
 * board is something a student may well ask us to justify, and every score
 * here can be traced to a phrase in the posting.
 *
 * ON WRITING PATTERNS HERE. Every pattern is a literal. A backslash-b inside
 * a template literal is the backspace control character rather than a word
 * boundary, and that mistake once silently disabled an entire scoring list in
 * this repo. The test suite asserts no control byte survives in this file.
 */

"use strict";

/* ------------------------------------------------------------------ *
 * The weights
 * ------------------------------------------------------------------ */

/**
 * The priority order, as numbers. Achievable first, Indian second, easy to
 * apply third, relevant fourth.
 *
 * Kept in one object so the ordering can be retuned without reading any of
 * the scoring below. They sum to 1, so `rankScore` stays on the same 0-100
 * scale as its parts and can be compared across changes.
 *
 * Worth knowing before you tune: relevance at 0.12 is a deliberately small
 * voice, and because most listings score 6-30 on it, its real contribution is
 * a point or two. Everything on this board has already passed the syllabus
 * classifier, so relevance is breaking ties between jobs that are all at
 * least plausibly on-topic - it is not what keeps the board on-topic.
 */
const RANK_WEIGHTS = {
  achievability: 0.4,
  indiaFit: 0.3,
  easeOfApply: 0.18,
  relevance: 0.12,
};

/**
 * The one rule that is not a weighted average, and why it exists.
 *
 * Weighting relevance fourth is right for two jobs that are both plausibly
 * on-topic. It is wrong for a job that is not on-topic at all, because
 * reachability alone is trivially maxed: a bank's walk-in hiring drive for a
 * customer service executive in Chennai is entry level, in India, and easy to
 * apply to, so on the weights alone it scores 74 and lands at number three.
 * That was the measured result on a 525-job sample before this was added.
 *
 * Nothing in the weights can fix that. Relevance at 0.12 moves such a job by
 * four points, and raising its weight far enough to matter would undo the
 * priority order the board is supposed to have.
 *
 * So relevance gets one power the other axes do not: below the threshold it
 * scales the whole score rather than adding to it. 15 sits above a category
 * floor with no syllabus match (Business scores 12) and below every category
 * that has one (Creative, Writing and Marketing score 18, Tech 20), so this
 * catches listings with nothing to do with the course and leaves the rest
 * ordered purely by reachability, as asked.
 *
 * Set `multiplier: 1` to switch it off and get the pure weighted sum.
 */
const OFF_TOPIC_DAMPING = { threshold: 15, multiplier: 0.6 };

/** Where a score starts before any evidence moves it. */
const NEUTRAL = 50;

const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));

const toText = (...parts) =>
  parts
    .filter((p) => typeof p === "string" && p)
    .join(" ")
    .toLowerCase();

/* ------------------------------------------------------------------ *
 * 1. Achievability
 * ------------------------------------------------------------------ */

/**
 * Titles that put a job out of reach of somebody two months into their first
 * AI role, however well it matches the syllabus.
 *
 * "Architect" and "Manager" are here for the same reason as "Director": they
 * describe a rank, not a task.
 */
const SENIOR_TITLE = [
  ["senior", /\b(senior|sr\.?|snr)\b/i],
  ["lead", /\blead\b|\bleader\b/i],
  ["principal", /\bprincipal\b/i],
  ["staff", /\bstaff\s+(engineer|scientist|designer|developer)\b/i],
  ["manager", /\bmanager\b|\bmanagement\b/i],
  ["head", /\bhead\s+of\b|\bhead,/i],
  ["director", /(?<!\b(art|creative|casting|music|photography|technical|design)\s)\bdirectors?\b/i],
  ["architect", /\barchitect\b/i],
  ["vp", /\b(vp|vice president|svp|evp|chief|cto|cio)\b/i],
];

/**
 * Titles that say the opposite, and that WIN over the list above.
 *
 * "Internship - Assist Senior Engineers" and "Graduate Trainee reporting to
 * the Lead" are both entry-level jobs whose titles happen to contain a senior
 * word. Reading the seniority list first would bury exactly the postings this
 * board exists to surface, so a junior marker anywhere in the title settles
 * it.
 */
const JUNIOR_TITLE = [
  ["internship", /\bintern(ship)?\b/i],
  ["fresher", /\bfresher'?s?\b/i],
  ["trainee", /\btrainee\b|\btraineeship\b/i],
  ["graduate", /\bgraduate\s+(engineer|trainee|programme|program|scheme)\b|\bcampus hire\b/i],
  ["junior", /\bjunior\b|\bjr\.?\b/i],
  ["entry level", /\bentry[\s-]level\b|\bstarter\b/i],
  // "Associate Software Engineer" is a first job. "Associate Director",
  // "Associate Vice President" and "Associate Manager" are not - at Accenture
  // an Associate Manager is eight years in - and because this list overrides
  // the seniority one, a bare match here put two of them at the top of a real
  // sample run.
  // Nor is "Senior Associate", which at the Big Four and most consultancies
  // is three to five years in. Measured: 74 stored titles, every one of them
  // scored 88 on achievability before the lookbehind, because this list
  // overriding the seniority one meant "Senior" was never read.
  ["associate", /(?<!\b(senior|sr\.?|snr)\s)\bassociates?\b(?!\s+(director|vice president|vp|manager|lead|partner|principal|professor|dean|general counsel))/i],
  ["apprentice", /\bapprentice(ship)?\b/i],
];

/** What the stored experienceLevel is worth on its own. */
const LEVEL_SCORE = {
  internship: 88,
  entry: 88,
  mid: 55,
  senior: 12,
  unspecified: NEUTRAL,
};

/**
 * Reads the years of experience a description demands.
 *
 * Returns the LARGEST number asked for, because a posting saying "3-8 years"
 * is an eight-year job advertised optimistically. Only matches where a number
 * sits next to a years-of-experience phrase, so a line like "founded 10 years
 * ago" is ignored.
 */
function yearsRequired(text) {
  if (!text) return null;

  const patterns = [
    /(\d{1,2})\s*(?:\+|plus)?\s*(?:-|to|–)?\s*(\d{1,2})?\s*(?:\+)?\s*(?:years?|yrs?)\b[^.]{0,30}?\b(?:experience|exp\b|working|industry|relevant|hands[\s-]on)/gi,
    /\b(?:experience|exp)\b[^.]{0,30}?(\d{1,2})\s*(?:\+|plus)?\s*(?:-|to|–)?\s*(\d{1,2})?\s*(?:\+)?\s*(?:years?|yrs?)\b/gi,
  ];

  let max = null;
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      for (const group of [match[1], match[2]]) {
        const n = Number.parseInt(group, 10);
        if (Number.isFinite(n) && n <= 40 && (max === null || n > max)) max = n;
      }
    }
  }
  return max;
}

/** Phrases that say "we will take somebody who has not done this before". */
const FRESHER_TEXT = [
  ["open to freshers", /\bfresher'?s?\b|\bno prior experience\b|\bno experience (required|necessary)\b/i],
  ["0-2 years", /\b0\s*[-–to]+\s*[12]\s*(years?|yrs?)\b|\bzero to (one|two)\b/i],
  ["recent graduates", /\brecent (graduates?|grads?)\b|\bfinal[\s-]year\b|\bcampus\b/i],
  ["training provided", /\btraining (will be )?provided\b|\bwe will train\b|\bmentorship provided\b/i],
];

/**
 * Can this student realistically get it?
 *
 * The stored experienceLevel is the starting point, the title overrides it
 * where the two disagree (a title is rarely wrong about seniority), and the
 * years the description asks for moves it last.
 */
function scoreAchievability({ title = "", description = "", experienceLevel } = {}) {
  const titleText = toText(title);
  const bodyText = toText(description);
  const reasons = [];

  let score = LEVEL_SCORE[experienceLevel] ?? NEUTRAL;

  const junior = JUNIOR_TITLE.find(([, pattern]) => pattern.test(titleText));
  const senior = SENIOR_TITLE.find(([, pattern]) => pattern.test(titleText));

  if (junior) {
    // Wins outright, even when a senior word also appears in the title.
    score = Math.max(score, 88);
    reasons.push(junior[0]);
  } else if (senior) {
    score = Math.min(score, senior[0] === "vp" || senior[0] === "head" ? 5 : 18);
    reasons.push(`${senior[0]} role`);
  }

  const years = yearsRequired(bodyText);
  if (years !== null) {
    if (years <= 2) {
      score += 12;
      reasons.push(`${years} years asked`);
    } else if (years <= 4) {
      score -= 10;
      reasons.push(`${years} years asked`);
    } else {
      // 5+ years is the line the brief drew, and it is a hard one: nothing a
      // six-week programme does substitutes for it.
      score -= 34;
      reasons.push(`${years}+ years asked`);
    }
  }

  if (!junior) {
    const fresher = FRESHER_TEXT.find(([, pattern]) => pattern.test(bodyText));
    if (fresher) {
      score += 18;
      reasons.push(fresher[0]);
    }
  }

  return { score: clamp(score), reasons };
}

/* ------------------------------------------------------------------ *
 * 2. India fit
 * ------------------------------------------------------------------ */

/** The cities worth naming back to a student, so a reason reads like a place. */
const INDIA_CITIES = [
  ["Bengaluru", /\b(bengaluru|bangalore|blr)\b/i],
  ["Hyderabad", /\bhyderabad\b|\bsecunderabad\b/i],
  ["Pune", /\bpune\b/i],
  ["Chennai", /\bchennai\b|\bmadras\b/i],
  ["Mumbai", /\bmumbai\b|\bbombay\b|\bnavi mumbai\b|\bthane\b/i],
  ["Delhi NCR", /\b(new )?delhi\b|\bncr\b|\bdelhi[\s-]ncr\b/i],
  ["Gurugram", /\bgurugram\b|\bgurgaon\b/i],
  ["Noida", /\bnoida\b|\bgreater noida\b/i],
  ["Kolkata", /\bkolkata\b|\bcalcutta\b/i],
  ["Ahmedabad", /\bahmedabad\b|\bgandhinagar\b/i],
  ["Kochi", /\bkochi\b|\bcochin\b|\bernakulam\b|\btrivandrum\b|\bthiruvananthapuram\b/i],
  ["Jaipur", /\bjaipur\b/i],
  ["Indore", /\bindore\b/i],
  ["Coimbatore", /\bcoimbatore\b/i],
  ["Chandigarh", /\bchandigarh\b|\bmohali\b/i],
  ["Bhubaneswar", /\bbhubaneswar\b/i],
  ["Nagpur", /\bnagpur\b/i],
  ["Vadodara", /\bvadodara\b|\bbaroda\b|\bsurat\b/i],
];

/** A remote posting that says, in so many words, that India is in scope. */
const HIRES_FROM_INDIA =
  /\b(remote[\s,-]*(in|from|within)?\s*india|india[\s,-]*(based|remote)|anywhere in india|pan[\s-]india|work from home[\s,-]*india|ist\b|indian standard time)\b/i;

/**
 * Geography that closes the door. A role open only to people who can already
 * work in the US or EU is not a role an Indian student can apply for, however
 * remote it says it is.
 */
const FOREIGN_WORK_GATE = [
  [
    "US work authorization",
    /\b(us|u\.s\.|united states)\s*(work\s*)?(authoriz|authoris|work permit|work eligib)\w*\b|\bauthoriz(ed|ation) to work in the (us|united states)\b|\bmust be (a )?(us|u\.s\.) (citizen|person)\b|\bgreen card\b|\bh1[\s-]?b\b|\bw2\b/i,
  ],
  ["security clearance", /\bsecurity clearance\b|\btop secret\b|\bts\/sci\b|\bpolygraph\b|\bcleared\b/i],
  [
    "EU/UK work permit",
    /\b(eu|uk|european union)\s*(work\s*)?(permit|visa|authoris|authoriz|right to work)\w*\b|\bright to work in the (uk|eu)\b|\bsettled status\b/i,
  ],
  ["no visa sponsorship", /\b(no|not|cannot|unable to) (provide |offer )?(visa )?sponsor(ship)?\b|\bsponsorship is not\b/i],
  [
    "region-locked remote",
    /\bremote\s*\(?(us|usa|united states|uk|eu|emea|americas|canada)[\s)]*only\b|\b(us|usa|uk|eu|canada)[\s-]only\b|\bmust (reside|be located|be based) in the (us|uk|eu|united states)\b/i,
  ],
];

/**
 * Is this job open to a student sitting in India?
 *
 * The order matters. A visa gate is checked last and overrides everything,
 * because "Remote" plus "must be authorized to work in the US" is a posting
 * that looks open and is not.
 */
function scoreIndiaFit({ country, location = "", isRemote = false, title = "", description = "" } = {}) {
  const placeText = toText(location, title);
  const bodyText = toText(description);
  const reasons = [];

  let score;

  const city = INDIA_CITIES.find(([, pattern]) => pattern.test(placeText));

  if (country === "India") {
    score = 92;
    reasons.push(city ? city[0] : "India");
  } else if (isRemote && HIRES_FROM_INDIA.test(`${placeText} ${bodyText}`)) {
    // Remote and it says India out loud. Better than an Indian office job for
    // a student who does not live in a metro.
    score = 86;
    reasons.push("remote, hires from India");
  } else if (isRemote) {
    // Remote with nothing said either way. Worth something, because plenty of
    // these do hire globally, but it is a maybe rather than a yes.
    score = 48;
    reasons.push("remote, location unstated");
  } else {
    score = 12;
    reasons.push("onsite, outside India");
  }

  for (const [label, pattern] of FOREIGN_WORK_GATE) {
    if (pattern.test(bodyText) || pattern.test(placeText)) {
      // Never applied to a job physically in India: an Indian posting that
      // mentions US clients, or a Bengaluru role at a cleared US defence
      // contractor, is still a job in Bengaluru.
      if (country === "India") break;
      score = Math.min(score, 8);
      reasons.push(`needs ${label}`);
      break;
    }
  }

  return { score: clamp(score), reasons };
}

/* ------------------------------------------------------------------ *
 * 3. Ease of applying
 * ------------------------------------------------------------------ */

/**
 * Sources whose URL is the employer's own application form. One click, one
 * form, no aggregator in between and no account to create.
 */
const DIRECT_APPLY_SOURCES = new Set(["greenhouse", "lever", "ashby", "weworkremotely", "remoteok"]);

/** Sources that put a wall, a login or a redirect between the student and the form. */
const AGGREGATOR_SOURCES = new Set(["linkedin", "indeed", "ambitionbox", "instahyre", "jobicy", "arbeitnow"]);

/** Hurdles a student has to clear before anyone reads their name. */
const APPLICATION_FRICTION = [
  ["take-home assignment", /\btake[\s-]?home\b|\bassignment round\b|\bunpaid (task|assignment|project)\b|\bsample (task|project) (will be|is) (given|shared)\b/i],
  ["coding test", /\b(coding|technical|online|aptitude) (test|assessment|challenge|round)\b|\bhackerrank\b|\bcodility\b|\bhackerearth\b|\bleetcode\b/i],
  ["multi-round process", /\b([4-9]|ten|five|six|seven|eight|nine)\s*(rounds?|stage)\b|\bmultiple rounds\b|\b(four|five|six)[\s-]stage\b/i],
  ["cover letter required", /\bcover letter is (required|mandatory)\b|\bmust (include|submit) a cover letter\b/i],
  ["portfolio required", /\bportfolio is (required|mandatory)\b|\bmust (have|submit) a portfolio\b/i],
];

/**
 * Degree gates. These are the ones that rule a student out on paper before
 * anything they built gets looked at, which is the opposite of what this
 * programme is for.
 */
const DEGREE_GATE = [
  ["tier-1 college only", /\b(iit|nit|iiit|bits|iim)\b[^.]{0,40}\b(only|preferred|mandatory|graduates? only)\b|\btier[\s-]?1 (college|institute)\b|\bpremier institute\b/i],
  ["Master's required", /\b(master'?s|m\.?tech|m\.?s\.?|mba)\b[^.]{0,25}\b(required|mandatory|must)\b|\bmust (have|hold) a master'?s\b/i],
  ["PhD required", /\bph\.?d\.?\b[^.]{0,25}\b(required|mandatory|must)\b|\bmust (have|hold) a ph\.?d\b/i],
  ["degree mandatory", /\b(b\.?tech|b\.?e\.?|bachelor'?s|degree)\b[^.]{0,20}\b(is )?(mandatory|compulsory|strictly required)\b/i],
];

/** Phrases that say the application itself is short. */
const EASY_SIGNALS = [
  ["quick apply", /\b(easy|quick|one[\s-]click|1[\s-]click) apply\b|\bapply in (under )?\d+ (seconds|minutes)\b/i],
  ["no cover letter", /\bno cover letter\b|\bcover letter (is )?(not required|optional)\b/i],
  ["portfolio over degree", /\bno degree (required|needed)\b|\bdegree (is )?not required\b|\bskills over (degrees|credentials)\b/i],
];

/** How much work is it to actually apply? */
function scoreEaseOfApply({ url = "", source = "", description = "" } = {}) {
  const bodyText = toText(description);
  const reasons = [];

  let score = NEUTRAL;

  if (DIRECT_APPLY_SOURCES.has(source)) {
    score += 28;
    reasons.push("direct apply");
  } else if (AGGREGATOR_SOURCES.has(source)) {
    score += 4;
  }

  // A posting with no link is one nobody can apply to at all, whatever else
  // it says. This is the one signal that does not depend on the description.
  if (!url) {
    return { score: 0, reasons: ["no apply link"] };
  }

  for (const [label, pattern] of APPLICATION_FRICTION) {
    if (pattern.test(bodyText)) {
      score -= 16;
      reasons.push(label);
    }
  }

  for (const [label, pattern] of DEGREE_GATE) {
    if (pattern.test(bodyText)) {
      score -= 22;
      reasons.push(label);
    }
  }

  for (const [label, pattern] of EASY_SIGNALS) {
    if (pattern.test(bodyText)) {
      score += 10;
      reasons.push(label);
    }
  }

  return { score: clamp(score), reasons };
}

/* ------------------------------------------------------------------ *
 * The combined score
 * ------------------------------------------------------------------ */

/**
 * Weighted sum of the four parts, damped when the job is off-topic.
 *
 * Exported so scripts/backfillRankScore.js recombines exactly the same way
 * after a weight change.
 */
function combineRank({ achievability = 0, indiaFit = 0, easeOfApply = 0, relevance = 0 } = {}) {
  const weighted =
    achievability * RANK_WEIGHTS.achievability +
    indiaFit * RANK_WEIGHTS.indiaFit +
    easeOfApply * RANK_WEIGHTS.easeOfApply +
    relevance * RANK_WEIGHTS.relevance;

  // See OFF_TOPIC_DAMPING. A reachable job with nothing to do with the course
  // is still not a job to put on page one of this board.
  const damping = relevance < OFF_TOPIC_DAMPING.threshold ? OFF_TOPIC_DAMPING.multiplier : 1;

  return clamp(weighted * damping);
}

/** How many reasons a job carries. Enough to explain a position, few enough to read. */
const MAX_REASONS = 6;

/**
 * Scores one job on all four axes and returns them plus the reasons.
 *
 * `relevance` and `matchedSkills` are computed by pipeline/syllabus.js and
 * passed in rather than recomputed, so there is one definition of each score.
 */
function scoreJobRank(job = {}) {
  const achievability = scoreAchievability(job);
  const indiaFit = scoreIndiaFit(job);
  const easeOfApply = scoreEaseOfApply(job);

  const relevance = Number.isFinite(job.relevance) ? job.relevance : 0;

  const rankScore = combineRank({
    achievability: achievability.score,
    indiaFit: indiaFit.score,
    easeOfApply: easeOfApply.score,
    relevance,
  });

  // Ordered the way the weights are: what they can get, where it is, how hard
  // it is to apply, and last what it has to do with the course.
  const skill = Array.isArray(job.matchedSkills) ? job.matchedSkills[0] : null;
  const reasons = [
    ...achievability.reasons,
    ...indiaFit.reasons,
    ...easeOfApply.reasons,
    ...(skill ? [`matches ${skill}`] : []),
  ];

  return {
    achievability: achievability.score,
    indiaFit: indiaFit.score,
    easeOfApply: easeOfApply.score,
    rankScore,
    rankReasons: [...new Set(reasons)].slice(0, MAX_REASONS),
  };
}

module.exports = {
  RANK_WEIGHTS,
  OFF_TOPIC_DAMPING,
  SENIOR_TITLE,
  JUNIOR_TITLE,
  INDIA_CITIES,
  FOREIGN_WORK_GATE,
  APPLICATION_FRICTION,
  DEGREE_GATE,
  DIRECT_APPLY_SOURCES,
  AGGREGATOR_SOURCES,
  LEVEL_SCORE,
  MAX_REASONS,
  yearsRequired,
  scoreAchievability,
  scoreIndiaFit,
  scoreEaseOfApply,
  combineRank,
  scoreJobRank,
};
