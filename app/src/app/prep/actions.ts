"use server";

import { revalidatePath } from "next/cache";

import { getDb } from "@/db";
import { PREP_DIFFICULTIES, type PrepDifficulty } from "@/db/schema";
import { parseResource } from "@/server/domain/resources";
import { languageFor, normalizeCodePath } from "@/server/domain/code";
import {
  addCodeFile,
  addResource,
  movePage,
  removeCodeFile,
  removeResource,
  setPrepGrading,
  updateBody,
} from "@/server/repository/prep-repo";

/**
 * Save a page's body.
 *
 * Called from the editor as you type rather than from a Save button, so it has to be cheap and
 * safe to call often. It writes one column and revalidates the page it wrote — not the whole
 * prep tree, which would make every keystroke pay for a sidebar rebuild.
 */
export async function savePageBody(id: string, body: string, path: string) {
  await updateBody(getDb(), id, body.trim() || null);
  revalidatePath(path);
  return { savedAt: Date.now() };
}

/**
 * Pin a link to a page.
 *
 * Everything except the URL is derived: whether it is a video, who published it, and a
 * readable title if none was typed. Pasting is the whole interaction.
 */
export async function addPageResource(formData: FormData) {
  const prepItemId = String(formData.get("prepItemId") ?? "");
  const raw = String(formData.get("url") ?? "").trim();
  const path = String(formData.get("path") ?? "/prep");
  if (!prepItemId || !raw) return;

  // Accept a bare "youtu.be/..." the way a browser address bar would.
  const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const parsed = parseResource(url, String(formData.get("title") ?? ""));

  await addResource(getDb(), {
    prepItemId,
    kind: parsed.kind,
    url: parsed.url,
    title: parsed.suggestedTitle,
    source: parsed.source,
    videoId: parsed.videoId,
  });

  revalidatePath(path);
}

export async function removePageResource(id: string, path: string) {
  await removeResource(getDb(), id);
  revalidatePath(path);
}

/**
 * Attach a source file to a question's code workspace.
 *
 * The path carries the structure -- "src/model/Vehicle.java" puts the file two folders deep --
 * so there is nothing to choose beyond a path and the code itself. The language is derived from
 * the extension rather than asked for, because a dropdown of forty grammars is a worse way to
 * say ".java" than typing ".java".
 */
export async function addPageCodeFile(formData: FormData) {
  const prepItemId = String(formData.get("prepItemId") ?? "");
  const path = String(formData.get("path") ?? "/prep");
  const filePath = normalizeCodePath(String(formData.get("filePath") ?? ""));
  const content = String(formData.get("content") ?? "");

  // An empty file is almost always a mis-click on an empty form; a file of only whitespace is
  // indistinguishable from one and equally useless to read.
  if (!prepItemId || !filePath || !content.trim()) return;

  await addCodeFile(getDb(), {
    prepItemId,
    path: filePath,
    language: languageFor(filePath),
    content,
  });

  revalidatePath(path);
}

export async function removePageCodeFile(id: string, path: string) {
  await removeCodeFile(getDb(), id);
  revalidatePath(path);
}

/**
 * How hard it is, and how often it is asked.
 *
 * Both are one click from the page and from the overview, because they are judgements you
 * revise constantly -- after a mock, after an interview -- and anything that costs a form
 * submission to change simply stops being kept accurate.
 */
export async function setDifficulty(id: string, difficulty: string | null, path: string) {
  const valid = (PREP_DIFFICULTIES as readonly string[]).includes(difficulty ?? "");
  await setPrepGrading(getDb(), id, {
    difficulty: valid ? (difficulty as PrepDifficulty) : null,
  });
  revalidatePath(path);
  revalidatePath("/prep/system-design");
}

export async function setFrequency(id: string, frequency: number, path: string) {
  // 0-100. Out-of-range values would render a bar wider than its track.
  const n = Math.max(0, Math.min(100, Math.round(frequency)));
  await setPrepGrading(getDb(), id, { frequency: n });
  revalidatePath(path);
  revalidatePath("/prep/system-design");
}

/**
 * Reorder or reparent a page from the navigation tree.
 *
 * Revalidates the layout rather than one page, because the sidebar is rendered there and a
 * move that does not show up in the tree it was performed in looks like it failed.
 */
export async function movePrepPage(id: string, newParentId: string | null, newIndex: number) {
  const result = await movePage(getDb(), id, newParentId, newIndex);
  revalidatePath("/prep", "layout");
  return result;
}
