/**
 * Database schema (Cloudflare D1 / SQLite).
 *
 * Design notes that matter:
 *  - Job identity is `UNIQUE (company_id, external_job_id)`. This constraint is what makes
 *    re-ingesting the same crawl a no-op, so duplicate jobs are impossible at the database level
 *    rather than merely unlikely in code. See docs/decisions/005-job-deduplication.md.
 *  - Notifications are an outbox with a `UNIQUE dedup_key`, so a duplicate email is likewise
 *    unrepresentable. See docs/decisions/007-ingest-boundary-and-notification-outbox.md.
 *  - Jobs are never hard-deleted when they vanish from a crawl; `closedAt` is set only after
 *    `missingRunCount` exceeds a threshold across *successful* runs, so a broken adapter cannot
 *    wipe the board. See docs/decisions/008-crawler-correctness-strategy.md.
 *  - JSON is stored as TEXT (SQLite has no JSONB). Columns holding JSON are typed via
 *    `.$type<T>()` so callers get real types, with parsing handled in the repository layer.
 */

import { sql } from "drizzle-orm";

import type { FitBand, FitSignal } from "@/server/domain/fit";
import type { CompanyMatchOverrides } from "@/server/domain/matching";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import {
  DEFAULT_MATCH_RULES,
  type MatchRules,
} from "../server/domain/matching";

const uuid = () => crypto.randomUUID();

/** Unix-epoch-millisecond timestamp, defaulting to now. */
const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`);

const updatedAt = () =>
  integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`);

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

/** Which adapter handles a company. Mirrors the tier ladder in docs/crawlers.md. */
export type SourceType =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "smartrecruiters"
  | "workday"
  | "custom_json"
  | "jsonld"
  | "html"
  | "manual";

/**
 * Everything company-specific that can be data, is data — so adding a tier 1-2 company is a row,
 * not a code change (PRD §97). Shape varies by source type; adapters validate their own slice.
 */
export type SourceConfig = {
  /** greenhouse */
  boardToken?: string;
  /** lever / ashby */
  slug?: string;
  /** smartrecruiters */
  companyId?: string;
  /** workday: tenant, data-centre shard (wd1/wd3/wd5...), and site slug */
  tenant?: string;
  dataCenter?: string;
  site?: string;
  /** html / jsonld fallbacks */
  listSelector?: string;
  titleSelector?: string;
  urlSelector?: string;
  /** free-form escape hatch for custom adapters */
  [key: string]: unknown;
};

export type HealthStatus =
  | "unknown"
  | "healthy"
  | "degraded"
  | "suspicious"
  | "failing";

export const companies = sqliteTable(
  "companies",
  {
    id: text("id").primaryKey().$defaultFn(uuid),
    name: text("name").notNull(),
    websiteUrl: text("website_url"),
    careersUrl: text("careers_url"),

    sourceType: text("source_type").$type<SourceType>().notNull(),
    /** 1 = most stable (ATS feed) ... 6 = manual. See docs/crawlers.md. */
    sourceTier: integer("source_tier").notNull().default(6),
    sourceConfig: text("source_config", { mode: "json" })
      .$type<SourceConfig>()
      .notNull()
      .default({}),

    /**
     * Company-specific title vocabulary, e.g. `{"levelTitles": ["senior software engineer"]}`.
     *
     * Job ladders are not comparable across companies: Sarthak's level is "SDE II" at Amazon,
     * "Senior Software Engineer" at Confluent and "Software Engineer III" at Google. A global
     * rule set cannot express that, so each company carries its own vocabulary as data — no
     * deploy needed to teach the matcher a new ladder. See domain/matching.ts.
     */
    matchOverrides: text("match_overrides", { mode: "json" })
      .$type<CompanyMatchOverrides>(),

    active: integer("active", { mode: "boolean" }).notNull().default(true),

    /**
     * Zero results is an error by default. A genuinely empty board must opt in, otherwise a
     * silently broken adapter is indistinguishable from "no openings".
     */
    allowZeroResults: integer("allow_zero_results", { mode: "boolean" })
      .notNull()
      .default(false),

    /** Conditional-request cache keys; a 304 short-circuits the whole company. */
    etag: text("etag"),
    lastModified: text("last_modified"),
    /** Hash of the last raw listing response; identical hash skips parsing and ingest. */
    lastContentHash: text("last_content_hash"),

    lastCrawledAt: integer("last_crawled_at", { mode: "timestamp_ms" }),
    lastSuccessAt: integer("last_success_at", { mode: "timestamp_ms" }),
    healthStatus: text("health_status")
      .$type<HealthStatus>()
      .notNull()
      .default("unknown"),
    lastError: text("last_error"),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("companies_name_unique").on(t.name),
    index("companies_active_idx").on(t.active),
    index("companies_health_idx").on(t.healthStatus),
  ],
);

// ---------------------------------------------------------------------------
// Referral contacts — intentionally minimal. This is not a CRM (PRD §10).
// ---------------------------------------------------------------------------

export const contacts = sqliteTable(
  "contacts",
  {
    id: text("id").primaryKey().$defaultFn(uuid),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    /** Referrals often start on LinkedIn rather than a phone number, so it is a first-class
     *  field rather than something buried in notes. */
    linkedinUrl: text("linkedin_url"),
    /**
     * This contact genuinely shares a phone number with someone else.
     *
     * The duplicate-number check exists because a mistyped number is otherwise invisible — it
     * once sent a Swiggy referral request into Google HR's chat. But sharing is sometimes real
     * (a shared work phone, one person known by two names), and an alarm that cannot be
     * silenced is one you stop reading, which would cost exactly the bug it was added to catch.
     */
    sharedNumberOk: integer("shared_number_ok", { mode: "boolean" })
      .notNull()
      .default(false),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("contacts_company_idx").on(t.companyId)],
);

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey().$defaultFn(uuid),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),

    /**
     * The source's own stable requisition id. Never synthesised, never derived from a title —
     * an unstable value here means every crawl looks new and the notifications become noise.
     */
    externalJobId: text("external_job_id").notNull(),

    title: text("title").notNull(),
    location: text("location"),
    department: text("department"),
    description: text("description"),

    jobUrl: text("job_url").notNull(),
    /** Lowercased host, query and fragment stripped — the fallback dedup key. */
    normalizedJobUrl: text("normalized_job_url").notNull(),

    /** A real date or null. Never a display string like "Posted Today". */
    postedAt: integer("posted_at", { mode: "timestamp_ms" }),
    discoveredAt: integer("discovered_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),

    source: text("source").$type<SourceType>().notNull(),
    employmentType: text("employment_type"),
    rawMetadata: text("raw_metadata", { mode: "json" }).$type<
      Record<string, unknown>
    >(),

    /** Relevance is computed server-side at ingest, from settings keywords. */
    isRelevant: integer("is_relevant", { mode: "boolean" })
      .notNull()
      .default(false),
    matchScore: integer("match_score").notNull().default(0),
    /** Human-readable explanation, so every decision is auditable in the UI. */
    matchReason: text("match_reason"),
    /**
     * Rank of the matched location in Sarthak's preference order
     * (1 Bangalore, 2 Gurgaon, 3 Remote, 4 Hyderabad). Null when the posting gave no location.
     * Stored explicitly rather than inferred from matchScore so the board can sort by
     * location preference and recency independently.
     */
    locationPriority: integer("location_priority"),

    /**
     * Fit against Sarthak's resume, 0-100, computed at ingest by domain/fit.ts. Distinct from
     * matchScore, which decides whether a job belongs on the board at all: fit ranks the ones
     * that already qualify. Stored rather than computed on read so the board can sort by it in
     * SQL, and so a profile change is a visible, deliberate re-score rather than a silent shift.
     */
    fitScore: integer("fit_score").notNull().default(0),
    fitBand: text("fit_band").$type<FitBand>(),
    /** The named signals behind the score, so the UI never shows a number it cannot justify. */
    fitSignals: text("fit_signals", { mode: "json" }).$type<FitSignal[]>(),
    /**
     * True when the source published no description and the score rests on the title alone.
     * Surfaced in the UI because "we could not assess this" and "this is a poor match" are
     * different statements, and a score alone cannot tell them apart.
     */
    fitTitleOnly: integer("fit_title_only", { mode: "boolean" }).notNull().default(false),

    /** Absence tracking — see the deletion-grace rule in ADR 008. */
    /**
     * Marked as read: seen and consciously passed over, without entering the pipeline.
     *
     * Distinct from `closedAt` (the posting is gone) and from an application stage (you acted on
     * it). Without this the board has no way to say "I have looked at this one", so the same
     * fifty roles read as new every morning and the genuinely new ones stop standing out.
     */
    readAt: integer("read_at", { mode: "timestamp_ms" }),

    missingRunCount: integer("missing_run_count").notNull().default(0),
    closedAt: integer("closed_at", { mode: "timestamp_ms" }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // The one identity constraint, and what makes re-ingestion a no-op.
    uniqueIndex("jobs_company_external_unique").on(t.companyId, t.externalJobId),
    // NOT unique, deliberately. The normalized URL is a *fallback* identity: adapters for
    // sources with no stable requisition id derive external_job_id from it, so the constraint
    // above still covers them. Enforcing URL uniqueness independently is wrong -- Greenhouse
    // boards legitimately share one path across every posting, distinguished only by a query
    // parameter, so it rejected 869 of Databricks' 870 jobs. Kept as a plain index for lookups.
    index("jobs_company_url_idx").on(t.companyId, t.normalizedJobUrl),
    index("jobs_relevant_idx").on(t.isRelevant),
    index("jobs_discovered_idx").on(t.discoveredAt),
    index("jobs_company_idx").on(t.companyId),
    index("jobs_closed_idx").on(t.closedAt),
  ],
);

// ---------------------------------------------------------------------------
// Applications — exactly five stages (PRD §30). Do not add more.
// ---------------------------------------------------------------------------

export const APPLICATION_STATUSES = [
  "saved",
  "requested",
  "referred",
  "applied",
  "interviews",
  "selected",
  "rejected",
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const applications = sqliteTable(
  "applications",
  {
    id: text("id").primaryKey().$defaultFn(uuid),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),

    status: text("status").$type<ApplicationStatus>().notNull().default("saved"),
    notes: text("notes"),

    /** Only timestamps that drive behaviour. requestedAt powers follow-up reminders. */
    requestedAt: integer("requested_at", { mode: "timestamp_ms" }),
    referredAt: integer("referred_at", { mode: "timestamp_ms" }),
    appliedAt: integer("applied_at", { mode: "timestamp_ms" }),
    /** When the process ended, either way. Both outcomes stamp this. */
    closedOutAt: integer("closed_out_at", { mode: "timestamp_ms" }),

    interviewStartedAt: integer("interview_started_at", {
      mode: "timestamp_ms",
    }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // One application per job — the Kanban card *is* the job's pipeline state.
    uniqueIndex("applications_job_unique").on(t.jobId),
    index("applications_status_idx").on(t.status),
    index("applications_requested_idx").on(t.requestedAt),
  ],
);

// ---------------------------------------------------------------------------
// Message templates
// ---------------------------------------------------------------------------

export const templates = sqliteTable("templates", {
  id: text("id").primaryKey().$defaultFn(uuid),
  name: text("name").notNull(),
  /** Body with {{variable}} placeholders; variables are detected, not declared. */
  body: text("body").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------
// Notification outbox
// ---------------------------------------------------------------------------

export type NotificationType = "new_job" | "follow_up" | "crawler_health";
export type NotificationStatus = "pending" | "sent" | "failed";

export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey().$defaultFn(uuid),

    /**
     * Makes a duplicate notification impossible at the database level.
     * e.g. "new_job:{jobId}" or "follow_up:{applicationId}:{nthReminder}".
     */
    dedupKey: text("dedup_key").notNull(),

    notificationType: text("notification_type")
      .$type<NotificationType>()
      .notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),

    channel: text("channel").notNull().default("email"),
    status: text("status")
      .$type<NotificationStatus>()
      .notNull()
      .default("pending"),

    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>(),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),

    sentAt: integer("sent_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("notifications_dedup_unique").on(t.dedupKey),
    index("notifications_status_idx").on(t.status),
  ],
);

// ---------------------------------------------------------------------------
// Settings — single row (id = 1). Keywords live here, not in code, so changing
// them takes effect immediately with no crawler redeploy.
// ---------------------------------------------------------------------------

/**
 * A digest email exactly as it was sent.
 *
 * The notifications table records *what was queued*; this records *what landed in the inbox* —
 * the real subject line, the real body, the recipient and the moment it went out. Reconstructing
 * that from the notification rows would be a guess that drifts the first time the template
 * changes, and "what did that 06:30 email actually say" is precisely the question this needs to
 * answer.
 */
export const emailDigests = sqliteTable("email_digests", {
  id: text("id").primaryKey().$defaultFn(uuid),
  subject: text("subject").notNull(),
  bodyText: text("body_text").notNull(),
  recipient: text("recipient"),
  /** How many notifications this one email covered. */
  notificationCount: integer("notification_count").notNull().default(0),
  sentAt: integer("sent_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: createdAt(),
});

export type EmailDigest = typeof emailDigests.$inferSelect;

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey().default(1),

  resumeUrl: text("resume_url"),
  notifyEmail: text("notify_email"),

  /**
   * The matching rule set: title patterns, experience bounds, and location allow-list with
   * ranking. Stored as data so Sarthak can retune what counts as a match without a code change
   * or a crawler redeploy, and so existing jobs can be re-matched retroactively.
   * See src/server/domain/matching.ts.
   */
  matchRules: text("match_rules", { mode: "json" })
    .$type<MatchRules>()
    .notNull()
    .default(DEFAULT_MATCH_RULES),

  /** Days in "requested" before a referral follow-up is surfaced (PRD §33). */
  followUpDays: integer("follow_up_days").notNull().default(5),
  /** Consecutive successful runs a job must be absent from before it is closed. */
  closeAfterMissingRuns: integer("close_after_missing_runs")
    .notNull()
    .default(3),

  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------
// Crawl runs — per-company observability. Powers the health UI and drift detection.
// ---------------------------------------------------------------------------

export type CrawlStatus =
  | "success"
  | "failed"
  | "suspicious"
  | "degraded"
  | "skipped";

export const crawlRuns = sqliteTable(
  "crawl_runs",
  {
    id: text("id").primaryKey().$defaultFn(uuid),
    /** Groups all per-company rows from a single scheduled execution. */
    runId: text("run_id").notNull(),
    companyId: text("company_id").references(() => companies.id, {
      onDelete: "cascade",
    }),

    status: text("status").$type<CrawlStatus>().notNull(),
    tier: integer("tier"),

    jobsFound: integer("jobs_found").notNull().default(0),
    newJobs: integer("new_jobs").notNull().default(0),
    durationMs: integer("duration_ms"),
    /** Populated on skip (304 Not Modified, or unchanged content hash). */
    skipReason: text("skip_reason"),
    error: text("error"),

    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    index("crawl_runs_company_idx").on(t.companyId),
    index("crawl_runs_run_idx").on(t.runId),
    index("crawl_runs_started_idx").on(t.startedAt),
  ],
);

// ---------------------------------------------------------------------------

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type Application = typeof applications.$inferSelect;
export type NewApplication = typeof applications.$inferInsert;
export type Template = typeof templates.$inferSelect;
export type NewTemplate = typeof templates.$inferInsert;
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type Settings = typeof settings.$inferSelect;
export type CrawlRun = typeof crawlRuns.$inferSelect;
export type NewCrawlRun = typeof crawlRuns.$inferInsert;

// ---------------------------------------------------------------------------
// Phase 1 — interview preparation
// ---------------------------------------------------------------------------

/**
 * One table for all three preparation disciplines rather than three tables.
 *
 * DSA questions, system design problems and behavioural stories share most of what matters --
 * a title, the companies that ask it, your notes, and whether you have actually done it. What
 * differs is the *shape of the answer*: a DSA question wants an approach and complexity, a
 * system design wants requirements and trade-offs, a behavioural story wants situation and
 * outcome. That difference lives in a JSON `content` column.
 *
 * This is what PRD §45 asks for -- room for low-level design, Golang, databases and
 * company-specific rounds without a rewrite. Adding a discipline is a new `kind`, not a
 * migration. And when Sarthak's Notion export arrives (PRD §39), importing it means mapping
 * fields into `content` rather than reshaping the schema around it.
 */
export const PREP_KINDS = ["dsa", "system_design", "behavioral", "concept"] as const;
export type PrepKind = (typeof PREP_KINDS)[number];

export const PREP_STATUSES = ["not_started", "in_progress", "done", "revisit"] as const;
export type PrepStatus = (typeof PREP_STATUSES)[number];

export const PREP_DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type PrepDifficulty = (typeof PREP_DIFFICULTIES)[number];

/** Discipline-specific fields. Every key optional: a row only fills what its kind needs. */
export type PrepContent = {
  /** dsa */
  approach?: string;
  complexity?: string;
  pattern?: string;
  /** system_design */
  requirements?: string;
  architecture?: string;
  tradeoffs?: string;
  /** behavioral */
  situation?: string;
  action?: string;
  outcome?: string;
  /** shared */
  references?: { label: string; url: string }[];
  [key: string]: unknown;
};

export const prepItems = sqliteTable(
  "prep_items",
  {
    id: text("id").primaryKey().$defaultFn(uuid),
    kind: text("kind").$type<PrepKind>().notNull(),
    /** URL-safe identifier, stable across edits so links do not rot. */
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    prompt: text("prompt"),

    difficulty: text("difficulty").$type<PrepDifficulty>(),
    /** 1-5, how often this comes up in interviews. Drives the default sort. */
    frequency: integer("frequency").notNull().default(0),

    /** JSON arrays. At a few hundred rows, filtering these in the service layer is cheaper
     *  than the join tables a relational purist would reach for -- and D1 counts queries. */
    topics: text("topics", { mode: "json" }).$type<string[]>().notNull().default([]),
    companies: text("companies", { mode: "json" }).$type<string[]>().notNull().default([]),

    status: text("status").$type<PrepStatus>().notNull().default("not_started"),
    notes: text("notes"),
    solution: text("solution"),
    content: text("content", { mode: "json" }).$type<PrepContent>().notNull().default({}),
    sourceUrl: text("source_url"),

    lastPracticedAt: integer("last_practiced_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("prep_kind_slug_unique").on(t.kind, t.slug),
    index("prep_kind_idx").on(t.kind),
    index("prep_status_idx").on(t.status),
    index("prep_frequency_idx").on(t.frequency),
  ],
);

export type PrepItem = typeof prepItems.$inferSelect;
export type NewPrepItem = typeof prepItems.$inferInsert;
