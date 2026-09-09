/**
 * Application pipeline logic.
 *
 * Five active stages, as PRD §30 specifies, plus two terminal outcomes. Recruiter Screen /
 * Onsite / Offer columns make a board look thorough and turn it into admin; the question this
 * board answers is "what needs a nudge today", which five stages answer and nine obscure.
 *
 * Selected and Rejected are different in kind from the five: they are where a job stops needing
 * anything. Nothing chases them, and they are the only stages a card can enter and be finished
 * with — which is precisely why they belong on the board rather than being a reason to delete
 * the card. A rejection you can see is a search you can reason about.
 *
 * Pure: the service layer supplies the clock and persists the patch.
 */

import type { ApplicationStatus } from "@/db/schema";

export const STAGES: ApplicationStatus[] = [
  "saved",
  "requested",
  "referred",
  "applied",
  "interviews",
  "selected",
  "rejected",
];

/** Stages where nothing further is expected of Sarthak. Reminders skip these. */
export const TERMINAL_STAGES: ApplicationStatus[] = ["selected", "rejected"];

export function isTerminal(stage: ApplicationStatus | null): boolean {
  return stage !== null && TERMINAL_STAGES.includes(stage);
}

export const STAGE_LABEL: Record<ApplicationStatus, string> = {
  saved: "Saved",
  requested: "Requested",
  referred: "Referred",
  applied: "Applied",
  interviews: "Interviews",
  selected: "Selected",
  rejected: "Rejected",
};

export const STAGE_HINT: Record<ApplicationStatus, string> = {
  saved: "Worth applying to",
  requested: "Referral asked for",
  referred: "Referral submitted",
  applied: "Application in",
  interviews: "In process",
  selected: "Offer or accepted",
  rejected: "Closed — no further action",
};

/** Which timestamp column each stage stamps on first entry. `saved` stamps nothing. */
const STAGE_TIMESTAMP: Partial<Record<ApplicationStatus, TimestampField>> = {
  requested: "requestedAt",
  referred: "referredAt",
  applied: "appliedAt",
  interviews: "interviewStartedAt",
  // Both outcomes stamp the same column: what matters is when it ended, and `status` already
  // records which way it went. A second column would only be able to disagree with it.
  selected: "closedOutAt",
  rejected: "closedOutAt",
};

export type TimestampField =
  | "requestedAt"
  | "referredAt"
  | "appliedAt"
  | "interviewStartedAt"
  | "closedOutAt";

export type ApplicationTimestamps = Partial<Record<TimestampField, Date | null>>;

export function isStage(value: string): value is ApplicationStatus {
  return (STAGES as string[]).includes(value);
}

/**
 * The patch to apply when a card moves to `next`.
 *
 * A stage timestamp is set the first time that stage is reached and never cleared, even if the
 * card moves backwards. Moving a card back is usually a correction to the *current* state, not a
 * claim that the earlier event never happened -- and "when did I ask for the referral" should
 * survive a mis-drag.
 */
export function transition(
  current: ApplicationTimestamps,
  next: ApplicationStatus,
  now: Date = new Date(),
): { status: ApplicationStatus } & ApplicationTimestamps {
  const field = STAGE_TIMESTAMP[next];
  if (!field || current[field]) return { status: next };
  return { status: next, [field]: now };
}

// ---------------------------------------------------------------------------
// Follow-ups
// ---------------------------------------------------------------------------

export type FollowUpCandidate = {
  id: string;
  status: ApplicationStatus;
  requestedAt: Date | null;
  jobTitle: string;
  companyName: string;
};

export type FollowUp = FollowUpCandidate & { daysWaiting: number };

const DAY_MS = 86_400_000;

/**
 * Referrals asked for and not yet acted on.
 *
 * Only `requested` qualifies: once a referral is submitted the ball is not in Sarthak's court,
 * and nagging a contact who has already helped is worse than not following up at all.
 */
export function followUpsDue(
  applications: FollowUpCandidate[],
  thresholdDays: number,
  now: Date = new Date(),
): FollowUp[] {
  return applications
    .filter((a) => a.status === "requested" && a.requestedAt)
    .map((a) => ({
      ...a,
      daysWaiting: Math.floor((now.getTime() - a.requestedAt!.getTime()) / DAY_MS),
    }))
    .filter((a) => a.daysWaiting >= thresholdDays)
    .sort((a, b) => b.daysWaiting - a.daysWaiting);
}

/** Counts per stage, including stages with none, so the board renders a stable five columns. */
export function countByStage(
  applications: { status: ApplicationStatus }[],
): Record<ApplicationStatus, number> {
  const counts = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<
    ApplicationStatus,
    number
  >;
  for (const a of applications) {
    if (a.status in counts) counts[a.status] += 1;
  }
  return counts;
}
