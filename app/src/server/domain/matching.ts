/**
 * Relevance matching.
 *
 * Pure, deterministic, and explainable -- no ML, no scoring magic (PRD §12, §19). Every decision
 * produces a human-readable reason so it can be audited in the UI, because the failure that
 * actually costs Sarthak a job is a role being silently filtered out.
 *
 * The rules are DATA, stored in `settings.match_rules`, not code. Retuning what counts as a match
 * requires no deploy and lets existing jobs be re-matched retroactively.
 *
 * Bias: false positives are cheap (one glance at the job board), false negatives are unrecoverable
 * (the role is gone). Where a rule is ambiguous, this engine keeps the job and explains why.
 */

// ---------------------------------------------------------------------------
// Rule configuration
// ---------------------------------------------------------------------------

export type TitleRule = {
  /** Case-insensitive regular expression, as a string so it can live in JSON. */
  pattern: string;
  score: number;
  label: string;
};

export type LocationRule = {
  name: string;
  /** 1 = most preferred. Drives ordering on the job board. */
  priority: number;
  score: number;
  aliases: string[];
};

export type MatchRules = {
  title: {
    include: TitleRule[];
    /**
     * Disqualifiers by *discipline* — sales, QA, security, hardware. These describe work Sarthak
     * does not want at any company, so a company override never lifts them.
     */
    exclude: string[];
    /**
     * Disqualifiers by *level* — senior, staff, principal, intern. These are the ones a company
     * override can lift, because job ladders are not comparable across companies: "Senior
     * Software Engineer" is the target level at Confluent while "Software Engineer III" is the
     * equivalent at Google. Optional so an older stored rule set still loads.
     */
    seniorityExclude?: string[];
  };
  experience: {
    /**
     * The band Sarthak is actually eligible for. A posting asking for anything inside
     * [idealMinYears, idealMaxYears] fits without penalty.
     */
    idealMinYears?: number;
    /** Requiring at most this many years scores full marks. */
    idealMaxYears: number;
    /**
     * Penalty per year *below* the band. A role asking for one year is not disqualifying with
     * three on the clock -- it is under-levelled, which is a ranking question, not a gate.
     */
    underLevelPenalty?: number;
    /** Requiring at least this many years is rejected outright. */
    hardRejectYears: number;
    /** Penalty per year above idealMaxYears, up to hardRejectYears. */
    penaltyPerYear: number;
    /** A description with no parseable requirement is kept, not dropped. */
    unknownPasses: boolean;
  };
  location: {
    allow: LocationRule[];
    /**
     * Checked BEFORE `allow`. Postings that name a country Sarthak cannot work in are rejected
     * even when they also say "Remote" -- live data showed "Italy, Remote", "Canada, Remote" and
     * "US, FL, Remote" all matching a naive remote alias.
     */
    reject: string[];
    /** A job with no location string is kept, not dropped. */
    unknownPasses: boolean;
  };
  /** Minimum total score to be considered relevant. */
  threshold: number;
};

/**
 * Per-company title overrides.
 *
 * A global rule cannot express a job ladder. Confluent calls Sarthak's level "Senior Software
 * Engineer"; Google calls it "Software Engineer III"; Amazon calls it "SDE II". Encoding that
 * per company is the only honest way to compare them, and it is data on the company row rather
 * than code, so adding a company's vocabulary needs no deploy.
 */
export type CompanyMatchOverrides = {
  /**
   * Titles that mean "this is my level, here". A match lifts the seniority exclusions for this
   * company only; discipline exclusions still apply, so "Senior Security Engineer" stays out
   * even at a company whose target level is "Senior Software Engineer".
   */
  levelTitles: string[];
  /** Score awarded when a level title matches. Defaults to the strongest include score. */
  score?: number;
};

/**
 * Sarthak's configuration: SDE-2 level, 3-4 years of experience, and four acceptable locations
 * ranked Bangalore > Gurgaon > Remote > Hyderabad.
 */
export const DEFAULT_MATCH_RULES: MatchRules = {
  title: {
    include: [
      // Explicit level-2 titles -- the strongest signal.
      { pattern: "software\\s+(development\\s+)?engineer\\s*(-|–)?\\s*(ii|2)\\b", score: 100, label: "Software Engineer II" },
      { pattern: "\\bsde\\s*(-|–)?\\s*(ii|2)\\b", score: 100, label: "SDE 2" },
      { pattern: "\\bswe\\s*(-|–)?\\s*(ii|2)\\b", score: 100, label: "SWE 2" },
      { pattern: "\\bengineer\\s*(-|–)?\\s*(ii|2)\\b", score: 90, label: "Engineer II" },
      { pattern: "\\bdeveloper\\s*(-|–)?\\s*(ii|2)\\b", score: 90, label: "Developer II" },
      // Company-specific level codes. Google uses L4 for SDE-2 equivalent; Meta uses E4.
      { pattern: "\\bl4\\b", score: 90, label: "L4 (Google SDE-2 equivalent)" },
      { pattern: "\\be4\\b", score: 85, label: "E4 (Meta SDE-2 equivalent)" },
      { pattern: "\\blevel\\s*4\\b", score: 85, label: "Level 4" },
      { pattern: "member\\s+of\\s+technical\\s+staff\\s*(-|–)?\\s*(ii|2)\\b", score: 90, label: "MTS 2" },
      { pattern: "\\bmts\\s*(-|–)?\\s*(ii|2)\\b", score: 90, label: "MTS 2" },
      // Unlevelled engineering titles. Common at startups and on Greenhouse/Lever boards,
      // where seniority lives in the description rather than the title.
      // Unanchored on purpose. Real postings almost always carry a qualifier -- "Software
      // Engineer, Linux Graphics", "System Software Engineer, Workflow Platform" -- and an
      // anchored ^...$ pattern silently rejected 194 of 1334 live postings during validation.
      { pattern: "\\bsoftware\\s+engineer\\b", score: 65, label: "Software Engineer (unlevelled)" },
      { pattern: "\\bbackend\\s+(software\\s+)?(engineer|developer)\\b", score: 65, label: "Backend Engineer" },
      { pattern: "\\bback[-\\s]?end\\s+(engineer|developer)\\b", score: 65, label: "Backend Engineer" },
      { pattern: "\\bfull[-\\s]?stack\\s+(engineer|developer)\\b", score: 60, label: "Full Stack Engineer" },
      { pattern: "\\b(platform|infrastructure|distributed\\s+systems)\\s+engineer\\b", score: 60, label: "Platform / Infra Engineer" },
      { pattern: "\\bmember\\s+of\\s+technical\\s+staff\\b", score: 60, label: "Member of Technical Staff" },
      { pattern: "\\bsoftware\\s+developer\\b", score: 60, label: "Software Developer" },
    ],
    // Level exclusions. These are the ones a company override can lift, because ladders are not
    // comparable across companies: "Senior Software Engineer" is Sarthak's level at Confluent
    // while "Software Engineer III" is the equivalent at Google. Everything in `exclude` below
    // is about the *discipline* and is never lifted.
    seniorityExclude: [
      // More senior than target.
      "\\bsenior\\b", "\\bsr\\.?\\b",
      // "Staff Engineer" is too senior, but "Member of Technical Staff" is the SDE-2 title at
      // several companies -- so exclude "staff" except where "technical" precedes it.
      "(?<!technical\\s)\\bstaff\\b",
      "\\bprincipal\\b", "\\blead\\b",
      "\\barchitect\\b", "\\bdistinguished\\b", "\\bfellow\\b", "\\bdirector\\b",
      "\\bmanager\\b", "\\bhead\\s+of\\b", "\\bvp\\b", "\\bvice\\s+president\\b",
      "\\b(iii|iv|v|vi)\\b", "\\bengineer\\s*(-|–)?\\s*[3-9]\\b",
      "\\bl[5-9]\\b", "\\be[5-9]\\b", "\\blevel\\s*[5-9]\\b",
      // More junior than target.
      "\\bintern\\b", "\\binternship\\b", "\\bapprentice\\b", "\\btrainee\\b",
      "\\bnew\\s+grad\\b", "\\bgraduate\\b", "\\bjunior\\b", "\\bjr\\.?\\b",
      "\\bentry[-\\s]?level\\b", "\\bsde\\s*(-|–)?\\s*(i|1)\\b", "\\bswe\\s*(-|–)?\\s*(i|1)\\b",
      "\\bengineer\\s*(-|–)?\\s*(i|1)\\b", "\\bl3\\b",
    ],
    exclude: [
      // Adjacent but not the target role.
      "\\bsdet\\b", "\\btest\\s+engineer\\b", "\\bqa\\b", "\\bsupport\\s+engineer\\b",
      // "Quality Assurance Software Developer Engineer in Test" slipped past \bsdet\b in live data.
      "\\bengineer\\s+in\\s+test\\b", "\\bquality\\s+assurance\\b",
      "\\bsales\\b", "\\brecruiter\\b", "\\bmarketing\\b", "\\bdesigner\\b",
      "\\bproduct\\s+manager\\b", "\\bprogram\\s+manager\\b", "\\bproject\\s+manager\\b",
      "\\btechnical\\s+writer\\b", "\\bsolutions?\\s+engineer\\b", "\\bcustomer\\b",
      "\\bfield\\s+engineer\\b", "\\bmechanical\\b",
      // Security and networking. Adjacent to backend work and they match the level patterns
      // cleanly -- "Product Security Engineer II" and "Cloud Network Engineer II" both scored
      // as SDE-2 -- but they are a different discipline from Sarthak's Go/Python distributed
      // systems background, so he does not want them surfaced.
      "\\bsecurity\\b", "\\bsecops\\b", "\\bsiem\\b", "\\binfosec\\b", "\\bcyber",
      "\\bcryptograph", "\\bpentest\\b", "\\bpenetration\\s+test", "\\bvulnerability\\b",
      "\\bthreat\\b", "\\bfirewall\\b", "\\bidentity\\s+and\\s+access\\b",
      "\\bnetwork(ing|s)?\\b", "\\brouting\\b", "\\bswitching\\b", "\\binfiniband\\b",
      "\\bwireless\\b", "\\btelecom", "\\bmodem\\b", "\\b5g\\b", "\\bradio\\b",
      // Silicon and hardware roles. NVIDIA, Qualcomm, Samsung and Dell post these in volume and
      // they are not backend software work -- "ASIC Verification Engineer", "PCB Design Layout
      // Engineer", "DFT Methodology Engineer" all surfaced during live validation.
      "\\bhardware\\b", "\\bfirmware\\b", "\\basic\\b", "\\bpcb\\b", "\\brtl\\b", "\\bdft\\b",
      "\\bsilicon\\b", "\\banalog\\b", "\\bphysical\\s+design\\b", "\\bsoc\\s+design\\b",
      "\\bdesign\\s+engineer\\b", "\\blayout\\b", "\\bverification\\s+engineer\\b",
      "\\bvlsi\\b", "\\bsignal\\s+integrity\\b", "\\bthermal\\b", "\\bmechanical\\b",
    ],
  },
  experience: {
    // Sarthak has ~3 years and is eligible for 2-4 year roles.
    idealMinYears: 2,
    idealMaxYears: 4,
    underLevelPenalty: 8,
    hardRejectYears: 7,
    penaltyPerYear: 10,
    unknownPasses: true,
  },
  location: {
    allow: [
      { name: "Bangalore", priority: 1, score: 40, aliases: ["bangalore", "bengaluru", "blr"] },
      { name: "Gurgaon", priority: 2, score: 30, aliases: ["gurgaon", "gurugram", "delhi ncr", "ncr", "new delhi", "noida"] },
      // "virtual" is how DirectEmployers-syndicated boards write remote ("Virtual, IND").
      // It is safe only because reject runs before allow: "Virtual, POL, Poland" is rejected
      // on "poland" before it can match here.
      { name: "Remote", priority: 3, score: 20, aliases: ["remote", "work from home", "wfh", "anywhere", "distributed", "virtual"] },
      { name: "Hyderabad", priority: 4, score: 10, aliases: ["hyderabad", "hyd", "telangana"] },
    ],
    reject: [
      "\\bus\\b", "\\bu\\.s\\.", "united states", "\\busa\\b", "canada", "\\buk\\b",
      // Regions, not only countries. Confluent posts "CA Remote Ontario", which names no
      // country at all, so a country-only list accepted it as plain "Remote" — the same
      // failure as the original "Italy, Remote", one level down.
      "ontario", "toronto", "vancouver", "british columbia", "quebec", "montreal",
      "alberta", "calgary", "ottawa",
      "united kingdom", "ireland", "germany", "france", "italy", "spain", "portugal",
      "netherlands", "belgium", "austria", "switzerland", "sweden", "norway", "denmark",
      "finland", "poland", "czech", "hungary", "romania", "ukraine", "russia", "turkey",
      "israel", "china", "taiwan", "japan", "korea", "singapore", "malaysia", "indonesia",
      "thailand", "vietnam", "philippines", "australia", "new zealand", "brazil", "mexico",
      "argentina", "chile", "colombia", "peru", "egypt", "south africa", "armenia",
      "hong kong", "\\buae\\b", "dubai", "saudi", "\\bemea\\b", "\\blatam\\b", "\\bapac\\b",
    ],
    unknownPasses: true,
  },
  threshold: 60,
};

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export type MatchResult = {
  isRelevant: boolean;
  score: number;
  /** Human-readable explanation, shown in the UI so filtering is never a black box. */
  reason: string;
  /** Best matching location's priority, for ranking. Lower is better; null when unknown. */
  locationPriority: number | null;
  matchedTitleLabel: string | null;
  requiredYears: number | null;
};

export type MatchInput = {
  title: string;
  location?: string | null;
  description?: string | null;
};

// ---------------------------------------------------------------------------
// Title
// ---------------------------------------------------------------------------

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Cheap, title-only classification. Exported separately because the crawler runs exactly this
 * as a pre-filter before deciding whether a per-job detail fetch is worth it -- NVIDIA alone has
 * 2000 open roles, and fetching a description for each would be 2000 requests to find perhaps
 * three matches. See docs/crawlers.md.
 */
export function matchTitle(
  title: string,
  rules: MatchRules = DEFAULT_MATCH_RULES,
  overrides?: CompanyMatchOverrides | null,
): { passed: boolean; score: number; label: string | null; excludedBy: string | null } {
  const t = normalizeTitle(title);

  // Discipline exclusions run first and are never lifted. A company override says "this level
  // is mine here", not "I will take any job here".
  for (const pattern of rules.title.exclude) {
    if (safeTest(pattern, t)) {
      return { passed: false, score: 0, label: null, excludedBy: pattern };
    }
  }

  const levelTitle = (overrides?.levelTitles ?? []).find((p) => safeTest(p, t));

  // Seniority exclusions apply unless this company has declared the title to be its target
  // level. Without the override, "Senior Software Engineer" is correctly out; with it, it is
  // the Confluent equivalent of SDE-2 and belongs on the board.
  if (!levelTitle) {
    for (const pattern of rules.title.seniorityExclude ?? []) {
      if (safeTest(pattern, t)) {
        return { passed: false, score: 0, label: null, excludedBy: pattern };
      }
    }
  }

  let best: TitleRule | null = null;
  for (const rule of rules.title.include) {
    if (safeTest(rule.pattern, t)) {
      if (!best || rule.score > best.score) best = rule;
    }
  }

  if (levelTitle) {
    const score = overrides?.score ?? 100;
    // The override wins only when it scores higher, so a title that also matches a normal
    // include keeps whichever label describes it best.
    if (!best || score > best.score) {
      return {
        passed: true,
        score,
        label: `Company level title: ${levelTitle}`,
        excludedBy: null,
      };
    }
  }

  return best
    ? { passed: true, score: best.score, label: best.label, excludedBy: null }
    : { passed: false, score: 0, label: null, excludedBy: null };
}

/** A malformed pattern must never take down matching for every job. */
function safeTest(pattern: string, text: string): boolean {
  try {
    return new RegExp(pattern, "i").test(text);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Experience
// ---------------------------------------------------------------------------

const YEARS_PATTERNS: RegExp[] = [
  // "3+ years" -- the explicit plus makes this unambiguous without needing nearby context.
  /\b(\d{1,2})\s*\+\s*years?/gi,
  // "minimum of 8 years", "at least 5 years"
  /(?:minimum|at\s+least|min\.?)\s+(?:of\s+)?(\d{1,2})\s*\+?\s*years?/gi,
  // "2-4 years" -- take the lower bound
  /\b(\d{1,2})\s*(?:to|-|–)\s*\d{1,2}\s*\+?\s*years?/gi,
  // "6 years of relevant experience" -- allow a few words before "experience"
  /\b(\d{1,2})\s*years?\s+(?:of\s+)?(?:\w+\s+){0,3}experience/gi,
  // "Experience: 6 years"
  /experience\s*:\s*(\d{1,2})\s*\+?\s*years?/gi,
];

/**
 * Extract the minimum years of experience a description asks for.
 *
 * Descriptions routinely mention several figures ("3+ years with Go, 6+ years overall"), so this
 * takes the SMALLEST match. That is deliberately lenient: over-reading the requirement would
 * silently discard reachable roles, and a false positive costs a glance while a false negative
 * costs the opportunity.
 */
export function parseRequiredYears(description: string | null | undefined): number | null {
  if (!description) return null;
  // Strip tags so HTML descriptions parse the same as plain text.
  const text = description.replace(/<[^>]+>/g, " ").replace(/&nbsp;?/gi, " ");

  const found: number[] = [];
  for (const re of YEARS_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const n = Number.parseInt(m[1], 10);
      if (Number.isFinite(n) && n > 0 && n <= 20) found.push(n);
    }
  }
  return found.length ? Math.min(...found) : null;
}

// ---------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------

export function matchLocation(
  location: string | null | undefined,
  rules: MatchRules = DEFAULT_MATCH_RULES,
): { matched: LocationRule | null; unknown: boolean } {
  if (!location || !location.trim()) return { matched: null, unknown: true };
  const l = location.toLowerCase();

  // A named foreign country disqualifies the posting even when it also says "Remote".
  // "India" is never in the reject list, so "India, Remote" and "Bengaluru, India" survive.
  for (const pattern of rules.location.reject) {
    if (new RegExp(pattern, "i").test(l)) return { matched: null, unknown: false };
  }

  let best: LocationRule | null = null;
  for (const rule of rules.location.allow) {
    if (rule.aliases.some((a) => l.includes(a))) {
      if (!best || rule.priority < best.priority) best = rule;
    }
  }
  return { matched: best, unknown: false };
}

// ---------------------------------------------------------------------------
// Full match
// ---------------------------------------------------------------------------

export function matchJob(
  job: MatchInput,
  rules: MatchRules = DEFAULT_MATCH_RULES,
  overrides?: CompanyMatchOverrides | null,
): MatchResult {
  const reasons: string[] = [];

  // 1. Title -- a hard gate, softened only by this company's own level vocabulary.
  const title = matchTitle(job.title, rules, overrides);
  if (!title.passed) {
    const why = title.excludedBy
      ? `title excluded by /${title.excludedBy}/`
      : "title matched no target role pattern";
    return {
      isRelevant: false,
      score: 0,
      reason: why,
      locationPriority: null,
      matchedTitleLabel: null,
      requiredYears: null,
    };
  }
  reasons.push(`${title.label} (+${title.score})`);
  let score = title.score;

  // 2. Location -- a hard gate when known.
  const loc = matchLocation(job.location, rules);
  let locationPriority: number | null = null;
  if (loc.matched) {
    score += loc.matched.score;
    locationPriority = loc.matched.priority;
    reasons.push(`${loc.matched.name} (+${loc.matched.score})`);
  } else if (loc.unknown) {
    if (!rules.location.unknownPasses) {
      return {
        isRelevant: false, score: 0, reason: "location unknown and unknownPasses is false",
        locationPriority: null, matchedTitleLabel: title.label, requiredYears: null,
      };
    }
    reasons.push("location unknown (kept)");
  } else {
    return {
      isRelevant: false,
      score: 0,
      reason: `location "${job.location}" is not in the allowed list`,
      locationPriority: null,
      matchedTitleLabel: title.label,
      requiredYears: null,
    };
  }

  // 3. Experience -- a gate only at the extreme; otherwise a penalty.
  const years = parseRequiredYears(job.description);
  if (years !== null) {
    if (years >= rules.experience.hardRejectYears) {
      return {
        isRelevant: false,
        score: 0,
        reason: `requires ${years}+ years, at or above the ${rules.experience.hardRejectYears}-year reject threshold`,
        locationPriority,
        matchedTitleLabel: title.label,
        requiredYears: years,
      };
    }
    const minYears = rules.experience.idealMinYears ?? 0;
    if (years > rules.experience.idealMaxYears) {
      const penalty = (years - rules.experience.idealMaxYears) * rules.experience.penaltyPerYear;
      score -= penalty;
      reasons.push(`requires ${years}+ yrs, above target (-${penalty})`);
    } else if (years < minYears) {
      // Under-levelled, not ineligible: he can apply to a one-year role, it is just a worse use
      // of a referral than one asking for three. A penalty ranks it down; a gate would hide it.
      const penalty = (minYears - years) * (rules.experience.underLevelPenalty ?? 0);
      score -= penalty;
      reasons.push(
        penalty > 0
          ? `requires only ${years}+ yrs, below the ${minYears}-${rules.experience.idealMaxYears} band (-${penalty})`
          : `requires ${years}+ yrs`,
      );
    } else {
      reasons.push(
        `requires ${years}+ yrs (fits ${minYears}-${rules.experience.idealMaxYears})`,
      );
    }
  } else if (rules.experience.unknownPasses) {
    reasons.push("experience not stated (kept)");
  }

  const isRelevant = score >= rules.threshold;
  if (!isRelevant) reasons.push(`below threshold ${rules.threshold}`);

  return {
    isRelevant,
    score,
    reason: reasons.join(", "),
    locationPriority,
    matchedTitleLabel: title.label,
    requiredYears: years,
  };
}
