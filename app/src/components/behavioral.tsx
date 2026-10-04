import Link from "next/link";

import type { PrepStatus } from "@/db/schema";
import {
  formatClock,
  type AnswerShape,
  type ProjectSummary,
  type StoryLink,
} from "@/server/domain/behavioral";
import { STATUS_LABEL } from "@/server/domain/prep";
import { Markdown } from "./markdown";
import { Badge, cx } from "./ui";

/**
 * The pieces of a behavioral page, shared by the page itself and by rehearse mode -- so an
 * answer reads the same whether you are studying it or checking yourself against it.
 *
 * No hooks and nothing server-only: these render in a server page and in a client component.
 */

const STATUS_TONE: Record<PrepStatus, "neutral" | "accent" | "fresh" | "warn"> = {
  not_started: "neutral",
  in_progress: "accent",
  done: "fresh",
  revisit: "warn",
};

/** "~1:30 spoken", with a clock glyph. */
export function SpokenTime({ seconds, className }: { seconds: number; className?: string }) {
  return (
    <span
      className={cx("tnum inline-flex items-center gap-1 text-[12px] text-ink-faint", className)}
      title="Estimated speaking time at interview pace"
    >
      <svg aria-hidden viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="8" cy="8" r="6" />
        <path d="M8 4.5V8l2.5 1.5" strokeLinecap="round" />
      </svg>
      ~{formatClock(seconds)} spoken
    </span>
  );
}

/**
 * Situation, Task, Action, Result as a vertical timeline.
 *
 * Laid out as steps rather than four labelled boxes because that is how the answer is said:
 * in order, each leading to the next. The letter is decorative; the label is the heading.
 */
export function StarAnswer({ parts }: { parts: Extract<AnswerShape, { kind: "star" }>["parts"] }) {
  return (
    <ol className="space-y-0">
      {parts.map((p, i) => (
        <li key={p.key} className="relative flex gap-3.5 pb-6 last:pb-0">
          {i < parts.length - 1 && (
            <span aria-hidden className="absolute bottom-0 left-[13.5px] top-9 w-px bg-line-strong" />
          )}
          <span
            aria-hidden
            className="flex size-7 shrink-0 items-center justify-center rounded-full border border-accent/40 bg-accent-soft text-[12px] font-semibold text-accent-ink"
          >
            {p.letter}
          </span>
          <div className="min-w-0 flex-1 pt-1 [&>div>p:first-of-type]:mt-1">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
              {p.label}
            </h3>
            <Markdown size="md" tone="ink">
              {p.text}
            </Markdown>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** An answer in whichever shape it was written, or the "not answered yet" state. */
export function AnswerBody({ shape }: { shape: AnswerShape }) {
  if (shape.kind === "star") return <StarAnswer parts={shape.parts} />;
  if (shape.kind === "prose") {
    return (
      <div className="[&>div>p:first-child]:mt-0 [&>div>p:last-child]:mb-0">
        <Markdown size="md" tone="ink">
          {shape.text}
        </Markdown>
      </div>
    );
  }
  return (
    <div className="rounded-card border border-dashed border-line-strong px-4 py-5 text-center">
      <p className="text-[14px] font-medium text-ink">No answer written yet</p>
      {shape.hint && (
        <p className="mx-auto mt-1.5 max-w-md text-[13px] text-ink-dim">
          <span className="text-ink-faint">What a good answer covers: </span>
          {shape.hint}
        </p>
      )}
      <p className="mx-auto mt-2 max-w-md text-[12px] text-ink-faint">
        Draft it in the notes below, or publish one with <code className="font-mono">publish_behavioral_story</code>.
      </p>
    </div>
  );
}

/** "Draws on · Lineage Storage Redesign · Uber →" */
export function StoryLinkCard({ story }: { story: StoryLink }) {
  return (
    <Link
      href={story.url}
      className="group flex items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 py-3 transition hover:border-line-strong"
    >
      <span className="min-w-0">
        <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
          Draws on the project
        </span>
        <span className="mt-0.5 block truncate text-[14px] text-ink">
          {story.title}
          {story.org && <span className="text-ink-faint"> · {story.org}</span>}
        </span>
      </span>
      <span aria-hidden className="shrink-0 text-ink-faint transition group-hover:translate-x-0.5 group-hover:text-ink">
        →
      </span>
    </Link>
  );
}

/** The 90-second version, set apart as the thing you actually say. */
export function PitchCard({
  pitch,
  seconds,
  action,
}: {
  pitch: string;
  seconds: number;
  action?: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby="pitch-heading"
      className="rounded-card border border-accent/30 bg-accent-soft/40 px-5 py-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id="pitch-heading"
          className="text-[11px] font-semibold uppercase tracking-[0.08em] text-accent-ink"
        >
          90-second pitch
        </h2>
        <div className="flex items-center gap-3">
          <SpokenTime seconds={seconds} />
          {action}
        </div>
      </div>
      <div className="mt-1 [&>div>p:last-child]:mb-0">
        <Markdown size="md" tone="ink">
          {pitch}
        </Markdown>
      </div>
    </section>
  );
}

/** One project on the behavioral landing page. */
export function ProjectCard({ project }: { project: ProjectSummary }) {
  return (
    <li className="h-full">
      <Link
        href={project.url}
        className="group flex h-full flex-col rounded-card border border-line bg-surface px-4 py-4 transition hover:border-line-strong hover:bg-surface-2/40"
      >
        <span className="flex items-center gap-2">
          {project.org && <Badge tone="accent">{project.org}</Badge>}
          {project.status !== "not_started" && (
            <Badge tone={STATUS_TONE[project.status]}>{STATUS_LABEL[project.status]}</Badge>
          )}
        </span>
        <span className="mt-2.5 block text-[16px] font-semibold leading-snug text-ink">
          {project.title}
        </span>
        {project.summary && (
          <span className="mt-1.5 line-clamp-3 block text-[13.5px] leading-relaxed text-ink-dim">
            {project.summary}
          </span>
        )}
        <span className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-4 text-[12px] text-ink-faint">
          <SpokenTime seconds={project.pitchSeconds} className="!text-[12px]" />
          <span className="tnum">{project.sections} sections</span>
          <span className="tnum">{project.readMinutes} min read</span>
          {project.answers.length > 0 && (
            <span className="tnum">
              {project.answers.length} answer{project.answers.length === 1 ? "" : "s"}
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}

export function ProjectGrid({ projects }: { projects: ProjectSummary[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {projects.map((p) => (
        <ProjectCard key={p.id} project={p} />
      ))}
    </ul>
  );
}
