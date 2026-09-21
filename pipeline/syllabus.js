/**
 * What Menler actually teaches, written down as something a job can be
 * matched against.
 *
 * WHY THIS FILE EXISTS. The board used to rank on whether a title said "AI".
 * That is a keyword match, not a skill match, and it put "VP, Distinguished
 * Engineer of Generative AI" on page one while "Claude MCP / AI Automation
 * Developer" sat at position 33. Both mention AI. Only one is a job a Menler
 * graduate can actually do.
 *
 * So the vocabulary below is not a general AI word list. It is transcribed
 * from the two real curricula in menler-lms/server/scripts/curricula.js - the
 * AI Kickstarter (4 sessions) and the Claude-First AI Generalist Fellowship
 * (6 weeks) - and every band notes the session or week it comes from. When
 * the syllabus changes, this file changes with it and the ranking follows.
 * That traceability is the point: "why is this job ranked here" should be
 * answerable from the curriculum, not from a regex someone tuned by feel.
 *
 * Skeo shares the ranking. Its board is broader, and a syllabus-matched
 * ordering is no worse for it - an AI operator role is a reasonable thing to
 * show first on either board.
 *
 * ON WRITING PATTERNS HERE. Every pattern is a literal in this file, never
 * built by concatenation or a template literal. A backslash-b inside a
 * template literal is the backspace control character, not a word boundary,
 * and that exact mistake once silently disabled every pattern in the old
 * scoring list for a full release. test/taxonomy.test.js asserts that no
 * control character survives in this file.
 */

"use strict";

/* ------------------------------------------------------------------ *
 * The spine: Claude itself
 * ------------------------------------------------------------------ *
 * Kickstarter S01-S04 and Fellowship weeks 2, 4 and 5 are all Claude-first.
 * A job naming Claude, or the Claude surfaces the programme drills - MCP,
 * Projects, Skills, Connectors, Schedules, Routines, Artifacts - is the
 * closest thing to a direct hit this board can produce.
 */
const CORE = [
  ["claude", /\bclaude\b/i],
  ["claude code", /\bclaude[\s-]?code\b/i],
  ["mcp", /\bmcps?\b|\bmodel context protocol\b/i],
  ["prompt engineering", /\bprompt[\s-]?(engineer|engineering|design)\w*\b/i],
  ["ai agents", /\bai\s+agents?\b|\bagent(ic)?\s+(workflow|system|app)\w*\b/i],
  ["anthropic", /\banthropic\b/i],
];

/* ------------------------------------------------------------------ *
 * The named tools the programme puts in students' hands
 * ------------------------------------------------------------------ *
 * Fellowship W3 (creative studio), W4 (voice and automation), W5
 * (vibecoding); Kickstarter 2.4 (research stack), 3.4 (external automation),
 * 4.1 (build). These are the words an employer uses when they want an
 * operator rather than an engineer.
 */
const TOOLS = [
  // Automation at scale - Kickstarter 3.4, Fellowship W4 S2
  ["n8n", /\bn8n\b/i],
  ["zapier", /\bzapier\b/i],
  ["make.com", /\bmake\.com\b|\bintegromat\b/i],
  ["airtable", /\bairtable\b/i],
  // "Notion" the tool, not "the notion that...". An article in front of it
  // means it is being used as an ordinary English noun, which happens often
  // enough in job-description prose to matter.
  ["notion", /(?<!\b(the|a|any|no|this|that|some|whatever)\s)\bnotion\b/i],

  // Vibecoding and agentic apps - Kickstarter 4.1, Fellowship W5 S1
  ["lovable", /\blovable\b/i],
  ["bolt.new", /\bbolt\.new\b/i],
  ["replit", /\breplit\b/i],
  ["cursor ai", /\bcursor\s*(ai|ide)\b/i],
  ["v0.dev", /\bv0\.dev\b/i],
  ["supabase", /\bsupabase\b/i],

  // Voice agents - Fellowship W4 S1
  ["elevenlabs", /\beleven\s?labs\b/i],
  ["vapi", /\bvapi\b/i],
  ["retell ai", /\bretell\s?ai\b/i],
  ["bland ai", /\bbland\s?ai\b/i],
  ["deepgram", /\bdeepgram\b/i],
  ["whisper", /\bwhisper\b/i],
  ["assemblyai", /\bassembly\s?ai\b/i],

  // AI creative studio - Kickstarter 2.5, Fellowship W3 S2
  ["midjourney", /\bmidjourney\b/i],
  ["dall-e", /\bdall[\s.-]?e\b/i],
  ["firefly", /\bfirefly\b/i],
  ["ideogram", /\bideogram\b/i],
  // Requires the product name. Bare "runway" is how every funded startup
  // describes its cash position ("18 months of runway"), and it is a fashion
  // term besides - both far more common in these feeds than the video tool.
  ["runway ml", /\brunway\s?(ml|gen-?\d)\b/i],
  ["kling ai", /\bkling\s?ai\b/i],
  ["suno", /\bsuno\b/i],
  ["canva", /\bcanva\b/i],

  // Research stack - Kickstarter 2.4, Fellowship W1
  ["perplexity", /\bperplexity\b/i],
  ["notebooklm", /\bnotebook\s?lm\b/i],
  ["gamma.app", /\bgamma\.app\b/i],

  // The general assistants the programme compares Claude against
  ["chatgpt", /\bchat\s?gpt\b|\bgpt-?[45]\w*\b|\bopenai\b/i],
  ["gemini", /\bgemini\b/i],
  ["copilot", /\bcopilot\b/i],
  ["hugging face", /\bhugging\s?face\b/i],
];

/* ------------------------------------------------------------------ *
 * The shape of the job the programme produces
 * ------------------------------------------------------------------ *
 * Kickstarter 4.4 ("AI-Native Career Positioning") and the Fellowship
 * milestones describe an operator: someone who applies AI across a business,
 * automates their own work and ships small tools. That role is advertised
 * under a dozen different titles, so it is matched by shape, not by name.
 */
const SHAPE = [
  ["ai generalist", /\bai\s+(generalist|consultant|specialist|strategist|operator)\b/i],
  [
    "automation specialist",
    /\b(automation|workflow)s?\s+(specialist|engineer|consultant|manager|analyst|architect|developer)\b/i,
  ],
  ["workflow automation", /\b(workflow|process|business)\s+automation\b/i],
  ["no-code", /\bno[\s-]?code\b|\blow[\s-]?code\b/i],
  ["ai operations", /\bai\s+(ops|operations|enablement|adoption|transformation)\b/i],
  ["forward-deployed", /\bforward[\s-]deployed\b/i],
  ["solutions engineer", /\b(solutions?|implementation|deployment)\s+(engineer|architect|consultant)\b/i],
  ["voice agent", /\bvoice\s+(agent|ai|bot|assistant)\b|\bconversational\s+ai\b/i],
  ["vibecoding", /\bvibe[\s-]?cod\w*\b/i],
  ["ai content", /\bai\s+(content|creative|video|design|marketing)\b/i],
  ["internal tools", /\binternal\s+tools?\b|\bcitizen\s+developer\b/i],
];

/* ------------------------------------------------------------------ *
 * Adjacent: AI-flavoured, but not what is taught
 * ------------------------------------------------------------------ *
 * "Generative AI", "LLM" and "machine learning" in a title say the job is
 * near this world without saying a graduate could do it. Worth a little -
 * which is the correction. These used to be worth as much as naming Claude,
 * and they are roughly twenty times more common.
 */
const ADJACENT = [
  ["generative ai", /\bgen(erative)?\s?ai\b/i],
  ["llm", /\bllms?\b|\blarge language models?\b/i],
  ["rag", /\brag\b|\bretrieval[\s-]augmented\b/i],
  ["machine learning", /\bmachine learning\b|\bdeep learning\b/i],
  ["data analysis", /\bdata\s+(analyst|analysis|analytics)\b/i],
  ["fine-tuning", /\bfine[\s-]?tun\w*\b/i],
];

/* ------------------------------------------------------------------ *
 * Out of reach: seniority the programme does not bridge
 * ------------------------------------------------------------------ *
 * Menler is a two-weekend or six-week programme. It does not make anyone a
 * Vice President of Engineering. These titles were crowding the top purely
 * because senior AI roles say "AI" the loudest.
 */
const SENIORITY = [
  ["executive", /\b(vp|vice president|svp|evp|chief|cto|cio|head of)\b/i],
  // "Director" is an org rank except in the creative trades, where Art
  // Director and Creative Director are ordinary career titles - and the
  // syllabus teaches creative direction (Fellowship W3), so burying them
  // would be exactly backwards. The lookbehind exempts those.
  ["director", /(?<!\b(art|creative|casting|music|photography|technical|design)\s)\bdirectors?\b/i],
  ["principal", /\b(principal|distinguished|staff|fellow)\s+(engineer|scientist|architect|developer|manager)\b/i],
  ["many years", /\b([89]|1[0-9])\+?\s*(years|yrs)\b/i],
];

/* ------------------------------------------------------------------ *
 * Out of scope: depth the programme does not teach
 * ------------------------------------------------------------------ *
 * The syllabus is explicit that Claude reads and reasons rather than computes
 * (Kickstarter 3.3) and that building means vibecoding (4.1). It never trains
 * a model, writes a CUDA kernel or runs a cluster. A job needing those is AI
 * work a graduate cannot take.
 */
const DEEP_SPECIALIST = [
  ["research", /\bresearch\s+(scientist|engineer)\b|\bphd\b|\bpost[\s-]?doc\b/i],
  ["ml infrastructure", /\b(pytorch|tensorflow|cuda|kubernetes|kubeflow|mlops|airflow|spark|hadoop)\b/i],
  ["model training", /\b(model|pre)[\s-]?training\b|\bmodel development\b/i],
  ["specialist ml", /\bcomputer vision\b|\bnlp engineer\b|\brobotics\b|\bquantitative research\b/i],
];

/**
 * The positive bands, in the order they are checked.
 *
 * `title` is what a hit in the job title is worth; `text` what the same hit
 * in the description is worth. The gap is deliberate and large: a title is
 * what the employer chose to call the job, whereas almost every description
 * mentions AI somewhere.
 */
const BANDS = [
  { key: "core", terms: CORE, title: 30, text: 15 },
  { key: "shape", terms: SHAPE, title: 24, text: 11 },
  { key: "tool", terms: TOOLS, title: 18, text: 9 },
  { key: "adjacent", terms: ADJACENT, title: 10, text: 3 },
];

/**
 * How much a role's own category is worth before any evidence.
 *
 * AI-NonTech sits marginally above AI-Tech on purpose. The Kickstarter is
 * explicitly a no-code programme and the Fellowship's building is vibecoding,
 * so operator roles are the closer fit - the engineering ones want a software
 * background the syllabus does not supply.
 */
const CATEGORY_BASE = {
  "AI-NonTech": 32,
  "AI-Tech": 30,
  Tech: 14,
  Creative: 12,
  Marketing: 12,
  Writing: 12,
  Business: 6,
};

/**
 * Reachability. A graduate is looking for a first or second AI-adjacent role,
 * so an entry-level opening is worth more to them than a senior one with
 * otherwise identical wording.
 */
const LEVEL_ADJUSTMENT = {
  internship: 6,
  entry: 6,
  mid: 0,
  senior: -10,
  unspecified: 0,
};

/** A hit in a band the title already matched. */
const TITLE_PENALTY = 22;
/** The same signal found only in the description, where it is weaker evidence. */
const TEXT_PENALTY = 9;
/** However many warning signs a posting carries, it loses at most this much. */
const MAX_PENALTY = 34;

/**
 * Each further piece of evidence counts for less, so a description that lists
 * twenty tools cannot outscore a title that names one.
 */
const DECAY = [1, 0.6, 0.35, 0.2];

const decayAt = (index) => DECAY[index] ?? 0.1;

module.exports = {
  CORE,
  TOOLS,
  SHAPE,
  ADJACENT,
  SENIORITY,
  DEEP_SPECIALIST,
  BANDS,
  CATEGORY_BASE,
  LEVEL_ADJUSTMENT,
  TITLE_PENALTY,
  TEXT_PENALTY,
  MAX_PENALTY,
  decayAt,
};
