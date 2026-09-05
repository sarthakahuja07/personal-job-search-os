# Personal Job Search OS — Product Requirements Document (PRD)

> **Document status:** Master PRD  
> **Audience:** Sarthak and Claude Code  
> **Purpose:** Build a private, single-user Job Search OS that helps Sarthak discover relevant SDE-2/SWE-2 jobs early, use referrals efficiently, track applications, and later organize interview preparation.

---

# 1. Executive Summary

Build a private personal web application for **Sarthak**, designed to support his journey toward securing his next **SDE-2 / SWE-2 / Software Engineer II** role.

Sarthak previously worked as a **Software Engineer at Uber**. The application should act as a single operating system for his job search and interview preparation.

The product will eventually include:

- Target company management
- Automated job discovery
- Job listing aggregation
- Relevant-role matching
- New job notifications
- Referral contact management
- Message templates with variables
- Application tracking
- Follow-up reminders
- Dashboard and job-search progress
- DSA preparation database
- System design preparation
- Other interview preparation material

However, development must be phased.

## Current priority

### Phase 0 — Job Discovery and Application Workflow

The first thing to build is the system that helps Sarthak:

1. Maintain a list of target companies.
2. Automatically discover relevant open roles.
3. Detect newly posted jobs.
4. Notify him when relevant roles appear.
5. Surface referral contacts associated with each company.
6. Generate referral outreach messages quickly.
7. Track applications through a simple pipeline.
8. Show follow-ups and important actions on a dashboard.

The immediate goal is simple:

> **Discover relevant jobs as early as possible so Sarthak can quickly request referrals and apply.**

---

# 2. User Context

## Primary User

This application is currently built for one user only:

**Sarthak**

Professional context:

- Previously worked at Uber.
- Currently searching for his next software engineering role.
- Primary target level: **SDE-2 / SWE-2 / Software Engineer II**.
- Will likely target backend and general software engineering opportunities based on his experience.

This application is not intended to be a SaaS product or multi-user platform.

## Resume

Sarthak has an existing resume and resume link that should be treated as a canonical profile asset.

The canonical resume link must be:

- Configurable in application settings.
- Reusable in message templates.
- Easy to update.
- Referenced dynamically instead of hardcoded across the application.

When the resume link is available in the implementation context, store it in configuration/settings rather than duplicating it.

---

# 3. Product Vision

Create a personal internal tool that answers questions such as:

- Which companies am I targeting?
- Which relevant jobs are currently open?
- Which jobs are new?
- Which companies have I not checked recently?
- Who can refer me at a particular company?
- Have I requested a referral yet?
- Who should I follow up with?
- Which applications are active?
- What requires my attention today?
- How is my overall job search progressing?

Eventually, the same application should also answer:

- What DSA questions should I practice?
- What topics am I weak in?
- Which system design questions have I completed?
- What questions are frequently asked?
- Which companies ask specific questions?

The product should feel like:

> **A personal Job Search and Interview Preparation OS.**

---

# 4. Product Principles

The application should optimize for:

1. **Speed** — Sarthak should be able to discover and act on jobs quickly.
2. **Low friction** — Common workflows should require very few clicks.
3. **Single source of truth** — Information should not be scattered across Notion, spreadsheets, browser bookmarks, etc.
4. **Simple UX** — Avoid enterprise complexity.
5. **Personalized workflows** — Optimize for one user.
6. **Low cost** — Prefer free infrastructure and free tiers.
7. **Maintainability** — Production-quality modular code.
8. **Extensibility** — Future phases should not require rewriting Phase 0.
9. **Automation where useful** — Reduce repetitive manual checking.
10. **No unnecessary features** — Follow YAGNI.

---

# 5. Scope and Phases

## Phase 0 — Job Discovery and Application Workflow

Build:

- Dashboard
- Company management
- Referral contact management
- Automated job discovery
- Job crawlers
- Job normalization
- Relevance matching
- Job board
- Job filters and search
- New-job detection
- Email notifications
- Notification history
- Message templates
- Template variable filling
- Application Kanban board
- Follow-up reminders
- Job-search progress indicators
- Admin/settings area

This is the current priority.

---

## Phase 1 — Interview Preparation

Build:

### DSA preparation

- Question database
- Categories
- Tags
- Search
- Sorting
- Difficulty
- Frequency
- Companies associated with questions
- Notes
- Solutions
- Links/import from Notion
- Completion tracking

### System design

- System design question database
- Topics
- Notes
- Solutions
- Architecture references
- Completion tracking

### Other preparation

Potential categories:

- Behavioral questions
- Low-level design
- Backend concepts
- Distributed systems
- Databases
- Golang
- Python
- Company-specific preparation

The exact structure of Phase 1 will be finalized after Sarthak provides the existing Notion format and content.

---

# 6. Phase 0 User Stories

## Company Management

As Sarthak, I want to add companies I am targeting so that the system knows where to discover jobs.

As Sarthak, I want to see all target companies in one place.

As Sarthak, I want to configure each company's job portal URL or source.

As Sarthak, I want to mark companies as active or inactive targets.

---

## Job Discovery

As Sarthak, I want the system to automatically check target companies for new jobs.

As Sarthak, I want relevant SDE-2/SWE-2 roles surfaced automatically.

As Sarthak, I want duplicate jobs avoided.

As Sarthak, I want new jobs clearly marked.

As Sarthak, I want to open the original company job listing directly.

---

## Notifications

As Sarthak, I want to receive an email when a relevant new job is discovered.

As Sarthak, I want notifications to avoid repeatedly alerting me about the same job.

As Sarthak, I want to see notification history.

WhatsApp notifications may be added later, but email is the primary Phase 0 notification channel.

---

## Referral Contacts

As Sarthak, I want to store a few contacts for each company.

Each contact only needs:

- Name
- Mobile number
- Email

Potentially:

- Optional notes

This is intentionally lightweight.

Do not build a CRM.

---

## Message Templates

As Sarthak, I want to select a message template and fill in a few values.

For example:

1. Select template:
   - Casual connection
2. Enter/select:
   - Person name
   - Company
   - Job role
   - Job link if relevant
3. The application generates the final message.

Example use case:

> Hi [Name], hope you're doing well! I saw a [Role] opening at [Company] that I'm interested in. Would you be open to referring me?

The actual message should be editable before copying.

---

## Application Tracking

As Sarthak, I want a simple Kanban board.

The required statuses are:

```text
Saved
Requested
Referred
Applied
Interviews
```

Avoid adding unnecessary pipeline stages initially.

---

## Dashboard

As Sarthak, I want the homepage to tell me what requires attention.

Examples:

- New jobs discovered.
- Referral request awaiting follow-up.
- Application that needs action.
- Recently added jobs.
- Target companies with new openings.

The dashboard should be intelligent but simple.

Example:

If an application or job is marked:

```text
Requested
```

and a referral request has been pending for a configurable period, surface:

> Follow up with your Microsoft referral.

The dashboard should prioritize actionable information.

---

# 7. Primary Navigation

Recommended navigation:

```text
Dashboard

Jobs

Companies

Applications

Templates

Notifications

Settings
```

Phase 1 can later add:

```text
Preparation

DSA

System Design
```

Do not expose Phase 1 sections as unfinished product pages unless intentionally designed as placeholders.

---

# 8. Dashboard Requirements

The dashboard is the application homepage.

It should answer:

> What should I do next?

## Dashboard sections

### 8.1 Attention Required

Examples:

- Follow up on referral.
- New jobs available.
- Application requires action.
- Recently discovered high-priority role.

### 8.2 New Jobs

Display:

- Company
- Role
- Location if available
- Job age
- New indicator
- Link to job

### 8.3 Referral Follow-ups

Display:

- Company
- Contact
- Days since request
- Suggested action

### 8.4 Application Overview

Display counts by stage:

```text
Saved
Requested
Referred
Applied
Interviews
```

### 8.5 Job Search Progress

Simple metrics such as:

- Target companies
- Companies with discovered jobs
- Jobs discovered
- Applications submitted
- Active interview processes

Avoid gamification unless later requested.

---

# 9. Company Management

Each company is a central entity in the application.

## Company fields

Minimum:

```text
id

name

website_url

careers_url

job_source_type

active

created_at

updated_at
```

Potential job source types:

```text
Greenhouse

Lever

Workday

Custom

Other
```

## Company page

Each company should show:

- Company information
- Careers source
- Open jobs
- Relevant jobs
- Referral contacts
- Application activity

---

# 10. Referral Contacts

Referral contacts belong to companies.

## Contact fields

```text
id

company_id

name

email

phone

notes

created_at

updated_at
```

Keep this intentionally simple.

## UX

From a company page or job page, Sarthak should quickly see:

> Your contacts at Databricks

For each contact:

- Name
- Email
- Phone

Actions may include:

- Copy email
- Copy phone number
- Generate message
- Open WhatsApp

The WhatsApp action should use a properly formatted phone number when available.

---

# 11. Job Discovery System

The job discovery system is the most important component of Phase 0.

## Goal

Automatically discover jobs from companies that Sarthak explicitly targets.

## Workflow

```text
Target Company
      ↓
Scheduled Crawl
      ↓
Platform / Company Adapter
      ↓
Raw Job Listings
      ↓
Normalization
      ↓
Validation
      ↓
Deduplication
      ↓
Relevance Matching
      ↓
Database
      ↓
New Job Detection
      ↓
Notification
      ↓
Dashboard / Job Board
```

---

# 12. Target Role Matching

The system should initially prioritize roles relevant to Sarthak's search.

Examples:

```text
Software Engineer II

Software Engineer 2

SDE 2

SDE-II

SWE 2

Software Development Engineer II

Backend Engineer

Software Engineer
```

Role matching should be configurable.

## Avoid simplistic exact matching

The system should not only search for:

```text
"SDE 2"
```

It should support keyword and pattern matching.

## Role configuration

Create configurable target-role settings.

Potential configuration:

```text
Include Keywords

Exclude Keywords

Preferred Levels

Preferred Locations
```

The initial matching logic should remain explainable and simple.

Do not build an ML system.

---

# 13. Job Crawlers

The crawler system should primarily use Python.

Recommended libraries:

```text
requests

BeautifulSoup
```

Use browser automation only when genuinely required.

Avoid expensive or unnecessarily complex scraping infrastructure.

## Important requirement

Do not build one giant crawler script with company-specific conditionals.

Use a modular adapter architecture.

---

# 14. Crawler Adapter Architecture

Suggested architecture:

```text
Crawler Orchestrator
        ↓
Source Resolver
        ↓
Platform Adapter
        ↓
Company-specific Adapter if required
        ↓
Raw Job Data
        ↓
Normalization
```

## Platform adapters

Potential adapters:

```text
GreenhouseAdapter

LeverAdapter

WorkdayAdapter

CustomAdapter
```

## Company-specific adapters

Only create these when the platform adapter cannot support the company.

Example:

```text
MicrosoftCustomAdapter
```

if necessary.

---

# 15. Crawler Responsibilities

Each crawler adapter should:

1. Fetch job listings.
2. Parse relevant fields.
3. Return a normalized intermediate representation.

It should not:

- Send notifications.
- Directly implement application logic.
- Contain unrelated business logic.

---

# 16. Job Normalization

Raw jobs from different platforms will vary.

Create a normalized job model.

Suggested fields:

```text
id

company_id

external_job_id

title

location

department

description

job_url

posted_at

discovered_at

source

employment_type

raw_metadata

is_relevant

created_at

updated_at
```

Fields can be adjusted based on actual crawler sources.

---

# 17. Job Deduplication

The crawler must be idempotent.

Running the crawler repeatedly must not create duplicate jobs.

Possible uniqueness strategy:

```text
company_id + external_job_id
```

Fallback strategies may use:

```text
company_id + normalized_job_url
```

or another documented stable identifier.

The exact deduplication strategy should be documented in an Architecture Decision Record.

---

# 18. New Job Detection

A job is considered new when:

- It did not previously exist in the database.

When a new relevant job is discovered:

1. Save it.
2. Mark it as new.
3. Create a notification event.
4. Send an email if notification rules allow.

Notification delivery must be idempotent.

The same job should not repeatedly generate alerts.

---

# 19. Job Relevance Matching

After normalization, each job should pass through relevance matching.

Suggested initial logic:

### Include signals

- Software Engineer
- Backend Engineer
- SDE
- SWE
- Engineer II
- Level 2 equivalents

### Exclude signals

Examples may include:

- Intern
- Senior
- Staff
- Principal

However, exclusion logic must be configurable because companies use inconsistent titles.

## Match result

Store:

```text
is_relevant

match_reason

match_score
```

A simple deterministic score is acceptable.

Do not over-engineer this initially.

---

# 20. Crawler Scheduling

The system should prioritize free infrastructure.

Initial scheduling options:

### GitHub Actions

Run scheduled crawlers approximately:

```text
Every 3 hours
```

or another schedule that fits free-tier limits.

Not every company necessarily needs the same schedule.

Potential future configuration:

```text
Company Crawl Frequency
```

For Phase 0, keep scheduling simple.

---

# 21. GitHub Actions Crawler Workflow

Suggested workflow:

```text
GitHub Actions Trigger
        ↓
Checkout Repository
        ↓
Setup Python
        ↓
Run Crawlers
        ↓
Normalize Jobs
        ↓
Store Results
        ↓
Detect New Jobs
        ↓
Trigger Notifications
```

Secrets must never be committed to the repository.

---

# 22. Crawler Failure Handling

One company's failure should not fail the entire crawl run.

Example:

```text
Microsoft crawler fails
        ↓
Log failure
        ↓
Continue Databricks crawler
        ↓
Continue remaining companies
```

Store useful error information where appropriate.

---

# 23. Crawler Logging

Log important events:

```text
Crawler Started

Company Crawl Started

Company Crawl Completed

Jobs Found

New Jobs Found

Company Crawl Failed

Notification Triggered
```

Use structured logging where practical.

Avoid excessive logs.

---

# 24. Job Board

The job board is the primary job discovery interface.

## Requirements

Users should be able to:

- View all discovered jobs.
- Search jobs.
- Filter jobs.
- Sort jobs.
- Identify new jobs.
- Open original listings.
- View company details.
- View available referral contacts.

## Filters

Suggested filters:

```text
Company

Relevance

Location

Job Status

Date Discovered

New Jobs
```

## Sorting

Suggested sorting:

```text
Newest Discovered

Newest Posted

Company

Role
```

---

# 25. Job Detail Page

Each job should display:

```text
Job Title

Company

Location

Description

Original Job Link

Date Posted

Date Discovered

Relevance Information
```

It should also display:

## Referral Contacts

```text
Your contacts at this company
```

Each contact should support:

- Copy contact information.
- Generate outreach message.
- WhatsApp action when phone is available.

## Application Actions

Potential quick actions:

```text
Save

Request Referral

Mark Referred

Mark Applied

Move to Interviews
```

---

# 26. Message Templates

The application should support reusable templates.

Templates should not simply be static blocks of text.

They should support variables.

---

# 27. Template Examples

## Casual Connection

Inputs:

```text
Person Name

Company

Role
```

Example output:

```text
Hi [Name], hope you're doing well! I saw a [Role] opening at [Company] that I'm interested in. Would you be open to referring me?
```

---

## Senior / Professional Connection

Inputs:

```text
Person Name

Company

Role

Optional Context
```

---

## Email Referral Request

Inputs:

```text
Person Name

Company

Role

Job Link

Resume Link
```

The resume link should default to the canonical resume link stored in settings.

---

# 28. Template Variable System

Templates should support placeholders such as:

```text
{{name}}

{{company}}

{{role}}

{{job_link}}

{{resume_link}}
```

The implementation should:

1. Select a template.
2. Detect required variables.
3. Present input fields.
4. Fill variables.
5. Generate final message.
6. Allow editing.
7. Allow copying.

---

# 29. Template UX

Suggested workflow:

```text
Select Template
      ↓
Fill Required Fields
      ↓
Preview Message
      ↓
Edit Message
      ↓
Copy
```

The user should not have to manually edit placeholders.

---

# 30. Application Pipeline

The application pipeline should remain intentionally simple.

Required stages:

```text
Saved

Requested

Referred

Applied

Interviews
```

Do not add stages such as:

```text
Recruiter Screen

Phone Screen

Onsite

Offer

Rejected
```

unless Sarthak explicitly requests them later.

---

# 31. Kanban Board

The application page should primarily use a Kanban board.

Columns:

```text
Saved

Requested

Referred

Applied

Interviews
```

Jobs/applications should be movable between columns.

Manual movement is sufficient initially.

---

# 32. Application Fields

Suggested fields:

```text
id

job_id

company_id

status

notes

requested_at

referred_at

applied_at

interview_started_at

created_at

updated_at
```

Only store timestamps that are useful.

Avoid excessive tracking.

---

# 33. Referral Follow-up Logic

When an application is in:

```text
Requested
```

the dashboard should eventually surface a follow-up reminder.

Example:

```text
Referral requested 5 days ago

Follow up with:
[Contact Name]
Microsoft
```

The follow-up threshold should be configurable.

Default may initially be:

```text
3–7 days
```

The exact default can be finalized during implementation.

---

# 34. Notifications

Phase 0 notifications should primarily use email.

Notification events may include:

```text
New Relevant Job

Follow-up Reminder
```

The architecture should allow additional channels later.

Potential future channels:

```text
WhatsApp
```

Do not build WhatsApp integration unless it can be implemented legally, reliably, and without unnecessary cost.

---

# 35. Notification History

Store notification records.

Suggested fields:

```text
id

notification_type

entity_type

entity_id

channel

sent_at

status

metadata
```

The goal is to:

- Prevent duplicate notifications.
- Debug delivery issues.
- Show notification history.

---

# 36. Email Infrastructure

The product must prioritize free infrastructure.

Preferred approach:

Use a free or free-tier email mechanism compatible with the selected infrastructure.

Potential Cloudflare-related email capabilities may be evaluated, but implementation decisions must be based on current technical constraints and actual capabilities.

Claude Code must verify the current capabilities of the chosen email solution before implementation.

Do not assume a Cloudflare product can send transactional email without confirming it.

If a third-party provider is required:

- Prefer a genuinely free tier.
- Ask Sarthak before introducing a service.
- Do not introduce paid infrastructure without approval.

---

# 37. Admin and Settings Area

Since this is a single-user application, an admin/settings area should provide management interfaces.

## Companies

- Add company.
- Edit company.
- Delete/deactivate company.
- Configure careers URL.
- Configure source type.

## Contacts

- Add referral contact.
- Edit contact.
- Remove contact.

## Target Role Configuration

- Include keywords.
- Exclude keywords.
- Preferred titles.
- Optional locations.

## Resume

- Canonical resume URL.

## Notification Settings

- Email address.
- Notification preferences.
- Follow-up reminder settings.

---

# 38. Authentication

The application is private and single-user.

Authentication should be simple and secure.

Claude Code should choose the simplest appropriate approach based on deployment architecture.

Potential options may include:

- Cloudflare Access.
- Application-level authentication.
- Another simple single-user mechanism.

Do not expose the application publicly without access control.

Do not build a full multi-user authentication system.

The final choice should be documented in an Architecture Decision Record.

---

# 39. Future Phase 1 — DSA Preparation

Phase 1 will build an interview preparation workspace.

The exact data model will be informed by Sarthak's existing Notion content.

The application must eventually support importing or migrating preparation data from Notion.

---

# 40. DSA Question Database

Each question should eventually support:

```text
Title

Question Description

Difficulty

Tags

Topics

Companies

Frequency

Links

Solution

Notes

Status

Created At

Updated At
```

Example tags:

```text
DP

Graphs

Trees

Arrays

Binary Search

Sliding Window
```

---

# 41. DSA Search and Filtering

Support:

```text
Search by Title

Search by Tag

Filter by Topic

Filter by Difficulty

Filter by Company

Filter by Frequency

Completion Status
```

---

# 42. DSA Sorting

Support:

```text
Difficulty

Frequency

Recently Added

Recently Practiced
```

---

# 43. Question Detail Page

A question page should eventually include:

```text
Question

Tags

Difficulty

Companies

Notes

Solution

Related Questions
```

---

# 44. System Design Preparation

Future functionality may include:

```text
System Design Questions

Topics

Requirements

Architecture

Tradeoffs

Notes

References

Completion Status
```

---

# 45. Other Interview Preparation

Future categories may include:

```text
Behavioral

Low-Level Design

Distributed Systems

Databases

Backend Engineering

Golang

Python

Company-Specific Questions
```

The system should remain flexible enough to support these without requiring a complete rewrite.

---

# 46. Technology Stack

## Frontend

Preferred:

```text
Next.js

TypeScript

Tailwind CSS

shadcn/ui
```

## Backend

Preferred:

```text
Go
```

## Crawler

Preferred:

```text
Python

requests

BeautifulSoup
```

## Database

Preferred starting point:

```text
Cloudflare D1
```

Cloudflare D1 should be validated against the final backend architecture.

## Hosting / Infrastructure

Prefer:

```text
Cloudflare ecosystem
```

where appropriate and free.

## Scheduling

Preferred starting point:

```text
GitHub Actions
```

for scheduled crawler execution.

---

# 47. Important Architecture Constraint

The proposed stack should not be followed blindly.

Claude Code should validate:

- Compatibility between Go backend and Cloudflare infrastructure.
- D1 access patterns.
- GitHub Actions authentication requirements.
- Current free-tier limits.
- Email provider capabilities.

If a significant incompatibility exists, Claude Code should explain the trade-off and ask Sarthak before changing the architecture.

---

# 48. Cost Requirement

The application should aim to cost:

> **₹0 / $0 per month whenever reasonably possible.**

Optimize for:

- Free tiers.
- Low request volume.
- Scheduled batch processing.
- Minimal infrastructure.
- No always-on servers if unnecessary.

Do not introduce paid infrastructure without explicit approval.

---

# 49. Monorepo Requirement

The entire project must live inside one monorepo.

Suggested repository name:

```text
personal-job-search-os
```

Alternative:

```text
job-search-os
```

Confirm the final repository name with Sarthak before creating the GitHub repository.

---

# 50. Repository Structure

Recommended starting structure:

```text
personal-job-search-os/

├── CLAUDE.md
├── README.md
├── .gitignore
│
├── frontend/
│   ├── app/
│   ├── components/
│   ├── features/
│   ├── lib/
│   ├── hooks/
│   ├── types/
│   └── public/
│
├── backend/
│   ├── cmd/
│   │   └── api/
│   ├── internal/
│   │   ├── domain/
│   │   ├── service/
│   │   ├── repository/
│   │   ├── handler/
│   │   └── config/
│   └── migrations/
│
├── crawler/
│   ├── adapters/
│   │   ├── greenhouse/
│   │   ├── lever/
│   │   ├── workday/
│   │   └── custom/
│   ├── normalization/
│   ├── matching/
│   ├── storage/
│   ├── models/
│   ├── tests/
│   └── main.py
│
├── infrastructure/
│   ├── cloudflare/
│   └── scripts/
│
├── docs/
│   ├── architecture.md
│   ├── development.md
│   ├── infrastructure.md
│   ├── database.md
│   ├── api.md
│   ├── crawlers.md
│   ├── engineering-principles.md
│   ├── progress.md
│   └── decisions/
│
├── .github/
│   └── workflows/
│       ├── crawler.yml
│       ├── frontend.yml
│       └── backend.yml
│
└── scripts/
```

Claude Code may improve this structure when justified.

Any significant deviation must be documented.

---

# 51. Monorepo Boundaries

## frontend/

Contains frontend concerns only.

## backend/

Contains API and backend business logic.

## crawler/

Contains job discovery logic.

## infrastructure/

Contains deployment and infrastructure configuration.

## docs/

Contains project documentation.

## packages/

Do not create shared packages prematurely.

Shared packages should only be introduced when there is a genuine need.

---

# 52. Backend Architecture

The backend should initially be a:

> **Modular monolith.**

Do not introduce microservices.

Recommended conceptual flow:

```text
HTTP Request
      ↓
Handler
      ↓
Service
      ↓
Repository
      ↓
Database
```

## Separation

Keep separate:

```text
HTTP Layer

Business Logic

Data Access

Domain Models

External Integrations
```

Avoid:

- Database queries inside handlers.
- Large God services.
- Business logic inside routing definitions.

---

# 53. Frontend Architecture

Organize the frontend primarily by feature where appropriate.

Example:

```text
features/

dashboard/

jobs/

companies/

applications/

templates/

notifications/
```

Each feature may own:

```text
Components

Hooks

API Functions

Types

Feature Logic
```

---

# 54. Frontend Principles

Follow:

```text
Server Components by Default

Client Components When Necessary

Reusable UI Components

Minimal Global State

Feature-Based Organization
```

Avoid adding state management libraries unless genuinely required.

---

# 55. Crawler Architecture

The crawler system must be modular.

Do not implement:

```python
if company == "Microsoft":
    ...
elif company == "Databricks":
    ...
```

inside a giant crawler.

Prefer:

```text
Crawler Orchestrator
        ↓
Adapter Resolver
        ↓
Platform Adapter
        ↓
Normalized Job
```

---

# 56. Database Design

The exact schema should evolve during implementation.

Likely core tables:

```text
companies

contacts

jobs

applications

templates

notifications

settings
```

Potential future tables:

```text
questions

question_tags

question_companies

preparation_progress
```

Use migrations.

Do not manually mutate production schema without migration tracking.

---

# 57. Database Documentation

Maintain:

```text
docs/database.md
```

Document:

- Tables.
- Relationships.
- Indexes.
- Important constraints.
- Migration strategy.

---

# 58. API Design

The API should be simple and domain-oriented.

Potential domains:

```text
Companies

Contacts

Jobs

Applications

Templates

Notifications

Settings
```

Avoid unnecessary API layers.

Maintain:

```text
docs/api.md
```

Document:

- Endpoint.
- Method.
- Request.
- Response.
- Errors.
- Authentication.

---

# 59. Engineering Principles

Claude Code must document engineering principles in:

```text
docs/engineering-principles.md
```

The implementation should follow:

## KISS

Keep solutions simple.

## YAGNI

Do not build speculative functionality.

## DRY

Avoid unnecessary duplication.

However:

> Avoid premature abstractions.

Some duplication is preferable to an incorrect abstraction.

## Separation of Concerns

Separate:

- UI
- Business logic
- Data access
- External integrations

## Modular Design

Organize important logic around domains.

## Production Quality Without Production Complexity

This is the central engineering philosophy.

The product should have:

- Good structure.
- Tests where valuable.
- Clear boundaries.
- Error handling.
- Documentation.

It should not have:

- Microservices.
- Kubernetes.
- Event streaming infrastructure.
- Complex distributed systems.

---

# 60. Scalability Philosophy

Design for reasonable growth in:

```text
Companies

Jobs

Crawlers

Preparation Questions
```

Do not optimize for:

```text
Millions of Users

Multi-tenancy

Global SaaS Scale
```

---

# 61. Testing Strategy

Testing should prioritize valuable business logic.

Highest priority:

```text
Crawler Normalization

Deduplication

Relevance Matching

New Job Detection

Notification Idempotency

Critical Backend Business Logic
```

Do not pursue 100% test coverage.

---

# 62. Logging

Use useful structured logging where practical.

Important events:

```text
Crawler Started

Company Crawl Started

Company Crawl Completed

Crawler Failed

Jobs Found

New Jobs Found

Notification Sent

Notification Failed
```

Logs should support debugging.

---

# 63. Error Handling

Major failures should not cascade unnecessarily.

Example:

```text
Company A Crawl Fails
        ↓
Log Error
        ↓
Continue Remaining Companies
```

External failures should be handled explicitly.

Examples:

```text
Job Portal Unavailable

Database Failure

Email Failure

Rate Limit
```

---

# 64. Idempotency Requirements

The following operations must be idempotent where relevant:

```text
Crawler Runs

Job Inserts

New Job Detection

Notification Sending
```

Repeated scheduled execution must not:

- Create duplicate jobs.
- Send duplicate new-job emails.

---

# 65. Project Documentation

Claude Code must create and maintain the following files.

## CLAUDE.md

Primary context document for Claude Code.

## docs/architecture.md

System architecture.

## docs/development.md

Local development instructions.

## docs/infrastructure.md

Cloudflare, deployment, secrets, and infrastructure.

## docs/database.md

Database design.

## docs/api.md

API documentation.

## docs/crawlers.md

Crawler architecture and adding sources.

## docs/engineering-principles.md

Engineering principles.

## docs/progress.md

Current implementation progress.

## docs/decisions/

Architecture Decision Records.

---

# 66. CLAUDE.md Requirements

`CLAUDE.md` must contain concise but useful persistent context.

At minimum:

## Project Overview

- What the application is.
- Who it is for.
- Primary goal.

## Current Phase

Example:

```text
Current Phase: Phase 0
```

## Architecture

- Frontend.
- Backend.
- Crawler.
- Database.
- Hosting.
- Scheduling.

## Repository Structure

High-level directory responsibilities.

## Development Commands

How to:

- Run frontend.
- Run backend.
- Run crawlers.
- Run tests.
- Run migrations.
- Deploy.

## Important Constraints

```text
Single user

Private application

Free infrastructure preferred

No unnecessary paid services

Production-quality modular code
```

## Current Status

Example:

```text
Completed:
- Company management

In Progress:
- Greenhouse crawler

Next:
- Job board
```

Claude Code must update this when meaningful progress occurs.

---

# 67. Architecture Documentation

Maintain:

```text
docs/architecture.md
```

Document:

## High-Level Architecture

Example:

```text
Frontend
     ↓
Backend APIs
     ↓
Cloudflare D1


GitHub Actions
     ↓
Python Crawlers
     ↓
Database
     ↓
Notification System
```

## Component Responsibilities

Document responsibilities of:

- Frontend.
- Backend.
- Crawlers.
- Database.
- Scheduled jobs.

## Data Flows

Document important flows.

Example:

```text
Job Discovery

GitHub Actions
       ↓
Crawler
       ↓
Adapter
       ↓
Normalization
       ↓
Deduplication
       ↓
Relevance Matching
       ↓
Database
       ↓
Notification
```

---

# 68. Architecture Decision Records

Maintain:

```text
docs/decisions/
```

Examples:

```text
001-monorepo.md

002-cloudflare-d1.md

003-python-crawlers.md

004-github-actions-scheduling.md
```

Each record should contain:

```text
Title

Status

Context

Decision

Alternatives Considered

Consequences
```

Do not create ADRs for trivial implementation details.

---

# 69. Documentation Maintenance Rule

Whenever a significant architecture or implementation decision changes:

> Update relevant documentation in the same change.

Documentation must not become stale.

---

# 70. Development Documentation

Maintain:

```text
docs/development.md
```

Document:

```text
Local Setup

Prerequisites

Environment Variables

Frontend Setup

Backend Setup

Crawler Setup

Tests

Database Migrations

Deployment
```

The goal:

> A developer should be able to clone the repository and run the application.

---

# 71. Infrastructure Documentation

Maintain:

```text
docs/infrastructure.md
```

Document:

- Cloudflare resources.
- D1 configuration.
- R2 if actually used.
- Workers if actually used.
- Hosting.
- GitHub Actions.
- Secrets.
- Environment variables.
- Deployment flow.

---

# 72. Crawler Documentation

Maintain:

```text
docs/crawlers.md
```

Document:

```text
Crawler Architecture

Supported Platforms

Supported Companies

Adapters

Adding a Company

Adding an Adapter

Scheduling

Deduplication

Relevance Matching

Failure Handling
```

---

# 73. Progress Documentation

Maintain:

```text
docs/progress.md
```

Example:

```text
PHASE 0

✓ Repository initialized

✓ Company management

✓ Database schema

In Progress:
- Job crawler

Not Started:
- Notifications
- Application board
```

Update after meaningful milestones.

---

# 74. Infrastructure Ownership

Claude Code should attempt to execute infrastructure setup directly where:

- Required tools are available.
- Sarthak provides authorization.
- The operation is appropriate and safe.

The desired workflow is:

```text
Determine Requirement
        ↓
Ask Sarthak for Required Access
        ↓
Receive Authorization
        ↓
Provision Infrastructure
        ↓
Configure Application
        ↓
Verify
        ↓
Document
```

---

# 75. Cloudflare Resources

Potential resources:

```text
Cloudflare Hosting

Cloudflare D1

Cloudflare Workers if required

Cloudflare R2 if required
```

Do not provision resources unnecessarily.

---

# 76. Cloudflare D1 Provisioning

If D1 remains the chosen database and credentials are available, Claude Code should:

1. Create the database.
2. Configure migrations.
3. Apply migrations.
4. Configure environment variables.
5. Verify connectivity.
6. Document the setup.

---

# 77. Cloudflare R2

Only create R2 if object storage is genuinely needed.

Possible future use cases:

```text
Resume Storage

Uploaded Documents

Notion Export Files
```

Phase 0 does not automatically require R2.

---

# 78. Credential Workflow

Claude Code must ask Sarthak directly when credentials are required.

Example:

> I am ready to provision Cloudflare D1. Please authenticate the Cloudflare CLI or provide the required access through a secure method.

Each credential request should explain:

- Why access is needed.
- What Claude Code intends to do.
- What infrastructure will be affected.

---

# 79. Credential Security

Never:

```text
Commit Secrets

Hardcode Tokens

Store Credentials in Source Code

Commit Real .env Files
```

Use:

```text
Environment Variables

Cloudflare Secrets

GitHub Secrets
```

as appropriate.

Create:

```text
.env.example
```

with placeholders only.

---

# 80. GitHub Repository Management

Claude Code should:

1. Initialize Git.
2. Create repository structure.
3. Create documentation.
4. Create `.gitignore`.
5. Create `README.md`.
6. Create `CLAUDE.md`.

If GitHub integration is available and authorized:

1. Ask Sarthak for necessary authorization.
2. Create the GitHub repository.
3. Connect the local repository.
4. Push the project.

Do not assume GitHub authentication already exists.

---

# 81. Git Workflow

Keep Git simple.

Default:

```text
main
```

Optional:

```text
feature/*
```

for larger changes.

Do not introduce complex GitFlow workflows.

---

# 82. Commit Standards

Commits should be:

```text
Focused

Meaningful

Reviewable
```

Examples:

```text
feat(companies): add company management

feat(crawler): add greenhouse adapter

feat(jobs): add job filtering

docs: update architecture
```

---

# 83. Claude Code Working Procedure

Before writing code, Claude Code should:

1. Read `CLAUDE.md`.
2. Read relevant documentation.
3. Check `docs/progress.md`.
4. Understand the current phase.
5. Inspect the existing implementation.

Do not repeatedly ask for context already documented.

---

# 84. Feature Implementation Procedure

For significant features:

```text
1. Understand Requirement

2. Review Current Architecture

3. Identify Impacted Components

4. Design the Simplest Correct Solution

5. Implement

6. Test

7. Review

8. Update Documentation

9. Update CLAUDE.md

10. Update Progress
```

---

# 85. Definition of Done

A significant feature is complete when:

```text
Functionality Works

Important Tests Pass

Error Handling Exists

Code Is Modular

Relevant Documentation Is Updated

CLAUDE.md Is Updated

Progress Is Updated
```

Compilation alone is not completion.

---

# 86. Claude Code Autonomy

Claude Code should be proactive.

It should not ask questions when:

- The answer exists in this PRD.
- The answer exists in `CLAUDE.md`.
- The answer exists in project documentation.
- The decision is low-risk.

Claude Code should ask when:

```text
Product Direction Is Ambiguous

Credentials Are Required

Paid Infrastructure May Be Required

Major Architecture Change Is Needed

Destructive Operation Is Planned

A User Preference Is Required
```

---

# 87. Avoid Unnecessary Infrastructure

Do not introduce:

```text
Kubernetes

Microservices

Kafka

Redis

Message Queues

Complex Event Systems
```

unless there is a genuine requirement.

This is a single-user personal application.

---

# 88. Recommended Initial Architecture

The intended architecture is approximately:

```text
                     ┌─────────────────┐
                     │     Next.js     │
                     │    Frontend     │
                     └────────┬────────┘
                              │
                              ▼
                     ┌─────────────────┐
                     │    Go Backend   │
                     │       API       │
                     └────────┬────────┘
                              │
                              ▼
                     ┌─────────────────┐
                     │ Cloudflare D1   │
                     └─────────────────┘


                     ┌─────────────────┐
                     │ GitHub Actions  │
                     └────────┬────────┘
                              │
                              ▼
                     ┌─────────────────┐
                     │ Python Crawlers │
                     └────────┬────────┘
                              │
                              ▼
                     ┌─────────────────┐
                     │ Job Processing  │
                     └────────┬────────┘
                              │
                              ▼
                     ┌─────────────────┐
                     │ Notifications   │
                     └─────────────────┘
```

Claude Code should validate and refine this architecture based on actual platform constraints.

---

# 89. API and Crawler Integration

Crawler architecture must not tightly couple scraping logic to the frontend.

Preferred responsibility boundaries:

```text
Crawler
    ↓
Normalized Job Data
    ↓
Storage / API Layer
    ↓
Database
```

The exact ingestion mechanism may be:

- Direct authenticated API.
- Database access.
- Another secure ingestion path.

Claude Code should choose the simplest secure option and document it.

---

# 90. Security Requirements

Because the application contains:

- Personal contacts.
- Phone numbers.
- Email addresses.
- Job search information.

The application must:

- Require access control.
- Avoid public data exposure.
- Keep credentials out of source control.
- Validate API input.
- Use secure environment variable handling.

Do not over-engineer security, but do not leave the application publicly exposed.

---

# 91. Performance Requirements

The application should feel fast.

Priorities:

- Fast dashboard.
- Fast job search.
- Fast filtering.
- Fast navigation.

Expected scale is small.

Optimize database queries and indexes where useful.

Do not implement distributed caching infrastructure initially.

---

# 92. UI Requirements

The UI should use:

```text
Tailwind CSS

shadcn/ui
```

Design should be:

```text
Clean

Minimal

Fast

Desktop-first

Responsive
```

This is a productivity application.

Avoid excessive decoration.

---

# 93. UX Principles

Prioritize:

```text
Actionability

Information Density

Clear Hierarchy

Minimal Clicks
```

The user should quickly understand:

> What is new?

> What needs attention?

> What should I do next?

---

# 94. Empty States

Every major page should have useful empty states.

Examples:

## Jobs

```text
No jobs discovered yet.

Add target companies or run a crawler.
```

## Companies

```text
No companies added.

Add your first target company.
```

## Applications

```text
No applications tracked yet.
```

Avoid blank pages.

---

# 95. Phase 0 Priority Order

Implementation should generally follow:

## Step 1 — Repository and Foundation

- Monorepo.
- Documentation.
- CLAUDE.md.
- GitHub setup.
- Frontend foundation.
- Backend foundation.
- Database.
- Authentication decision.

## Step 2 — Company Management

- Companies.
- Career URLs.
- Source types.

## Step 3 — Referral Contacts

- Company contacts.
- Basic management.

## Step 4 — Job Data Model

- Database schema.
- Job APIs.
- Job normalization.

## Step 5 — Crawlers

Start with:

```text
Greenhouse

Lever
```

Then:

```text
Workday
```

Then custom adapters when needed.

## Step 6 — Relevance Matching

- Target role configuration.
- Matching.
- Exclusions.
- Scoring.

## Step 7 — Job Board

- List.
- Search.
- Filters.
- Sorting.
- Job details.

## Step 8 — New Job Detection

- Deduplication.
- New job identification.

## Step 9 — Notifications

- Email.
- Notification history.
- Idempotency.

## Step 10 — Templates

- Template CRUD if required.
- Variables.
- Preview.
- Copy.

## Step 11 — Application Pipeline

- Kanban.
- Five statuses.

## Step 12 — Dashboard

- Attention items.
- New jobs.
- Follow-ups.
- Metrics.

---

# 96. Initial Crawler Development Strategy

Do not attempt to support every target company immediately.

Start with a few representative companies.

Prioritize platforms that expose structured or relatively stable job listings.

Suggested order:

```text
Greenhouse

Lever

Workday

Custom Portals
```

The system should be built so adding a company is easy.

---

# 97. Adding a New Company Workflow

The desired future workflow should be approximately:

```text
Add Company
      ↓
Enter Careers URL
      ↓
Detect / Select Source Type
      ↓
Configure Adapter if Needed
      ↓
Save
      ↓
Crawler Includes Company
```

Avoid requiring code changes for every company when the company uses a supported platform.

---

# 98. Data Ownership

All data belongs to Sarthak.

The application is personal.

Avoid dependencies that unnecessarily lock data into a proprietary platform.

Database exports and migrations should remain manageable.

---

# 99. Non-Goals for Phase 0

Do not build:

```text
Multi-user SaaS

Public Job Board

Social Network

Recruiter CRM

Complex Contact Relationship Management

AI Resume Generation

Automatic Job Applications

Automatic Referral Messaging

WhatsApp Automation

Complex Analytics
```

The product is intended to help Sarthak move faster, not automate uncontrolled actions.

---

# 100. Future Extensibility

The architecture should make it reasonably easy to later add:

```text
DSA Preparation

System Design

Behavioral Preparation

Interview Calendar

Company Research

Resume Versions

Interview Notes
```

Do not implement these now unless required for architecture compatibility.

---

# 101. Success Metrics

Phase 0 is successful if Sarthak can:

1. Add target companies easily.
2. Automatically discover jobs from those companies.
3. Identify relevant roles.
4. Know when a new relevant role appears.
5. Receive a notification.
6. Quickly find referral contacts.
7. Generate a referral message.
8. Track the job through the application pipeline.
9. Know what requires attention from the dashboard.

---

# 102. Final Instruction to Claude Code

You are the primary implementation engineer for this project.

Your responsibilities include:

```text
Understand this PRD

Maintain persistent project context

Maintain CLAUDE.md

Maintain architecture documentation

Create and manage the monorepo

Implement modular production-quality code

Build Phase 0 first

Optimize for free infrastructure

Avoid unnecessary complexity

Provision infrastructure when authorized

Ask Sarthak directly when credentials are required

Test meaningful functionality

Keep documentation synchronized with implementation
```

---

# 103. Primary Product Objective

The ultimate objective is:

> **Help Sarthak discover relevant SDE-2/SWE-2 opportunities early, leverage available referrals quickly, apply efficiently, track the job search in one place, and later prepare systematically for interviews.**

---

# 104. Final Engineering Objective

Build:

> **A production-quality personal application with simple infrastructure, modular architecture, strong engineering practices, low operational cost, and excellent UX for a single user.**

The application should feel like:

> **A focused internal productivity tool — not a SaaS product.**

---

# 105. Final Rule

Always optimize for:

```text
Simplicity

Correctness

Maintainability

Modularity

Low Cost

Fast Job Discovery

Fast Application Workflow
```

When choosing between a complex and simple solution:

> Prefer the simplest solution that reliably solves the current problem.

When choosing whether to build a feature now or later:

> Build Phase 0 requirements first.

The current mission is clear:

> **Get the job discovery system running so Sarthak can start discovering relevant openings, reaching out for referrals, and applying as quickly as possible.**
