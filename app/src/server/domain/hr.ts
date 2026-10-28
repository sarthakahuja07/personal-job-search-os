/**
 * HR contacts: who to call, and why now.
 *
 * A referrer and an HR contact are worth different things at different times. A referrer is
 * asked per opening; an HR contact is a recruiter who can put Sarthak in front of a hiring
 * manager, and that is worth most in the first days after a role opens — before the posting
 * has a thousand applicants. So the question this answers is not "which companies have HR?"
 * but "which HR contacts have something new to talk about since we last spoke?"
 *
 * The rule is deliberately simple and explainable: a company is worth a call when it has a
 * relevant open role that was discovered after the last call to any of its HR contacts. Calling
 * one recruiter at a company covers the company — two HR numbers at CRED do not mean two calls.
 *
 * Pure and deterministic — `now` is injected so the tests do not depend on the clock.
 */

import type { ApplicationStatus, SourceType } from "@/db/schema";
import { isTerminal } from "./applications";
import type { FitBand } from "./fit";

const DAY_MS = 86_400_000;

/** An opening this young is the window the whole product exists for: call today. */
export const HOT_WINDOW_DAYS = 3;

export type HrContact = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  linkedinUrl: string | null;
  notes: string | null;
  lastCalledAt: Date | null;
};

export type HrCompany = {
  id: string;
  name: string;
  careersUrl: string | null;
  sourceType: SourceType;
  active: boolean;
  healthStatus: string;
  contacts: HrContact[];
};

export type HrOpening = {
  jobId: string;
  companyId: string;
  title: string;
  location: string | null;
  jobUrl: string;
  discoveredAt: Date;
  fitScore: number;
  fitBand: FitBand | null;
  status: ApplicationStatus | null;
};

export type HrState =
  /** Something opened since the last call. */
  | "call"
  /** Openings exist, but every one was already there at the last call. */
  | "called"
  /** Crawled, and nothing relevant is open. */
  | "quiet"
  /** Not crawled automatically, so the board cannot say whether anything opened. */
  | "untracked";

export type HrEntry = {
  company: HrCompany;
  state: HrState;
  /** Relevant openings discovered since the last call (all of them, if never called). */
  fresh: HrOpening[];
  /** Every relevant open role, newest first — fresh ones included. */
  openings: HrOpening[];
  /** The most recent call to any HR contact at this company. */
  lastCalledAt: Date | null;
  /** The contact to call first: most recently spoken to, else the first with a phone. */
  primary: HrContact | null;
  /** A fresh opening discovered within HOT_WINDOW_DAYS. */
  hot: boolean;
  /** Imperative, second person: what to do. */
  headline: string;
  /** Why this is being raised, with the date the reason started. */
  detail: string;
};

const STATE_ORDER: Record<HrState, number> = { call: 0, called: 1, untracked: 2, quiet: 3 };

/**
 * An opening HR could still help with. Read jobs were consciously passed over and a finished
 * application has nothing left to push, so neither is a reason to pick up the phone. A job
 * already in the pipeline still is: a recruiter can move an application that is sitting idle.
 */
export function isCallWorthy(o: HrOpening): boolean {
  return !isTerminal(o.status);
}

export function buildHrList(
  companies: HrCompany[],
  openings: HrOpening[],
  now: Date,
): HrEntry[] {
  const byCompany = new Map<string, HrOpening[]>();
  for (const o of openings) {
    if (!isCallWorthy(o)) continue;
    const list = byCompany.get(o.companyId);
    if (list) list.push(o);
    else byCompany.set(o.companyId, [o]);
  }

  const entries = companies
    .filter((c) => c.contacts.length > 0)
    .map((company) => {
      const list = (byCompany.get(company.id) ?? []).sort(
        (a, b) => b.discoveredAt.getTime() - a.discoveredAt.getTime(),
      );
      const lastCalledAt = latest(company.contacts.map((c) => c.lastCalledAt));
      const fresh = lastCalledAt
        ? list.filter((o) => o.discoveredAt.getTime() > lastCalledAt.getTime())
        : list;
      const hot = fresh.some(
        (o) => now.getTime() - o.discoveredAt.getTime() <= HOT_WINDOW_DAYS * DAY_MS,
      );

      const tracked = company.active && company.sourceType !== "manual";
      const state: HrState =
        fresh.length > 0 ? "call" : list.length > 0 ? "called" : tracked ? "quiet" : "untracked";

      const primary = pickPrimary(company.contacts);
      const { headline, detail } = describe(state, company, primary, fresh, list, lastCalledAt, now);

      return { company, state, fresh, openings: list, lastCalledAt, primary, hot, headline, detail };
    });

  return entries.sort(compareEntries);
}

/**
 * Worst-first: calls before everything else, and within calls the hottest and best-fitting
 * first. Fit decides ties because a strong match at one company is a better use of a call than
 * a weak one that happens to be a day younger.
 */
function compareEntries(a: HrEntry, b: HrEntry): number {
  if (a.state !== b.state) return STATE_ORDER[a.state] - STATE_ORDER[b.state];
  if (a.state === "call") {
    if (a.hot !== b.hot) return a.hot ? -1 : 1;
    const fit = bestFit(b.fresh) - bestFit(a.fresh);
    if (fit !== 0) return fit;
    return newest(b.fresh) - newest(a.fresh);
  }
  if (a.openings.length !== b.openings.length) return b.openings.length - a.openings.length;
  return a.company.name.localeCompare(b.company.name);
}

function describe(
  state: HrState,
  company: HrCompany,
  primary: HrContact | null,
  fresh: HrOpening[],
  all: HrOpening[],
  lastCalledAt: Date | null,
  now: Date,
): { headline: string; detail: string } {
  const who = primary ? primary.name : `${company.name} HR`;
  const roles = (n: number) => `${n} relevant opening${n === 1 ? "" : "s"}`;

  switch (state) {
    case "call": {
      const since = lastCalledAt
        ? `since you last called ${ago(lastCalledAt, now)}`
        : "and you have not called yet";
      return {
        headline: `Call ${who}`,
        detail: `${roles(fresh.length)} ${since}. Newest found ${ago(new Date(newest(fresh)), now)}.`,
      };
    }
    case "called":
      return {
        headline: `Nothing new since your call`,
        detail: `${roles(all.length)} open, all already there when you called ${ago(lastCalledAt!, now)}.`,
      };
    case "untracked":
      return {
        headline: `Ask ${who} what is open`,
        detail:
          `${company.name} is not crawled automatically, so a new opening here will not ` +
          `show up on its own. The call is the check.`,
      };
    case "quiet":
      return {
        headline: "No relevant openings",
        detail: lastCalledAt
          ? `Last called ${ago(lastCalledAt, now)}. This moves to the top the moment a match appears.`
          : "This moves to the top the moment a match appears.",
      };
  }
}

/** The contact spoken to most recently is the warmest line; otherwise anyone reachable by phone. */
function pickPrimary(contacts: HrContact[]): HrContact | null {
  const called = contacts
    .filter((c) => c.lastCalledAt)
    .sort((a, b) => b.lastCalledAt!.getTime() - a.lastCalledAt!.getTime());
  return called[0] ?? contacts.find((c) => c.phone) ?? contacts[0] ?? null;
}

function latest(dates: (Date | null)[]): Date | null {
  let best: Date | null = null;
  for (const d of dates) if (d && (!best || d.getTime() > best.getTime())) best = d;
  return best;
}

const bestFit = (list: HrOpening[]) => Math.max(0, ...list.map((o) => o.fitScore));
const newest = (list: HrOpening[]) => Math.max(0, ...list.map((o) => o.discoveredAt.getTime()));

/** "today", "yesterday", "5 days ago" — whole calendar-free days, which is all a call needs. */
export function ago(date: Date, now: Date): string {
  const days = Math.floor((now.getTime() - date.getTime()) / DAY_MS);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}
