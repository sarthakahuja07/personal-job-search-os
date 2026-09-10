import type { LinkedinFeed } from "@/db/schema";

/**
 * Turning LinkedIn alert emails into board entries.
 *
 * The awkward part of this source is that it is not a company. Every other source answers
 * "what is open at Rippling"; an alert answers "what is open anywhere that looks like you",
 * which spans companies that are on the board, companies that are not, and roles already
 * discovered through a company's own ATS.
 *
 * So each posting resolves to exactly one of three outcomes:
 *
 *   merge   the same opening is already on the board from the company's ATS. Record the
 *           LinkedIn link on the existing row -- never a second card.
 *   insert  the company is on the board but this opening is not. A normal job, sourced
 *           `linkedin_email`.
 *   lead    the company is not on the board. Parked in `linkedin_leads` until Sarthak
 *           promotes it, because the company list is curated by hand.
 *
 * Everything here is pure and string-keyed. It never guesses with a similarity score: two
 * things match because their normalised forms are equal, which means a wrong merge can always
 * be traced to a normalisation rule rather than to a threshold nobody can reason about.
 */

export type LinkedInPosting = {
  /** LinkedIn's own numeric id from /jobs/view/<id>/. Never synthesised. */
  linkedinJobId: string;
  companyName: string;
  title: string;
  location: string | null;
  jobUrl: string;
  postedAt: Date | null;
  feed: LinkedinFeed;
};

export type KnownCompany = {
  id: string;
  name: string;
  /** Other spellings this employer posts under, from `companies.match_overrides`. */
  aliases?: string[];
};

export type ExistingJob = {
  id: string;
  companyId: string;
  title: string;
  location: string | null;
  postedAt: Date | null;
  linkedinJobId: string | null;
};

export type LinkedInResolution = {
  merges: { jobId: string; linkedinJobId: string; linkedinUrl: string }[];
  inserts: { companyId: string; posting: LinkedInPosting }[];
  leads: LinkedInPosting[];
};

/**
 * Words that carry no identity. "Sigmoid" and "Sigmoid Technologies" are one employer; so are
 * "Google" and "Google India". Dropping them is what lets an alert's spelling meet the board's.
 */
const COMPANY_NOISE =
  /\b(inc|llc|ltd|limited|pvt|private|corp|corporation|company|technologies|technology|labs|solutions|services|systems|software|india|global|group|holdings)\b/g;

/**
 * A company's identity, normalised. Deliberately exact-match only -- no substring or fuzzy
 * comparison, because "Apple" would then swallow "Apple Hospitality" and a wrong company means
 * a job card offering you a referral contact who cannot help.
 */
export function companyKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(COMPANY_NOISE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ROMAN: Record<string, string> = { i: "1", ii: "2", iii: "3", iv: "4", v: "5" };

/**
 * A title's identity. "Software Engineer II" and "Software Engineer 2" are the same role, and
 * a source that spells it in Roman numerals should not create a second card.
 */
export function titleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9+#]+/g, " ")
    .replace(/\b(i{1,3}|iv|v)\b/g, (m) => ROMAN[m] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Cities, not location strings. LinkedIn writes "Bengaluru, Karnataka, India" where an ATS
 * writes "Bangalore, India"; those are one place and must not produce two cards.
 *
 * Anything unrecognised -- including a bare "India", which is too coarse to decide anything
 * with -- returns null. Null means "unknown", never "different".
 */
const CITIES: Record<string, string> = {
  bengaluru: "bangalore",
  bangalore: "bangalore",
  blr: "bangalore",
  gurugram: "gurgaon",
  gurgaon: "gurgaon",
  ggn: "gurgaon",
  noida: "noida",
  delhi: "delhi",
  hyderabad: "hyderabad",
  pune: "pune",
  mumbai: "mumbai",
  chennai: "chennai",
  kolkata: "kolkata",
  ahmedabad: "ahmedabad",
  jaipur: "jaipur",
  remote: "remote",
};

export function cityKey(location: string | null): string | null {
  if (!location) return null;
  for (const token of location.toLowerCase().split(/[^a-z]+/)) {
    const city = CITIES[token];
    if (city) return city;
  }
  return null;
}

/**
 * Absence is not contradiction. A job with no location recorded is not evidence that it is
 * somewhere *else*, so it stays mergeable; only two known and different cities block a merge.
 */
function locationsCompatible(a: string | null, b: string | null): boolean {
  const ka = cityKey(a);
  const kb = cityKey(b);
  if (ka === null || kb === null) return true;
  return ka === kb;
}

/**
 * Titles match when their keys are equal, or when one is the other plus a qualifier --
 * "Software Development Engineer II" against "Software Development Engineer II, AWS".
 *
 * The three-word floor is what stops that second rule being dangerous: without it "Engineer"
 * would prefix-match every engineering role at the company.
 */
function titlesMatch(a: string, b: string): boolean {
  const ka = titleKey(a);
  const kb = titleKey(b);
  if (ka === kb) return true;

  const [shorter, longer] = ka.length <= kb.length ? [ka, kb] : [kb, ka];
  if (shorter.split(" ").length < 3) return false;
  return longer.startsWith(shorter + " ");
}

export function resolveLinkedInPostings(input: {
  postings: LinkedInPosting[];
  companies: KnownCompany[];
  existingJobs: ExistingJob[];
}): LinkedInResolution {
  const { companies, existingJobs } = input;

  const byCompanyKey = new Map<string, KnownCompany>();
  // Two board rows can normalise to one key -- "Confluent" and "Confluent (IBM)" both reduce to
  // "confluent", and an alert says only "Confluent". Something has to win, so let it be the
  // plainest name rather than whichever row the query happened to return first: a merge that
  // depends on row order is a bug that only shows up once the data changes.
  const ordered = companies
    .slice()
    .sort((a, b) => a.name.length - b.name.length || (a.name < b.name ? -1 : 1));

  for (const c of ordered) {
    for (const spelling of [c.name, ...(c.aliases ?? [])]) {
      const key = companyKey(spelling);
      if (key && !byCompanyKey.has(key)) byCompanyKey.set(key, c);
    }
  }

  // A posting arrives in several alerts and on several days; the board should not care.
  const seen = new Set<string>();
  const postings = input.postings.filter((p) => {
    if (seen.has(p.linkedinJobId)) return false;
    seen.add(p.linkedinJobId);
    return true;
  });

  const alreadyLinked = new Set(
    existingJobs.map((j) => j.linkedinJobId).filter((v): v is string => Boolean(v)),
  );

  // Rows this run has already pointed a posting at. Without it, "prefer an unlinked row" only
  // ever consults the state the run started with, and a batch of identical openings all stack
  // onto the same job.
  const claimed = new Set<string>();

  const out: LinkedInResolution = { merges: [], inserts: [], leads: [] };

  for (const posting of postings) {
    // Already merged on a previous run. Re-emitting the merge would be harmless but would make
    // every crawl report work it did not do.
    if (alreadyLinked.has(posting.linkedinJobId)) continue;

    const company = byCompanyKey.get(companyKey(posting.companyName));
    if (!company) {
      out.leads.push(posting);
      continue;
    }

    const candidates = existingJobs.filter(
      (j) =>
        j.companyId === company.id &&
        titlesMatch(j.title, posting.title) &&
        locationsCompatible(j.location, posting.location),
    );

    if (candidates.length === 0) {
      out.inserts.push({ companyId: company.id, posting });
      continue;
    }

    // Several identical openings in one city is normal at large employers, and nothing in an
    // alert email says which requisition it is. Prefer a row not already carrying a LinkedIn
    // id, then the most recently posted -- so repeated alerts spread across the duplicates
    // instead of stacking on one, and the newest is the likeliest to still be open.
    const isLinked = (j: ExistingJob) => Boolean(j.linkedinJobId) || claimed.has(j.id);
    const best = candidates.slice().sort((a, b) => {
      const linked = Number(isLinked(a)) - Number(isLinked(b));
      if (linked !== 0) return linked;
      return (b.postedAt?.getTime() ?? 0) - (a.postedAt?.getTime() ?? 0);
    })[0];
    claimed.add(best.id);

    out.merges.push({
      jobId: best.id,
      linkedinJobId: posting.linkedinJobId,
      linkedinUrl: posting.jobUrl,
    });
    alreadyLinked.add(posting.linkedinJobId);
  }

  return out;
}
