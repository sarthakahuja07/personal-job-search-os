import { describe, expect, it } from "vitest";

import {
  composeLldBody,
  escapeTableCell,
  isEmptyLldSolution,
  LLD_SECTIONS,
  renderDesignChoices,
  renderEntities,
  renderInterfaces,
} from "./lld";

describe("composeLldBody", () => {
  it("emits the sections in the fixed order, whatever order they arrive in", () => {
    const body = composeLldBody({
      talking_points: "Lead with the seam.",
      edge_cases: "Double submit.",
      problem_statement: "Design a parking lot.",
      requirements: "Multiple floors.",
    });

    expect((body ?? "").match(/^## .+$/gm)).toEqual([
      "## Problem statement",
      "## Requirements",
      "## Cases handled and edge cases",
      "## Talking points",
    ]);
  });

  it("covers every declared section", () => {
    const full = composeLldBody({
      problem_statement: "a",
      requirements: "b",
      entities: [{ name: "Spot", fields: "id string" }],
      interfaces: [{ name: "Pricing", signature: "Price(int) float64" }],
      relationships: "d",
      design_choices: [{ component: "f", choice: "g" }],
      edge_cases: "h",
      talking_points: "i",
    }) ?? "";

    for (const section of LLD_SECTIONS) {
      expect(full).toContain(`## ${section.heading}`);
    }
  });

  it("puts entities and interfaces under one heading, as sub-sections", () => {
    const body = composeLldBody({
      entities: [{ name: "Spot", fields: "id string", responsibility: "One bay" }],
      interfaces: [{ name: "Pricing", signature: "Price(int) (float64, error)", purpose: "Rates" }],
    }) ?? "";

    expect(body).toContain("## Entities and interfaces");
    expect(body).toContain("### Entities");
    expect(body).toContain("### Interfaces");
    // One top-level heading, not two.
    expect(body.match(/^## /gm)).toHaveLength(1);
  });

  it("renders either half alone", () => {
    const onlyEntities = composeLldBody({ entities: [{ name: "Spot" }] }) ?? "";
    expect(onlyEntities).toContain("### Entities");
    expect(onlyEntities).not.toContain("### Interfaces");

    const onlyInterfaces = composeLldBody({
      interfaces: [{ name: "Pricing", signature: "Price(int) float64" }],
    }) ?? "";
    expect(onlyInterfaces).toContain("### Interfaces");
    expect(onlyInterfaces).not.toContain("### Entities");
  });

  it("skips sections that were not supplied rather than leaving empty headings", () => {
    const body = composeLldBody({ problem_statement: "Design a lift." }) ?? "";
    expect(body).toContain("## Problem statement");
    expect(body).not.toContain("## Entities and interfaces");
  });

  it("treats whitespace-only sections as absent", () => {
    expect(composeLldBody({ problem_statement: "   \n  " })).toBeNull();
  });

  it("returns null for an empty payload, so it cannot blank an existing page", () => {
    expect(composeLldBody({})).toBeNull();
    expect(composeLldBody({ design_choices: [], entities: [], interfaces: [] })).toBeNull();
    expect(isEmptyLldSolution({})).toBe(true);
  });

  it("keeps a mermaid fence intact, so the diagram still renders", () => {
    const chart = "```mermaid\nclassDiagram\n  Lot --> Floor\n```";
    expect(composeLldBody({ relationships: chart })).toContain(chart);
  });
});

describe("renderEntities", () => {
  it("is a table of the fields each entity carries", () => {
    const table = renderEntities([
      { name: "Spot", fields: "id string, size Size", responsibility: "One bay" },
      { name: "Floor", fields: "number int, spots []*Spot", responsibility: "Allocation" },
    ]) ?? "";

    expect(table).toContain("| Entity | Fields | Responsibility |");
    expect(table).toContain("| Spot | id string, size Size | One bay |");
    expect(table.split("\n")).toHaveLength(4);
  });

  it("drops an optional column no row fills", () => {
    const table = renderEntities([{ name: "Spot", fields: "id string" }]) ?? "";
    expect(table).toContain("| Entity | Fields |");
    expect(table).not.toContain("Responsibility");
  });

  it("ignores a row with no name", () => {
    expect(renderEntities([{ name: "  " }])).toBeNull();
    expect(renderEntities([])).toBeNull();
  });
});

describe("renderInterfaces", () => {
  it("renders the signature as code so it is readable", () => {
    const table = renderInterfaces([
      { name: "Pricing", signature: "Price(units int) (float64, error)", purpose: "Rate schemes" },
    ]) ?? "";

    expect(table).toContain("| Interface | Signature | Exists to let vary |");
    expect(table).toContain("`Price(units int) (float64, error)`");
  });

  it("keeps the signature column even when a purpose is missing", () => {
    const table = renderInterfaces([{ name: "Clock", signature: "Now() time.Time" }]) ?? "";
    expect(table).toContain("| Interface | Signature |");
    expect(table).not.toContain("Exists to let vary");
  });
});

describe("renderDesignChoices", () => {
  it("omits optional columns no row fills", () => {
    const table = renderDesignChoices([{ component: "Bays", choice: "Smallest fit" }]) ?? "";
    expect(table).toContain("| Component | Choice |");
    expect(table).not.toContain("Principle");
  });

  it("includes an optional column when any row fills it", () => {
    const table = renderDesignChoices([
      { component: "Bays", choice: "Smallest fit" },
      { component: "Pricing", choice: "Strategy", principle: "OCP" },
    ]) ?? "";
    expect(table).toContain("| Component | Choice | Principle / pattern |");
    // The row that left it empty still has the cell, or the columns shift.
    expect(table).toContain("| Bays | Smallest fit |  |");
  });

  it("drops rows that say nothing", () => {
    expect(renderDesignChoices([{ component: "  ", choice: "" }])).toBeNull();
  });
});

describe("escapeTableCell", () => {
  it("escapes a pipe, which would otherwise shift every later column", () => {
    expect(escapeTableCell("a | b")).toBe("a \\| b");
  });

  it("turns a newline into a break, which would otherwise end the row", () => {
    expect(escapeTableCell("one\ntwo")).toBe("one<br>two");
    expect(escapeTableCell("one\r\ntwo")).toBe("one<br>two");
  });

  it("protects a signature containing a pipe", () => {
    const table = renderInterfaces([{ name: "F", signature: "Do(a int|string)" }]) ?? "";
    expect(table).not.toMatch(/\| `Do\(a int\|string\)` \|/);
    expect(table).toContain("int\\|string");
  });
});
