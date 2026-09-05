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
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

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

    /** Absence tracking — see the deletion-grace rule in ADR 008. */
    missingRunCount: integer("missing_run_count").notNull().default(0),
    closedAt: integer("closed_at", { mode: "timestamp_ms" }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // The constraint that makes re-ingestion a no-op.
    uniqueIndex("jobs_company_external_unique").on(t.companyId, t.externalJobId),
    // Fallback identity for sources with no stable id.
    uniqueIndex("jobs_company_url_unique").on(t.companyId, t.normalizedJobUrl),
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

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey().default(1),

  resumeUrl: text("resume_url"),
  notifyEmail: text("notify_email"),

  includeKeywords: text("include_keywords", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default([]),
  excludeKeywords: text("exclude_keywords", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default([]),
  preferredLocations: text("preferred_locations", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default([]),

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
