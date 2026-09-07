/**
 * Reminders: the things that have gone quiet and need a nudge.
 *
 * The crawler solves discovery. This solves the failure that comes after it — a referral asked
 * for and never chased, a referral granted and never applied to, an excellent match noticed and
 * then buried under sixty new ones. Those cost exactly as much as a missed posting and are far
 * easier to miss, because nothing changes on screen when they happen.
 *
 * Every rule is time-since-a-state-change, which means a reminder can always name the date it
 * started from. Nothing here guesses at intent: a reminder fires because a job has sat in one
 * stage too long, not because a model thinks it looks neglected.
 *
 * Pure and deterministic — `now` is injected so the tests do not depend on the clock.
 */

import type { ApplicationStatus } from "@/db/schema";
import type { FitBand } from "./fit";

const DAY_MS = 86_400_000;

export type ReminderKind =
  | "referral_status"
  | "apply_after_referral"
  | "decide_on_saved"
  | "application_silent"
  | "strong_match_untouched";

/** Ordered worst-first; the UI colours by this. */
export type ReminderSeverity = "overdue" | "due";

export type Reminder = {
  kind: ReminderKind;
  severity: ReminderSeverity;
  jobId: string;
  jobTitle: string;
  companyId: string;
  companyName: string;
  /** Whole days since the state this reminder watches began. */
  daysWaiting: number;
  /** The moment the clock started, so the UI never shows an unexplained number. */
  since: Date;
  /** Imperative, second person: what to actually do. */
  action: string;
  /** Why this is being raised now. */
  detail: string;
  /** True when a referral contact exists, so the UI can offer to message them directly. */
  hasContact: boolean;
};

export type ReminderCandidate = {
  jobId: string;
  jobTitle: string;
  companyId: string;
  companyName: string;
  /** Null when the job has never been saved into the pipeline. */
  status: ApplicationStatus | null;
  requestedAt: Date | null;
  referredAt: Date | null;
  appliedAt: Date | null;
  /** When the job entered the pipeline; falls back to discovery for untouched jobs. */
  savedAt: Date | null;
  discoveredAt: Date;
  fitBand: FitBand | null;
  hasContact: boolean;
};

export type ReminderThresholds = {
  /** Days in `requested` before chasing the contact. Comes from settings.followUpDays. */
  referralStatusDays: number;
  /** Days in `referred` without applying. Short: a referral has a shelf life. */
  applyAfterReferralDays: number;
  /** Days in `saved` without a decision. */
  decideOnSavedDays: number;
  /** Days in `applied` with no movement. */
  applicationSilentDays: number;
  /** Days a strong or excellent match can sit with no application at all. */
  strongMatchDays: number;
};

export const DEFAULT_THRESHOLDS: ReminderThresholds = {
  referralStatusDays: 5,
  applyAfterReferralDays: 2,
  decideOnSavedDays: 4,
  applicationSilentDays: 14,
  strongMatchDays: 3,
};

const daysBetween = (from: Date, now: Date) =>
  Math.floor((now.getTime() - from.getTime()) / DAY_MS);

/** Twice the threshold is no longer "due soon", it is being dropped. */
const severityFor = (days: number, threshold: number): ReminderSeverity =>
  days >= threshold * 2 ? "overdue" : "due";

export function buildReminders(
  candidates: ReminderCandidate[],
  thresholds: ReminderThresholds = DEFAULT_THRESHOLDS,
  now: Date = new Date(),
): Reminder[] {
  const out: Reminder[] = [];

  for (const c of candidates) {
    const base = {
      jobId: c.jobId,
      jobTitle: c.jobTitle,
      companyId: c.companyId,
      companyName: c.companyName,
      hasContact: c.hasContact,
    };

    // A referral asked for and not yet answered. Only `requested` qualifies: once a referral is
    // submitted the ball is not in Sarthak's court, and chasing someone who already helped is
    // worse than not chasing at all.
    if (c.status === "requested" && c.requestedAt) {
      const days = daysBetween(c.requestedAt, now);
      if (days >= thresholds.referralStatusDays) {
        out.push({
          ...base,
          kind: "referral_status",
          severity: severityFor(days, thresholds.referralStatusDays),
          daysWaiting: days,
          since: c.requestedAt,
          action: c.hasContact
            ? "Ask your contact where the referral stands"
            : "Chase the referral — no contact saved yet",
          detail: `Referral requested ${days} days ago with no update since.`,
        });
      }
      continue;
    }

    // The most expensive gap in the whole pipeline: someone has spent their credibility on a
    // referral and the application was never submitted. Deliberately the shortest threshold.
    if (c.status === "referred" && c.referredAt) {
      const days = daysBetween(c.referredAt, now);
      if (days >= thresholds.applyAfterReferralDays) {
        out.push({
          ...base,
          kind: "apply_after_referral",
          severity: severityFor(days, thresholds.applyAfterReferralDays),
          daysWaiting: days,
          since: c.referredAt,
          action: "Submit the application — the referral is already in",
          detail: `Referred ${days} days ago but not yet applied.`,
        });
      }
      continue;
    }

    if (c.status === "applied" && c.appliedAt) {
      const days = daysBetween(c.appliedAt, now);
      if (days >= thresholds.applicationSilentDays) {
        out.push({
          ...base,
          kind: "application_silent",
          severity: severityFor(days, thresholds.applicationSilentDays),
          daysWaiting: days,
          since: c.appliedAt,
          action: "Follow up on the application",
          detail: `Applied ${days} days ago with no movement recorded.`,
        });
      }
      continue;
    }

    if (c.status === "saved") {
      const since = c.savedAt ?? c.discoveredAt;
      const days = daysBetween(since, now);
      if (days >= thresholds.decideOnSavedDays) {
        out.push({
          ...base,
          kind: "decide_on_saved",
          severity: severityFor(days, thresholds.decideOnSavedDays),
          daysWaiting: days,
          since,
          action: "Decide: ask for a referral, or drop it",
          detail: `Saved ${days} days ago and not moved since.`,
        });
      }
      continue;
    }

    // Never entered the pipeline at all. Only strong and excellent fits qualify — reminding
    // about every job would reproduce the board, and a reminder list nobody trusts is worse
    // than none.
    if (!c.status && (c.fitBand === "excellent" || c.fitBand === "strong")) {
      const days = daysBetween(c.discoveredAt, now);
      if (days >= thresholds.strongMatchDays) {
        out.push({
          ...base,
          kind: "strong_match_untouched",
          severity: severityFor(days, thresholds.strongMatchDays),
          daysWaiting: days,
          since: c.discoveredAt,
          action: c.hasContact
            ? "Ask for a referral before this floods"
            : "Apply directly — no referral contact here",
          detail: `${c.fitBand === "excellent" ? "Excellent" : "Strong"} match found ${days} days ago and still untouched.`,
        });
      }
    }
  }

  // Worst first, then longest-waiting. A stable order matters: this list is read at a glance
  // and a reshuffling list teaches you to stop reading it.
  const rank: Record<ReminderSeverity, number> = { overdue: 0, due: 1 };
  return out.sort(
    (a, b) => rank[a.severity] - rank[b.severity] || b.daysWaiting - a.daysWaiting,
  );
}

export const KIND_LABEL: Record<ReminderKind, string> = {
  referral_status: "Referral status",
  apply_after_referral: "Apply now",
  decide_on_saved: "Decide",
  application_silent: "No response",
  strong_match_untouched: "Strong match",
};
