"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { savePageBody } from "@/app/prep/actions";
import { cx } from "./ui";

type Status = "idle" | "dirty" | "saving" | "saved" | "error";

const AUTOSAVE_MS = 900;

/**
 * A page you edit by clicking on it.
 *
 * The previous version had an ?edit=1 mode with a textarea and a Save button, which meant a
 * round trip to start typing, another to stop, and a way to lose work by navigating away. The
 * things that make Notion feel direct are not its block model: they are that there is no mode
 * to enter, that writing is saved without being asked, and that you can always see whether it
 * has been. That is what this does.
 *
 * It remains Markdown underneath, deliberately. A block editor would have to own the document
 * format, and these pages came from Notion and should survive going back — being plain text is
 * what makes them portable, diffable and readable in a terminal.
 */
export function PageEditor({
  id,
  path,
  initialBody,
  children,
}: {
  id: string;
  path: string;
  initialBody: string;
  /** The rendered Markdown, from the server. Shown until you click into it. */
  children: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialBody);
  const [status, setStatus] = useState<Status>("idle");
  const router = useRouter();
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef(initialBody);

  const grow = useCallback(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  const save = useCallback(
    async (next: string) => {
      if (next === lastSaved.current) return;
      setStatus("saving");
      try {
        await savePageBody(id, next, path);
        lastSaved.current = next;
        setStatus("saved");
      } catch {
        // Never silently drop an edit: the text is still in the box, and saying so is the
        // difference between "retry" and "retype".
        setStatus("error");
      }
    },
    [id, path],
  );

  // Autosave once typing pauses. The timer is cleared on unmount so a pending save cannot fire
  // against a component that has gone.
  useEffect(() => {
    if (!editing) return;
    if (value === lastSaved.current) return;
    setStatus("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(value), AUTOSAVE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, editing, save]);

  // Leaving the page with unsaved keystrokes is the one way this design could lose work.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (value !== lastSaved.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [value]);

  useEffect(() => {
    if (editing) grow();
  }, [editing, value, grow]);

  const startEditing = (caretFromClick?: boolean) => {
    setEditing(true);
    requestAnimationFrame(() => {
      const el = areaRef.current;
      if (!el) return;
      el.focus();
      if (!caretFromClick) el.setSelectionRange(el.value.length, el.value.length);
      grow();
    });
  };

  const finish = async () => {
    if (timer.current) clearTimeout(timer.current);
    await save(value);
    setEditing(false);
    // The rendered view is `children` — server-rendered Markdown from the request that built
    // this page. Without refetching it, leaving the editor would show the document as it was
    // before the edit until something else happened to navigate. Only on exit, never on
    // autosave: refreshing mid-keystroke would fight the cursor.
    router.refresh();
  };

  const onKeyDown = async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      if (timer.current) clearTimeout(timer.current);
      await save(value);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      await finish();
      return;
    }
    // Tab indents rather than leaving the box. Nested lists are most of what these pages are,
    // and losing focus mid-list is the fastest way to stop using an editor.
    if (e.key === "Tab") {
      e.preventDefault();
      const el = e.currentTarget;
      const { selectionStart: a, selectionEnd: b } = el;
      const next = value.slice(0, a) + "  " + value.slice(b);
      setValue(next);
      requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2));
    }
  };

  return (
    <div className="relative">
      <div className="mb-1.5 flex h-5 items-center justify-end gap-3 text-[11px]">
        <StatusLabel status={status} editing={editing} />
        {editing && (
          <button
            type="button"
            onClick={finish}
            className="rounded border border-line bg-surface-2 px-2 py-0.5 text-ink-dim transition hover:text-ink"
          >
            Done
          </button>
        )}
      </div>

      {editing ? (
        <textarea
          ref={areaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={finish}
          spellCheck
          placeholder="Write here. Markdown works — # heading, - list, ``` code, | tables |."
          className={cx(
            "w-full resize-none rounded-card border border-accent/40 bg-surface px-4 py-3.5",
            "font-mono text-[13px] leading-relaxed text-ink outline-none",
            "focus:border-accent focus:ring-2 focus:ring-accent/15",
          )}
        />
      ) : (
        <div
          role="button"
          tabIndex={0}
          onClick={(e) => {
            // These pages are full of links to each other. Clicking one must follow it, not
            // drop you into a text box with the destination still loading behind it.
            if ((e.target as HTMLElement).closest("a")) return;
            startEditing(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              startEditing();
            }
          }}
          title="Click to edit"
          className={cx(
            "-mx-2 cursor-text rounded-card px-2 py-1 transition",
            "hover:bg-surface-2/60 focus:outline-none focus:ring-2 focus:ring-accent/20",
          )}
        >
          {value.trim() ? (
            children
          ) : (
            <p className="py-6 text-[13px] text-ink-faint">
              This page is empty. Click to start writing.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function StatusLabel({ status, editing }: { status: Status; editing: boolean }) {
  if (status === "error") {
    return <span className="text-warn">Not saved — your text is still here, try again</span>;
  }
  if (status === "saving") return <span className="text-ink-faint">Saving…</span>;
  if (status === "dirty") return <span className="text-ink-faint">Unsaved</span>;
  if (status === "saved") return <span className="text-ink-faint">Saved</span>;
  // Idle and not editing: say nothing. A permanent "Click to edit" is noise once you know.
  return editing ? null : <span className="text-ink-faint">Click to edit</span>;
}
