"use client";

import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { useCallback, useEffect, useRef, useState } from "react";

import { savePageBody } from "@/app/prep/actions";
import { cx } from "./ui";

type Status = "idle" | "dirty" | "saving" | "saved" | "error";

/**
 * tiptap-markdown adds `storage.markdown` at runtime but does not declare it, so the cast is
 * unavoidable. Doing it once, here, keeps it from being scattered through the component.
 */
type MarkdownStorage = { markdown: { getMarkdown: () => string } };
const toMarkdown = (e: Editor): string =>
  (e.storage as unknown as MarkdownStorage).markdown.getMarkdown();

const AUTOSAVE_MS = 900;

/**
 * The page editor: what you see is the page.
 *
 * Editing used to mean looking at raw Markdown -- reading `## 2. High-Level Design` instead of
 * a heading. That is fine for a file and wrong for a document you think in, which was the
 * complaint. So the surface is now formatted text: headings look like headings, lists indent,
 * code sits in a block, and a toolbar appears with the caret.
 *
 * Markdown remains the storage format. It is what came out of Notion and what would go back,
 * it diffs, and it reads fine in a terminal -- so the editor serialises to it on every save
 * rather than owning a private block format. The conversion is lossy only for things Markdown
 * genuinely cannot express, and nothing in these pages needs those.
 */
export function RichEditor({
  id,
  path,
  initialBody,
}: {
  id: string;
  path: string;
  initialBody: string;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [focused, setFocused] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef(initialBody);

  const save = useCallback(
    async (next: string) => {
      if (next === lastSaved.current) return;
      setStatus("saving");
      try {
        await savePageBody(id, next, path);
        lastSaved.current = next;
        setStatus("saved");
      } catch {
        // The text is still on screen. Saying so is the difference between retry and retype.
        setStatus("error");
      }
    },
    [id, path],
  );

  const editor = useEditor({
    // Rendered on the client only. The editor reaches for the DOM during setup, and letting it
    // run on the server produces a hydration mismatch on every page.
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
      Link.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder: "Write here, or press / for a heading…" }),
      Markdown.configure({ html: false, transformPastedText: true, breaks: true }),
    ],
    content: initialBody,
    editorProps: {
      attributes: {
        class: cx(
          "prose-page min-h-[8rem] outline-none",
          "text-[14.5px] leading-relaxed text-ink-dim",
        ),
      },
    },
    onUpdate: ({ editor: e }) => {
      const md = toMarkdown(e);
      if (md === lastSaved.current) return;
      setStatus("dirty");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void save(md), AUTOSAVE_MS);
    },
    onFocus: () => setFocused(true),
    onBlur: ({ editor: e }) => {
      setFocused(false);
      if (timer.current) clearTimeout(timer.current);
      void save(toMarkdown(e));
    },
  });

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // Closing the tab mid-sentence is the one way this design could still lose work.
  useEffect(() => {
    const warn = (ev: BeforeUnloadEvent) => {
      if (!editor) return;
      if (toMarkdown(editor) !== lastSaved.current) {
        ev.preventDefault();
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [editor]);

  const forceSave = useCallback(
    (e: KeyboardEvent) => {
      if (!editor) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (timer.current) clearTimeout(timer.current);
        void save(toMarkdown(editor));
      }
    },
    [editor, save],
  );

  useEffect(() => {
    window.addEventListener("keydown", forceSave);
    return () => window.removeEventListener("keydown", forceSave);
  }, [forceSave]);

  if (!editor) {
    // Matches the editor's own metrics so the page does not jump when it mounts.
    return <div className="min-h-[8rem] animate-pulse rounded-card bg-surface-2" />;
  }

  return (
    <div className="relative">
      <Toolbar editor={editor} visible={focused} status={status} />
      <EditorContent editor={editor} />
    </div>
  );
}

function Toolbar({
  editor,
  visible,
  status,
}: {
  editor: Editor;
  visible: boolean;
  status: Status;
}) {
  const btn = (active: boolean) =>
    cx(
      "rounded px-2 py-1 text-[12px] transition",
      active ? "bg-accent-soft text-accent-ink" : "text-ink-dim hover:bg-surface-3 hover:text-ink",
    );

  return (
    <div
      className={cx(
        "sticky top-0 z-10 -mx-1 mb-2 flex flex-wrap items-center gap-0.5 rounded-card border bg-surface px-1.5 py-1 transition",
        // Present but quiet until you are actually writing: a toolbar bolted permanently above
        // a page you are only reading is clutter.
        visible ? "border-line opacity-100" : "border-transparent opacity-60",
      )}
    >
      <select
        value={
          editor.isActive("heading", { level: 1 })
            ? "1"
            : editor.isActive("heading", { level: 2 })
              ? "2"
              : editor.isActive("heading", { level: 3 })
                ? "3"
                : editor.isActive("heading", { level: 4 })
                  ? "4"
                  : "p"
        }
        onChange={(e) => {
          const v = e.target.value;
          if (v === "p") editor.chain().focus().setParagraph().run();
          else
            editor
              .chain()
              .focus()
              .toggleHeading({ level: Number(v) as 1 | 2 | 3 | 4 })
              .run();
        }}
        className="mr-1 rounded border border-line bg-surface-2 px-1.5 py-1 text-[12px] text-ink outline-none"
        aria-label="Text style"
      >
        <option value="p">Text</option>
        <option value="1">Heading 1</option>
        <option value="2">Heading 2</option>
        <option value="3">Heading 3</option>
        <option value="4">Heading 4</option>
      </select>

      <button type="button" onClick={() => editor.chain().focus().toggleBold().run()}
        className={btn(editor.isActive("bold"))} title="Bold (Ctrl+B)"><strong>B</strong></button>
      <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()}
        className={btn(editor.isActive("italic"))} title="Italic (Ctrl+I)"><em>I</em></button>
      <button type="button" onClick={() => editor.chain().focus().toggleStrike().run()}
        className={btn(editor.isActive("strike"))} title="Strikethrough"><s>S</s></button>
      <button type="button" onClick={() => editor.chain().focus().toggleCode().run()}
        className={btn(editor.isActive("code"))} title="Inline code">{"</>"}</button>

      <span className="mx-1 h-4 w-px bg-line" aria-hidden />

      <button type="button" onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={btn(editor.isActive("bulletList"))} title="Bullet list">• List</button>
      <button type="button" onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={btn(editor.isActive("orderedList"))} title="Numbered list">1. List</button>
      <button type="button" onClick={() => editor.chain().focus().toggleBlockquote().run()}
        className={btn(editor.isActive("blockquote"))} title="Quote">&ldquo;</button>
      <button type="button" onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        className={btn(editor.isActive("codeBlock"))} title="Code block">Code</button>
      <button type="button" onClick={() => editor.chain().focus().setHorizontalRule().run()}
        className={btn(false)} title="Divider">—</button>

      <span className="mx-1 h-4 w-px bg-line" aria-hidden />

      <button
        type="button"
        title="Link"
        onClick={() => {
          const prev = (editor.getAttributes("link").href as string) ?? "";
          const url = window.prompt("Link URL", prev);
          if (url === null) return;
          if (url === "") editor.chain().focus().unsetLink().run();
          else editor.chain().focus().setLink({ href: url }).run();
        }}
        className={btn(editor.isActive("link"))}
      >
        Link
      </button>

      <span className="ml-auto pr-1 text-[11px] text-ink-faint">
        {status === "error"
          ? "Not saved — your text is still here"
          : status === "saving"
            ? "Saving…"
            : status === "dirty"
              ? "Unsaved"
              : status === "saved"
                ? "Saved"
                : ""}
      </span>
    </div>
  );
}
