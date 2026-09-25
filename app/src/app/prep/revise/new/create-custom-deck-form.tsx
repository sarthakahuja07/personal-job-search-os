"use client";

import { useMemo, useState } from "react";

import { Badge, Button, Card, inputStyles } from "@/components/ui";
import { PREP_DIFFICULTIES } from "@/db/schema";
import { DISCIPLINES, DISCIPLINE_TITLE } from "@/server/domain/company";
import { DIFFICULTY_TONE } from "@/server/domain/prep";
import type { CustomDeckCandidate } from "@/server/domain/revision";

import { createCustomDeckAction } from "../actions";

export function CreateCustomDeckForm({
  candidates,
  companies,
}: {
  candidates: CustomDeckCandidate[];
  companies: { slug: string; name: string }[];
}) {
  const [company, setCompany] = useState("");
  const [discipline, setDiscipline] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filtered = useMemo(
    () =>
      candidates.filter(
        (c) =>
          (!company || c.companySlugs.includes(company)) &&
          (!discipline || c.discipline === discipline) &&
          (!difficulty || c.difficulty === difficulty),
      ),
    [candidates, company, discipline, difficulty],
  );

  // Checkboxes are scoped to the current filter view: changing a filter clears the pick, so a
  // question you can no longer see is never silently left selected.
  const setFilter = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setSelected(new Set());
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <form action={createCustomDeckAction} className="max-w-2xl space-y-5">
      <div>
        <label className="mb-1.5 block text-[13px] font-medium text-ink">Deck name</label>
        <input name="title" required placeholder="e.g. Confluent hard DSA" className={inputStyles} />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-ink">Company</label>
          <select
            name="companySlug"
            value={company}
            onChange={(e) => setFilter(setCompany)(e.target.value)}
            className={inputStyles}
          >
            <option value="">Any</option>
            {companies.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-ink">Discipline</label>
          <select
            name="discipline"
            value={discipline}
            onChange={(e) => setFilter(setDiscipline)(e.target.value)}
            className={inputStyles}
          >
            <option value="">Any</option>
            {DISCIPLINES.map((d) => (
              <option key={d} value={d}>
                {DISCIPLINE_TITLE[d]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-ink">Difficulty</label>
          <select
            name="difficulty"
            value={difficulty}
            onChange={(e) => setFilter(setDifficulty)(e.target.value)}
            className={inputStyles}
          >
            <option value="">Any</option>
            {PREP_DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
      </div>

      <Card className="px-4 py-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-[13px] text-ink-dim">
            {filtered.length} question{filtered.length === 1 ? "" : "s"} match
            {company || discipline || difficulty ? " these filters" : " (every question)"}.
          </p>
          {selected.size > 0 && (
            <Badge tone="accent">{selected.size} picked -- deck will be frozen</Badge>
          )}
        </div>
        <p className="mb-3 text-[12px] text-ink-faint">
          Leave every question unchecked to keep the deck live: it will always match these
          filters, so a new question added later shows up on its own. Check specific questions
          instead to freeze the deck to exactly those -- new matches will not be added.
        </p>
        <div className="max-h-80 space-y-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="py-4 text-center text-[12.5px] text-ink-faint">No questions match.</p>
          ) : (
            filtered.map((c) => (
              <label
                key={c.id}
                className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-ink-dim hover:bg-surface-2"
              >
                <input
                  type="checkbox"
                  name="questionIds"
                  value={c.id}
                  checked={selected.has(c.id)}
                  onChange={() => toggle(c.id)}
                  className="shrink-0"
                />
                <span className="truncate">{c.title}</span>
                <span className="ml-auto flex shrink-0 items-center gap-1">
                  <Badge>{DISCIPLINE_TITLE[c.discipline]}</Badge>
                  {c.difficulty && <Badge tone={DIFFICULTY_TONE[c.difficulty]}>{c.difficulty}</Badge>}
                </span>
              </label>
            ))
          )}
        </div>
      </Card>

      <Button type="submit" variant="primary">
        Create deck
      </Button>
    </form>
  );
}
