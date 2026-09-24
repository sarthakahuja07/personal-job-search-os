import { Markdown } from "./markdown";
import { SolutionCode } from "./solution-code";
import { Badge, Card, cx, type Tone } from "./ui";
import type { CodeFile } from "./code-workspace";
import type { PrepContent } from "@/db/schema";

/**
 * A fully worked DSA answer: problem, then either brute-force + optimized or N genuinely
 * different approaches, each with its own code and complexity.
 *
 * Pulled out of the catch-all prep route because this template has real structure of its own --
 * chapters, per-solution cards, a complexity comparison -- that doesn't belong mixed into a page
 * component that also renders folders, books and the generic document body.
 */

/** A top-level chapter: Problem Summary, Example, Complexity at a Glance, Comparison Notes,
 *  Interview Notes. A rule underneath is what makes these read as the page's actual structure
 *  instead of one more heading buried in the prose beneath them. */
function DsaHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 mt-10 border-b border-line pb-2 text-[20px] font-bold text-ink first:mt-0">
      {children}
    </h2>
  );
}

/** "Intuition" / "Working Steps" -- an eyebrow label, deliberately styled nothing like a
 *  heading, so it can't be mistaken for a bolded sentence inside the prose it introduces. */
function DsaEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-1.5 mt-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint first:mt-0">
      {children}
    </h3>
  );
}

/** The first balanced `O(...)` at or after `from`, with correct paren nesting
 *  (`O(K × min(P, Q))`) -- a plain "match up to the next )" regex breaks on exactly this shape,
 *  which shows up constantly once a bound is expressed in terms of more than one variable. */
function firstBigO(text: string, from: number): string | null {
  const start = text.indexOf("O(", from);
  if (start === -1) return null;
  let depth = 0;
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * The headline Big-O of a complexity explanation. Authors consistently bold the actual answer
 * (`**Time: O(n x target)**`) while an incidental per-step cost mentioned along the way stays
 * plain (`...each does O(1) work apart from its recursive calls.`) -- so the first *bolded*
 * `O(...)` is the real headline, not just the first one that appears in reading order. Falls
 * back to the first occurrence anywhere only when nothing in the text is bolded at all.
 */
function headlineComplexity(text: string | undefined): string | null {
  if (!text) return null;
  for (const bold of text.matchAll(/\*\*([\s\S]+?)\*\*/g)) {
    const hit = firstBigO(bold[1], 0);
    if (hit) return hit;
  }
  return firstBigO(text, 0);
}

/** One complexity fact: a scannable Big-O headline first, the full reasoning underneath --
 *  never just a bare bound, since "why" is what actually gets recalled in an interview. */
function ComplexityFact({ label, text }: { label: string; text: string }) {
  const headline = headlineComplexity(text);
  return (
    <div className="rounded-card border border-line bg-surface-2 px-3.5 py-3">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
        {label}
      </p>
      {headline && <p className="mt-1 font-mono text-[16px] font-bold text-ink">{headline}</p>}
      <div className={cx(headline ? "mt-1.5" : "mt-1", "text-[12.5px] leading-relaxed text-ink-dim [&_p]:my-0")}>
        <Markdown>{text}</Markdown>
      </div>
    </div>
  );
}

type ComparisonRow = { label: string; tone: Tone; time?: string; space?: string };

/** The comparison the user has to build by re-reading every section otherwise: every approach's
 *  Big-O side by side. Generated from the same structured fields the detailed sections already
 *  use, so it appears on every worked answer without needing a hand-written table too. */
function ComparisonTable({ rows }: { rows: ComparisonRow[] }) {
  if (rows.length < 2) return null;
  return (
    <>
      <DsaHeading>Complexity at a Glance</DsaHeading>
      <div className="overflow-x-auto rounded-card border border-line">
        <table className="w-full border-collapse text-left text-[12.5px]">
          <thead className="bg-surface-2">
            <tr>
              <th className="px-3 py-2 font-medium text-ink">Approach</th>
              <th className="px-3 py-2 font-medium text-ink">Time</th>
              <th className="px-3 py-2 font-medium text-ink">Space</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-t border-line">
                <td className="px-3 py-2.5 align-top">
                  <Badge tone={r.tone}>{r.label}</Badge>
                </td>
                <td className="px-3 py-2.5 align-top font-mono text-[13px] font-semibold text-ink">
                  {headlineComplexity(r.time) ?? "—"}
                </td>
                <td className="px-3 py-2.5 align-top font-mono text-[13px] font-semibold text-ink">
                  {headlineComplexity(r.space) ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** One worked solution: intuition, steps, code, then its two complexity facts -- self-contained
 *  in a card so "Brute Force" and "Optimized" read as two distinct, comparable answers rather
 *  than one long scroll of prose with headings sprinkled through it. */
function SolutionBlock({
  tag,
  tone,
  title,
  intuition,
  steps,
  timeComplexity,
  spaceComplexity,
  file,
}: {
  tag?: string;
  tone: Tone;
  title: string;
  intuition: string;
  steps: string;
  timeComplexity?: string;
  spaceComplexity?: string;
  file: CodeFile | undefined;
}) {
  return (
    <Card className="mb-8 px-5 py-5">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {tag && <Badge tone={tone}>{tag}</Badge>}
        <h2 className="text-[17px] font-bold text-ink">{title}</h2>
      </div>

      <DsaEyebrow>Intuition</DsaEyebrow>
      <Markdown>{intuition}</Markdown>

      <DsaEyebrow>Working Steps</DsaEyebrow>
      <Markdown>{steps}</Markdown>

      <div className="mt-3">
        <SolutionCode file={file} />
      </div>

      {(timeComplexity || spaceComplexity) && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {timeComplexity && <ComplexityFact label="Time Complexity" text={timeComplexity} />}
          {spaceComplexity && <ComplexityFact label="Space Complexity" text={spaceComplexity} />}
        </div>
      )}
    </Card>
  );
}

export function DsaSolution({
  content,
  codeFiles,
}: {
  content: PrepContent;
  codeFiles: CodeFile[];
}) {
  const bruteForceFile = codeFiles.find((f) => f.path === "brute_force.cpp");
  const optimizedFile = codeFiles.find((f) => f.path === "optimized.cpp");
  const approaches = content.approaches ?? [];
  const hasApproaches = approaches.length > 0;
  const hasBruteForce = Boolean(content.bruteForceIntuition);

  const comparisonRows: ComparisonRow[] = hasApproaches
    ? approaches.map((a) => ({
        label: a.title,
        tone: "neutral",
        time: a.timeComplexity,
        space: a.spaceComplexity,
      }))
    : [
        ...(hasBruteForce
          ? [
              {
                label: "Brute Force",
                tone: "neutral" as const,
                time: content.bruteForceTimeComplexity,
                space: content.bruteForceSpaceComplexity,
              },
            ]
          : []),
        {
          label: "Optimized",
          tone: "fresh",
          time: content.optimizedTimeComplexity,
          space: content.optimizedSpaceComplexity,
        },
      ];

  return (
    <div className="mb-6">
      <DsaHeading>Problem Summary</DsaHeading>
      <Markdown>{content.problemSummary ?? ""}</Markdown>

      {content.examples && (
        <>
          <DsaHeading>Example</DsaHeading>
          <Markdown>{content.examples}</Markdown>
        </>
      )}

      <ComparisonTable rows={comparisonRows} />

      {hasApproaches ? (
        approaches.map((approach, i) => (
          <SolutionBlock
            key={i}
            tag={`Approach ${i + 1}`}
            tone="neutral"
            title={approach.title.replace(/^approach\s*\d+\s*:\s*/i, "") || approach.title}
            intuition={approach.intuition}
            steps={approach.steps}
            timeComplexity={approach.timeComplexity}
            spaceComplexity={approach.spaceComplexity}
            file={codeFiles.find((f) => f.path === approach.codeFile)}
          />
        ))
      ) : (
        <>
          {hasBruteForce && (
            <SolutionBlock
              tag="Brute Force"
              tone="neutral"
              title="Brute Force"
              intuition={content.bruteForceIntuition ?? ""}
              steps={content.bruteForceSteps ?? ""}
              timeComplexity={content.bruteForceTimeComplexity}
              spaceComplexity={content.bruteForceSpaceComplexity}
              file={bruteForceFile}
            />
          )}
          <SolutionBlock
            tag="Optimized"
            tone="fresh"
            title="Optimized Solution"
            intuition={content.optimizedIntuition ?? ""}
            steps={content.optimizedSteps ?? ""}
            timeComplexity={content.optimizedTimeComplexity}
            spaceComplexity={content.optimizedSpaceComplexity}
            file={optimizedFile}
          />
        </>
      )}

      {content.comparisonTable && (
        <>
          <DsaHeading>Comparison Notes</DsaHeading>
          <Markdown>{content.comparisonTable}</Markdown>
        </>
      )}

      {content.interviewNotes && (
        <>
          <DsaHeading>What to Say in the Interview</DsaHeading>
          <Markdown>{content.interviewNotes}</Markdown>
        </>
      )}
    </div>
  );
}
