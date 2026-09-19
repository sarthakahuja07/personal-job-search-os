/**
 * The shape of a published LLD solution.
 *
 * A low-level design answer has a structure that barely varies: what is being asked, what it
 * must do, the things and their seams, how they relate, why each decision was made, what breaks
 * at the edges, and what you would actually say in the room. Written freehand by a different
 * assistant each time, that structure comes out in a different order with different headings,
 * and a set of pages you cannot skim is a set of pages you do not revise from.
 *
 * So the caller sends named sections and the server composes the Markdown. Putting the layout
 * decision in the one place we control makes "why does this page look different" a question
 * about code rather than about a prompt. Business logic belongs on the server; this is business
 * logic about what a study page *is*.
 *
 * Entities, interfaces and design choices arrive **structured**, not as pre-written Markdown.
 * A hand-written table is the one thing that fails silently: a stray `|` in a cell shifts every
 * column after it, the table still renders, and nobody notices. Structured rows cannot.
 *
 * The code is deliberately not part of the body. It lives in `prep_code_files` and renders in
 * the editor-like Code section, where it is browsed file by file with highlighting -- a
 * twelve-file Go module pasted into Markdown is a wall you scroll past, not something you read.
 */

export type DesignChoice = {
  /** Which part of the design this row is about, e.g. "Bay allocation". */
  component: string;
  /** What was decided. */
  choice: string;
  /** The principle or pattern it follows, e.g. "Strategy", "OCP". */
  principle?: string | null;
  /** Why it was decided that way. */
  why?: string | null;
};

export type Entity = {
  /** The type name, e.g. "Spot". */
  name: string;
  /** Its fields with types, e.g. "id string, size Size, occupant *Vehicle". */
  fields?: string | null;
  /** What it is responsible for -- one line, not a description of the fields again. */
  responsibility?: string | null;
};

export type InterfaceSpec = {
  /** The interface name, e.g. "PricingStrategy". */
  name: string;
  /** The method set, e.g. "Price(units int) (float64, error)". */
  signature: string;
  /** What it exists to let vary. An interface with no answer here is probably not needed. */
  purpose?: string | null;
};

export type LldSolution = {
  problem_statement?: string | null;
  requirements?: string | null;
  entities?: Entity[] | null;
  interfaces?: InterfaceSpec[] | null;
  relationships?: string | null;
  design_choices?: DesignChoice[] | null;
  edge_cases?: string | null;
  talking_points?: string | null;
};

/**
 * The section order, fixed.
 *
 * It is the order the design is actually derived in -- you cannot name entities before you have
 * requirements, or justify a pattern before the interfaces exist -- so a page read top to bottom
 * reproduces the reasoning rather than listing its conclusions. Talking points come last because
 * they are what you revise on the morning of the interview, once everything above is understood.
 */
export const LLD_SECTIONS = [
  { key: "problem_statement", heading: "Problem statement" },
  { key: "requirements", heading: "Requirements" },
  { key: "entities", heading: "Entities and interfaces" },
  { key: "relationships", heading: "Relationships and diagrams" },
  { key: "design_choices", heading: "Design choices and principles" },
  { key: "edge_cases", heading: "Cases handled and edge cases" },
  { key: "talking_points", heading: "Talking points" },
] as const;

/**
 * Make one cell safe to put in a Markdown table.
 *
 * A bare `|` ends the cell and silently shifts every column after it -- the failure mode where
 * the table still renders, just wrongly, so nobody notices. A newline ends the row outright, and
 * these rows routinely carry a sentence with a line break in it.
 */
export function escapeTableCell(value: string): string {
  return value
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>")
    .trim();
}

type Column<T> = { header: string; get: (row: T) => string | null | undefined };

/**
 * Render rows as a Markdown table, dropping any optional column no row fills.
 *
 * Without that, a table whose rows never state a principle carries an empty column down its
 * whole length, which reads as missing information rather than as information that does not
 * apply.
 */
function renderTable<T>(rows: readonly T[], columns: Column<T>[], required: number): string | null {
  if (rows.length === 0) return null;

  const used = columns.filter(
    (column, index) => index < required || rows.some((row) => column.get(row)?.trim()),
  );

  const lines = [
    `| ${used.map((c) => c.header).join(" | ")} |`,
    `| ${used.map(() => "---").join(" | ")} |`,
  ];
  for (const row of rows) {
    lines.push(`| ${used.map((c) => escapeTableCell(c.get(row) ?? "")).join(" | ")} |`);
  }
  return lines.join("\n");
}

/** The design-choices table, or null when there are no rows to put in it. */
export function renderDesignChoices(rows: readonly DesignChoice[]): string | null {
  const usable = rows.filter((r) => r.component?.trim() || r.choice?.trim());
  return renderTable<DesignChoice>(
    usable,
    [
      { header: "Component", get: (r) => r.component },
      { header: "Choice", get: (r) => r.choice },
      { header: "Principle / pattern", get: (r) => r.principle },
      { header: "Why", get: (r) => r.why },
    ],
    2,
  );
}

export function renderEntities(rows: readonly Entity[]): string | null {
  const usable = rows.filter((r) => r.name?.trim());
  return renderTable<Entity>(
    usable,
    [
      { header: "Entity", get: (r) => r.name },
      { header: "Fields", get: (r) => r.fields },
      { header: "Responsibility", get: (r) => r.responsibility },
    ],
    1,
  );
}

export function renderInterfaces(rows: readonly InterfaceSpec[]): string | null {
  const usable = rows.filter((r) => r.name?.trim());
  return renderTable<InterfaceSpec>(
    usable,
    [
      { header: "Interface", get: (r) => r.name },
      { header: "Signature", get: (r) => (r.signature ? "`" + r.signature + "`" : "") },
      { header: "Exists to let vary", get: (r) => r.purpose },
    ],
    2,
  );
}

/**
 * Entities and interfaces share one section, under sub-headings.
 *
 * They are one question in the room -- "what are the pieces and where are the seams" -- and
 * splitting them across two top-level sections put the diagram between them, so you could not
 * see a type and the interface it satisfies at the same time.
 */
function renderEntitiesSection(solution: LldSolution): string | null {
  const entities = renderEntities(solution.entities ?? []);
  const interfaces = renderInterfaces(solution.interfaces ?? []);
  if (!entities && !interfaces) return null;

  const parts: string[] = [];
  if (entities) parts.push(`### Entities\n\n${entities}`);
  if (interfaces) parts.push(`### Interfaces\n\n${interfaces}`);
  return parts.join("\n\n");
}

/** True when a solution payload carries nothing worth composing. */
export function isEmptyLldSolution(solution: LldSolution): boolean {
  return composeLldBody(solution) === null;
}

/**
 * Compose the page body from the named sections.
 *
 * Absent sections are skipped rather than rendered as an empty heading: a page that says
 * "## Interfaces" with nothing under it reads as though the answer is missing, when usually the
 * question simply had none worth naming.
 *
 * Returns null when nothing was supplied, so the caller can fall back to a plain `body` instead
 * of writing an empty document over one that already exists.
 */
export function composeLldBody(solution: LldSolution): string | null {
  const blocks: string[] = [];

  for (const section of LLD_SECTIONS) {
    let rendered: string | null = null;

    if (section.key === "entities") {
      rendered = renderEntitiesSection(solution);
    } else if (section.key === "design_choices") {
      rendered = renderDesignChoices(solution.design_choices ?? []);
    } else {
      const value = solution[section.key];
      rendered = typeof value === "string" && value.trim() ? value.trim() : null;
    }

    if (rendered) blocks.push(`## ${section.heading}\n\n${rendered}`);
  }

  return blocks.length ? blocks.join("\n\n") + "\n" : null;
}
