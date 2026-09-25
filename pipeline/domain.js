/**
 * Files a job under a domain: the function it does, which is how people look
 * for work. See DOMAINS in pipeline/taxonomy.js for the list and why it sits
 * beside roleCategory rather than replacing it.
 *
 * Reads the TITLE and the stored roleCategory only - never the description.
 * Two reasons. A job's function is in its title almost every time, whereas a
 * description mentions every department the company has. And both inputs are
 * stored, so scripts/backfillDomain.js recomputes every row exactly instead of
 * approximating from a description it no longer has.
 *
 * FIRST MATCH WINS, so the order below is the logic. The comment on each rule
 * says what it has to beat.
 *
 * ON WRITING PATTERNS HERE. Every pattern is a literal. A backslash-b written
 * through a template literal is the backspace byte rather than a word
 * boundary, and that mistake once disabled a whole scoring list in this repo.
 * test/domain.test.js asserts no control byte survives in this file.
 */

"use strict";

const RULES = [
  // Before everything, because the titles are short and borrow other words:
  // "Founder's Office - Growth" is not a marketing job, and "Chief of Staff"
  // would otherwise fall through to Operations.
  [
    "founders-office",
    /\bfounder'?s?['’]?\s*office\b|\boffice of the (ceo|founder|md)\b|\bchief of staff\b|\bbiz\s?ops\b|\bbusiness operations\b|\bstrategy\s*(&|and)\s*operations\b|\b(strategy|strategic)\s+(associate|analyst|manager|consultant|lead|intern|initiatives)\b|\bmanagement consult\w*\b|\bentrepreneur in residence\b|\bgrowth\s*(&|and)\s*strategy\b|\bcorporate development\b/i,
  ],

  // Before Software, which would claim "Automation Engineer", and before
  // Content and Design, which would claim "AI Content Creator". QA and test
  // automation are excluded here - they are software testing, not the
  // generalist work this domain is for.
  [
    "ai-generalist",
    /\bai\s+(generalist|consultant|strategist|operator|trainer|tutor|evaluator|annotator|specialist|enablement|adoption|transformation|operations|ops|implementation|champion|analyst)\b|\bprompt\s+(engineer|designer|writer|specialist)\w*\b|\b(data|ai)\s+(annotat|label)\w*\b|\brlhf\b|\b(workflow|process|business|marketing)\s+automation\b|\b(?<!(qa|test|testing|quality)\s)automation\s+(specialist|consultant|analyst|developer|lead|intern|engineer)\b|\bno[\s-]?code\b|\blow[\s-]?code\b|\bforward[\s-]deployed\b|\bconversation(al)?\s+designer\b|\bsearch quality rater\b|\bmodel evaluator\b/i,
  ],

  // Before Product, so "Product Designer" is design work, and before Content,
  // so "Video Editor" does not fall to the bare word "editor".
  [
    "design",
    /\b(ui|ux|ui\/ux|ux\/ui|product|graphic|visual|web|motion|brand|interaction|game|3d|instructional)\s*designer\b|\bdesigner\b|\bui\s*\/?\s*ux\b|\bvideo\s*(editor|editing|creator|producer)\b|\bvideographer\b|\banimat(or|ion)\b|\bmotion graphics\b|\billustrat(or|ion)\b|\b3d\s+(artist|modell?er)\b|\bvfx\b|\bphotograph(er|y)\b|\b(art|creative)\s+director\b|\bthumbnail\b/i,
  ],

  // Before Marketing, which would claim "Content Marketing Writer".
  [
    "content",
    /\bcontent\s+(writer|creator|strategist|editor|developer|specialist|lead|manager|writing|intern)\b|\bcopy\s?writ\w*\b|\btechnical\s+writ\w*\b|\bghost\s?writ\w*\b|\bscript\s?writ\w*\b|\bjournalist\b|\breporter\b|\btranslat(or|ion)\b|\btranscri(ber|ption)\w*\b|\bproof\s?read\w*\b|\bblogger\b|\bugc\b|\beditor\b|\bwriter\b/i,
  ],

  // Before Product, so "Product Marketing Manager" lands in marketing.
  [
    "marketing",
    /\bmarketing\b|\bmarketer\b|\bseo\b|\bsem\b|\bppc\b|\bsocial media\b|\bgrowth\s+(hacker|lead|manager|associate|analyst|intern|marketer)\b|\bhead of growth\b|\bperformance\s+(marketer|manager|specialist)\b|\bbrand\s+(manager|strategist|associate|executive)\b|\bcommunity\s+(manager|lead|associate)\b|\binfluencer\b|\bmedia\s+(buyer|planner)\b|\bpublic relations\b|\b(pr|communications)\s+(manager|executive|associate|specialist)\b|\bevents?\s+(manager|coordinator|executive|marketing|specialist)\b/i,
  ],

  [
    "product",
    /\bproduct\s+(manager|owner|lead|analyst|management|intern|associate|specialist|head|director|strategy|operations|expert)\b|\bapm\b|\bassociate product manager\b|\bhead of product\b|\bproduct ops\b/i,
  ],

  // Before Data and Software, both of which it overlaps: "Data Scientist" is
  // ML work, and "AI Software Engineer" is AI engineering rather than generic
  // software.
  [
    "ai-ml",
    /\bmachine learning\b|\bml\s*(engineer|ops|scientist|developer|intern)\b|\bmlops\b|\bdata scien(tist|ce)\b|\bdeep learning\b|\bnlp\b|\bcomputer vision\b|\bllms?\b|\bgen(erative)?\s?ai\b|\bai\s*\/\s*ml\b|\bai\s+(engineer|developer|researcher|scientist|architect|intern|engineering)\b|\bai\s+(software|platform|infrastructure|backend|full[\s-]?stack|application|applications|product)\s+(engineer|developer)\b|\bapplied\s+(scientist|ai)\b|\bresearch\s+(scientist|engineer)\b|\bagentic\b|\bai\s+agents?\b|\bartificial intelligence\b/i,
  ],

  [
    "data",
    /\bbig data\b|\bdata\s+(analyst|analytics|engineer|engineering|visuali[sz]\w*|architect|warehouse|manager|lead|governance|quality|steward|platform)\b|\bbusiness\s+(analyst|intelligence)\b|\bbi\s+(developer|analyst|engineer)\b|\banalytics\b|\b(power bi|tableau|looker)\b|\bmis\s+(executive|analyst)\b|\breporting\s+analyst\b|\bsql\s+(developer|analyst)\b|\bquantitative analyst\b/i,
  ],

  // Before Software, so "Sales Engineer" and "Customer Success Engineer" are
  // filed by who they serve. `\bsales\b` does not match "Salesforce", so a
  // Salesforce developer still reaches Software.
  [
    "sales",
    /\bsales\b|\bbusiness development\b|\b(bdr|sdr|bde|bdm)\b|\baccount\s+(executive|manager|director)s?\b|\bkey account\b|\b(customer|client)\s+(success|support|service|care|experience|relationship|onboarding)\b|\bcontact\s+cent(re|er)\b|\bsupport\s+(executive|associate|agent|representative|specialist|assistant)\b|\bpartnerships?\b|\bgtm\b|\bgo[\s-]to[\s-]market\b|\bsolutions?\s+(consultant|specialist)\b|\brelationship\s+(manager|executive|officer)\b|\bpartnerships?\s+(manager|lead|associate|executive)\b|\bpre[\s-]?sales\b|\btele\s?(caller|sales|marketing)\b|\bclient\s+(servic\w*|relations?)\b|\bcall centre\b|\bcall center\b/i,
  ],

  [
    "software",
    /\bsoftware\b|\bfull[\s-]?stack\b|\bfront[\s-]?end\b|\bback[\s-]?end\b|\bweb\s+developer\b|\b(mobile|android|ios|flutter|react native)\s+(developer|engineer)\b|\bdev\s?ops\b|\bsre\b|\bsite reliability\b|\bcloud\s+(engineer|architect|developer)\b|\b(qa|test|testing|quality)\s+(engineer|analyst|automation|lead)\b|\bsdet\b|\bsecurity\s+(engineer|analyst|architect|specialist|consultant|operations)\b|\bcyber\s?security\b|\bthreat intelligence\b|\bsoc\s+analyst\b|\berp\b|\bembedded\b|\bfirmware\b|\bplatform engineer\b|\bprogrammer\b|\bcoder\b|\bdeveloper\b|\bengineer(ing)?\b|\bwordpress\b|\bshopify\b|\bblockchain\b|\bsalesforce\b|\bsap\b/i,
  ],

  // The specific operations functions - HR, finance, legal, supply chain.
  // Checked BEFORE the two generic rules below, so "Tax Consultant" is
  // finance before it is consulting and "Financial Analyst" is finance before
  // it is analytics.
  [
    "operations",
    /\bhr\b|\bhuman resources\b|\brecruit(er|ing|ment)\b|\btalent\s+(acquisition|partner)\b|\bpeople\s+(ops|operations|partner)\b|\bfinanc(e|ial)\b|\baccount(ant|ing|s)\b|\baudit\w*\b|\btax\b|\bpayroll\b|\blegal\b|\bcounsel\b|\bcompliance\b|\badmin\w*\b|\boperations\b|\bsupply chain\b|\blogistics\b|\bprocurement\b|\bpurchas\w*\b|\b(executive|virtual|personal)\s+assistant\b|\bdata entry\b|\b(project|program|programme)\s+manager\b|\boffice\s+(manager|assistant|coordinator)\b/i,
  ],

  // Generic consulting and strategy titles. LATE on purpose: placed up with
  // the specific Founder's Office rule, a bare "consultant" would have claimed
  // "AI Consultant" from the AI domain and "SAP Consultant" from Software. By
  // here everything with a more specific function has already gone.
  // Measured: ~480 stored titles are a bare "Consultant" of some kind.
  ["founders-office", /\bconsult(ant|ing)\b|\badvis[oe]r\b|\bstrateg(y|ist|ic)\b/i],

  // A bare "Analyst" with no function attached - ~475 stored titles. Data and
  // Analytics is the closest home for the work they share.
  ["data", /\banalyst\b|\banalysis\b/i],
];

/**
 * Where a title nothing matched falls, by the category the classifier gave
 * it. Every stored job has a category, so every stored job gets a domain -
 * the board never shows a listing that no domain filter can reach.
 */
const CATEGORY_FALLBACK = {
  "AI-Tech": "ai-ml",
  "AI-NonTech": "ai-generalist",
  Tech: "software",
  Creative: "design",
  Marketing: "marketing",
  Writing: "content",
  Business: "operations",
};

/** Used when there is neither a title match nor a category. */
const DEFAULT_DOMAIN = "operations";

function classifyDomain(titleText, roleCategory) {
  const title = typeof titleText === "string" ? titleText : "";

  for (const [domain, pattern] of RULES) {
    if (pattern.test(title)) return domain;
  }

  return CATEGORY_FALLBACK[roleCategory] || DEFAULT_DOMAIN;
}

module.exports = { classifyDomain, RULES, CATEGORY_FALLBACK, DEFAULT_DOMAIN };
