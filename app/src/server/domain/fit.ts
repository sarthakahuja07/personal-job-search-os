/**
 * Fit scoring: how well a posting matches *Sarthak specifically*, on a 0-100 scale.
 *
 * This is deliberately a separate question from `matching.ts`, which answers "should this job be
 * on the board at all" -- a hard gate on level, location and exclusions. Fit answers "of the jobs
 * that qualify, which are worth a referral ask today". Keeping them apart means a tighter fit
 * model can never silently hide a job the gate accepted.
 *
 * Three properties matter more than sophistication here:
 *
 * 1. **Explainable.** Every point is attributable to a named signal, and the signals are what the
 *    UI shows. A number nobody can argue with is a number nobody can correct.
 * 2. **Honest about missing evidence.** Apple, Microsoft and Rippling publish no description on
 *    their list endpoints -- 60 of 371 jobs. Scoring those against a rubric that expects a
 *    description would rank them last for a gap in *our* data, not a flaw in the job. Instead the
 *    weights that cannot be assessed are removed from the denominator, and the result is marked
 *    `title-only` so the confidence is visible rather than implied.
 * 3. **Data, not code.** The profile lives in `settings.fit_profile`, so retuning what counts as a
 *    strong match needs no deploy -- the same rule the match rules already follow.
 */

export type FitBand = "excellent" | "strong" | "good" | "fair" | "weak";

export type FitSignal = {
  /** Short label for the UI chip. */
  label: string;
  /** Which dimension this came from. */
  dimension: FitDimension;
  /** Points earned, rounded. Negative is allowed for penalties. */
  points: number;
  /** Human-readable justification, shown on hover / in the detail view. */
  detail: string;
};

export type FitDimension = "level" | "skills" | "domain" | "location" | "freshness";

export type FitResult = {
  /** 0-100, normalised over the dimensions that could actually be assessed. */
  score: number;
  band: FitBand;
  signals: FitSignal[];
  /** True when no description was available and the score rests on the title alone. */
  titleOnly: boolean;
  /** Sum of the weights that were assessable, for debugging and tests. */
  assessedWeight: number;
};

export type SkillGroup = {
  name: string;
  /** Regex sources, matched case-insensitively against title + description. */
  patterns: string[];
  /** Points for the first hit in this group. */
  weight: number;
};

export type FitProfile = {
  level: {
    /** Titles that name the exact target band. */
    exact: string[];
    /** Titles at the right altitude but not explicitly levelled. */
    adjacent: string[];
    /** Below the target band -- still worth seeing, ranked lower. */
    below: string[];
  };
  skills: SkillGroup[];
  domains: SkillGroup[];
  weights: Record<FitDimension, number>;
  /**
   * How much of the skills/domain weight survives when only a title is available. Titles do carry
   * real signal ("Software Engineer - Distributed Systems"), just far less of it, so the weight is
   * reduced rather than removed -- removing it entirely would let a bare title outscore a rich
   * description by having fewer ways to lose points.
   */
  titleOnlyRetention: number;
  bands: { excellent: number; strong: number; good: number; fair: number };
};

/**
 * Sarthak's profile, from his resume: Uber SWE II on DataBook (metadata, lineage, sharding a 13TB
 * datastore), Blinkit SDE before that (pricing, layout services, Kafka, Redis, DynamoDB), ~3.1
 * years, Golang and Python, backend and distributed systems.
 */
export const DEFAULT_FIT_PROFILE: FitProfile = {
  level: {
    exact: [
      "\\bsde\\s*-?\\s*(?:2|ii)\\b",
      "\\bswe\\s*-?\\s*(?:2|ii)\\b",
      "\\bsoftware\\s+(?:development\\s+)?engineer\\s*-?\\s*(?:2|ii)\\b",
      "\\bengineer\\s*(?:2|ii)\\b",
      "\\bsoftware\\s+engineer\\s+level\\s*2\\b",
      "\\bmember\\s+of\\s+technical\\s+staff\\s*(?:2|ii)\\b",
    ],
    adjacent: [
      "\\bsoftware\\s+engineer\\b",
      "\\bbackend\\s+engineer\\b",
      "\\bback[\\s-]?end\\s+(?:software\\s+)?engineer\\b",
      "\\bfull[\\s-]?stack\\s+(?:software\\s+)?engineer\\b",
      "\\bsoftware\\s+development\\s+engineer\\b",
      "\\bplatform\\s+engineer\\b",
      "\\bapplication\\s+engineer\\b",
      "\\bproduct\\s+engineer\\b",
    ],
    below: [
      "\\bsde\\s*-?\\s*(?:1|i)\\b",
      "\\bswe\\s*-?\\s*(?:1|i)\\b",
      "\\bengineer\\s*(?:1|i)\\b",
      "\\bassociate\\s+(?:software\\s+)?engineer\\b",
      "\\bgraduate\\b",
      "\\bnew\\s+grad\\b",
    ],
  },

  // Ordered by how central each is to his actual work. A job needs only a few of these; the
  // scoring takes the best-scoring groups rather than summing everything, so a description that
  // lists thirty technologies cannot outrank one that matches his core three.
  skills: [
    { name: "Golang", weight: 10, patterns: ["\\bgo(?:lang)?\\b", "\\bgorm\\b"] },
    { name: "Distributed systems", weight: 9, patterns: ["\\bdistributed\\s+systems?\\b", "\\bscalab(?:le|ility)\\b", "\\bhigh[\\s-]?(?:throughput|scale|availability)\\b", "\\bsharding\\b", "\\bhorizontal(?:ly)?\\s+scal"] },
    { name: "Backend", weight: 8, patterns: ["\\bback[\\s-]?end\\b", "\\bserver[\\s-]?side\\b", "\\bapi\\s+(?:design|development)\\b", "\\brest(?:ful)?\\s+api", "\\bgrpc\\b"] },
    { name: "Microservices", weight: 7, patterns: ["\\bmicro[\\s-]?services?\\b", "\\bservice[\\s-]?oriented\\b"] },
    { name: "Python", weight: 7, patterns: ["\\bpython\\b", "\\bdjango\\b", "\\bcelery\\b"] },
    { name: "Data infrastructure", weight: 7, patterns: ["\\bdata\\s+(?:platform|infrastructure|pipeline|engineering)\\b", "\\bmetadata\\b", "\\blineage\\b", "\\bdata\\s+governance\\b", "\\btrino\\b", "\\bspark\\b"] },
    { name: "Kafka / streaming", weight: 6, patterns: ["\\bkafka\\b", "\\b(?:event|message)\\s+(?:streaming|driven|queue)\\b", "\\bpub[\\s-]?sub\\b", "\\bsqs\\b"] },
    { name: "Databases", weight: 6, patterns: ["\\bpostgres(?:ql)?\\b", "\\bmysql\\b", "\\bdynamodb\\b", "\\bmongo(?:db)?\\b", "\\brelational\\s+database", "\\bsql\\b"] },
    { name: "Caching", weight: 5, patterns: ["\\bredis\\b", "\\bmemcach", "\\bcaching\\b"] },
    { name: "Kubernetes / cloud", weight: 5, patterns: ["\\bkubernetes\\b", "\\bk8s\\b", "\\bdocker\\b", "\\baws\\b", "\\blambda\\b", "\\bterraform\\b"] },
    { name: "Observability", weight: 4, patterns: ["\\bprometheus\\b", "\\bgrafana\\b", "\\bdatadog\\b", "\\bobservability\\b", "\\bopentelemetry\\b", "\\bmonitoring\\b"] },
    { name: "TypeScript / React", weight: 4, patterns: ["\\btypescript\\b", "\\breact(?:\\.js)?\\b", "\\bnext\\.?js\\b", "\\bnode(?:\\.js)?\\b"] },
    { name: "C++", weight: 3, patterns: ["\\bc\\+\\+\\b"] },
  ],

  // Where he has actually shipped. A posting in a domain he knows is a materially stronger ask
  // for a referral than one that merely uses the same tools.
  domains: [
    { name: "Data platform", weight: 10, patterns: ["\\bdata\\s+(?:platform|catalog|governance|discovery|quality)\\b", "\\bmetadata\\b", "\\blineage\\b", "\\bdata\\s+mesh\\b"] },
    { name: "Developer platform", weight: 8, patterns: ["\\bdeveloper\\s+(?:platform|experience|tools?|productivity)\\b", "\\binternal\\s+(?:tools?|platform)\\b", "\\bplatform\\s+engineering\\b", "\\binfrastructure\\b"] },
    { name: "Pricing / commerce", weight: 8, patterns: ["\\bpricing\\b", "\\be[\\s-]?commerce\\b", "\\bmarketplace\\b", "\\bcheckout\\b", "\\bcatalog(?:ue)?\\b", "\\bmerchandis", "\\bquick\\s+commerce\\b", "\\bretail\\b"] },
    { name: "Fintech / payments", weight: 6, patterns: ["\\bpayments?\\b", "\\bfintech\\b", "\\blending\\b", "\\bbanking\\b", "\\btransactions?\\s+processing\\b"] },
    { name: "Search / ranking", weight: 5, patterns: ["\\bsearch\\b", "\\branking\\b", "\\brecommendations?\\b", "\\bpersonaliz"] },
  ],

  // Skills carry the most weight on purpose. Level, location and freshness are all readable
  // from the title and metadata, so if they dominated, every correctly-levelled Bangalore job
  // would score alike and the ranking would say nothing about the work itself.
  weights: { level: 22, skills: 34, domain: 20, location: 14, freshness: 10 },
  titleOnlyRetention: 0.4,
  bands: { excellent: 80, strong: 65, good: 50, fair: 35 },
};

export type FitInput = {
  title: string;
  description?: string | null;
  /** 1 Bangalore, 2 Gurgaon, 3 Remote, 4 Hyderabad, null unknown. From matching.ts. */
  locationPriority?: number | null;
  postedAt?: Date | null;
  discoveredAt?: Date | null;
};

const LOCATION_FRACTION: Record<number, number> = { 1: 1, 2: 0.8, 3: 0.6, 4: 0.45 };
const LOCATION_NAME: Record<number, string> = {
  1: "Bangalore",
  2: "Gurgaon",
  3: "Remote",
  4: "Hyderabad",
};

function anyMatch(text: string, patterns: string[]): boolean {
  return patterns.some((p) => new RegExp(p, "i").test(text));
}

/** Groups that hit, best first. */
function hitGroups(text: string, groups: SkillGroup[]): SkillGroup[] {
  return groups
    .filter((g) => anyMatch(text, g.patterns))
    .sort((a, b) => b.weight - a.weight);
}

/**
 * Take the best `n` groups rather than summing every hit.
 *
 * A 7,000-character Salesforce description mentions far more technologies than a terse one, and
 * summing would rank verbosity rather than fit. Capping at the top few asks the question that
 * actually matters: does this job centre on the things he is strongest at?
 */
function topWeight(groups: SkillGroup[], n: number): number {
  return groups.slice(0, n).reduce((sum, g) => sum + g.weight, 0);
}

export function scoreFit(
  input: FitInput,
  profile: FitProfile = DEFAULT_FIT_PROFILE,
): FitResult {
  const title = (input.title ?? "").trim();
  const description = (input.description ?? "").trim();
  const titleOnly = description.length < 200;
  const haystack = titleOnly ? title : `${title}\n${description}`;

  const signals: FitSignal[] = [];
  let earned = 0;
  let available = 0;

  // --- Level -------------------------------------------------------------------------------
  // Assessed from the title alone in every case, so it is always fully available.
  {
    const w = profile.weights.level;
    available += w;
    let fraction: number;
    let detail: string;
    if (anyMatch(title, profile.level.exact)) {
      fraction = 1;
      detail = "Title names the SDE-2 / SWE-II band exactly";
    } else if (anyMatch(title, profile.level.below)) {
      fraction = 0.35;
      detail = "Reads as one level below his current band";
    } else if (anyMatch(title, profile.level.adjacent)) {
      fraction = 0.72;
      detail = "Right altitude, but the level is not stated";
    } else {
      fraction = 0.4;
      detail = "Level could not be read from the title";
    }
    const points = w * fraction;
    earned += points;
    signals.push({
      label: fraction === 1 ? "Exact level" : fraction >= 0.7 ? "Level fits" : "Level unclear",
      dimension: "level",
      points: Math.round(points),
      detail,
    });
  }

  // --- Skills ------------------------------------------------------------------------------
  {
    const retention = titleOnly ? profile.titleOnlyRetention : 1;
    const w = profile.weights.skills * retention;
    available += w;
    const hits = hitGroups(haystack, profile.skills);
    // Four groups is the ceiling: matching Go, distributed systems, backend and Kafka is already
    // a strong signal, and the fifth adds noise rather than information.
    const best = Math.min(topWeight(hits, 4), 34);
    const fraction = best / 34;
    const points = w * fraction;
    earned += points;
    signals.push({
      label: hits.length ? hits.slice(0, 3).map((h) => h.name).join(" · ") : "No skill overlap",
      dimension: "skills",
      points: Math.round(points),
      detail: hits.length
        ? `Matches ${hits.length} of his skill areas${titleOnly ? ", from the title alone" : ""}`
        : "None of his core technologies appear",
    });
  }

  // --- Domain ------------------------------------------------------------------------------
  {
    const retention = titleOnly ? profile.titleOnlyRetention : 1;
    const w = profile.weights.domain * retention;
    available += w;
    const hits = hitGroups(haystack, profile.domains);
    const best = Math.min(topWeight(hits, 2), 18);
    const fraction = best / 18;
    const points = w * fraction;
    earned += points;
    if (hits.length) {
      signals.push({
        label: hits.slice(0, 2).map((h) => h.name).join(" · "),
        dimension: "domain",
        points: Math.round(points),
        detail: `Overlaps work he has shipped${titleOnly ? ", inferred from the title" : ""}`,
      });
    }
  }

  // --- Location ----------------------------------------------------------------------------
  {
    const w = profile.weights.location;
    available += w;
    const priority = input.locationPriority ?? null;
    // Unknown sits mid-scale on purpose. Several sources (Apple, Amazon) omit a per-row location
    // while the query itself is already scoped to India, so treating unknown as bad would punish
    // the source rather than the job.
    const fraction = priority ? (LOCATION_FRACTION[priority] ?? 0.5) : 0.55;
    const points = w * fraction;
    earned += points;
    signals.push({
      label: priority ? (LOCATION_NAME[priority] ?? "Location") : "Location unknown",
      dimension: "location",
      points: Math.round(points),
      detail: priority
        ? `${LOCATION_NAME[priority]} — preference rank ${priority}`
        : "The source did not give a per-role location",
    });
  }

  // --- Freshness ---------------------------------------------------------------------------
  // The entire premise of this project is reaching a posting before it is flooded, so recency is
  // a component of fit rather than a sort option.
  {
    const w = profile.weights.freshness;
    available += w;
    const reference = input.postedAt ?? input.discoveredAt ?? null;
    let fraction: number;
    let detail: string;
    if (!reference) {
      fraction = 0.5;
      detail = "No posting date available";
    } else {
      const days = Math.max(0, (Date.now() - reference.getTime()) / 86_400_000);
      if (days <= 3) [fraction, detail] = [1, "Posted in the last 3 days"];
      else if (days <= 7) [fraction, detail] = [0.8, "Posted this week"];
      else if (days <= 14) [fraction, detail] = [0.55, "Posted in the last fortnight"];
      else if (days <= 30) [fraction, detail] = [0.3, "Posted this month"];
      else [fraction, detail] = [0.1, "Over a month old — likely flooded"];
    }
    const points = w * fraction;
    earned += points;
    signals.push({
      label: fraction >= 0.8 ? "Fresh" : fraction >= 0.5 ? "Recent" : "Ageing",
      dimension: "freshness",
      points: Math.round(points),
      detail,
    });
  }

  const score = available > 0 ? Math.round((earned / available) * 100) : 0;
  return {
    score,
    band: bandFor(score, profile),
    signals: signals.sort((a, b) => b.points - a.points),
    titleOnly,
    assessedWeight: Math.round(available),
  };
}

export function bandFor(score: number, profile: FitProfile = DEFAULT_FIT_PROFILE): FitBand {
  const b = profile.bands;
  if (score >= b.excellent) return "excellent";
  if (score >= b.strong) return "strong";
  if (score >= b.good) return "good";
  if (score >= b.fair) return "fair";
  return "weak";
}

export const BAND_LABEL: Record<FitBand, string> = {
  excellent: "Excellent match",
  strong: "Strong match",
  good: "Good match",
  fair: "Fair match",
  weak: "Weak match",
};
