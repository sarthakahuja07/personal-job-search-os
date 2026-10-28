"use client";

import { useSyncExternalStore, useTransition } from "react";

import { markCalled, undoCalled } from "@/app/hr/actions";
import { cx } from "./ui";

const linkButton =
  "inline-flex items-center rounded-md border border-line bg-surface-2 px-2.5 py-1 text-[12px] " +
  "font-medium text-ink-dim transition hover:border-line-strong hover:text-ink";

type UndoRecord = { at: number; prev: number | null };
const undoKey = (contactId: string) => `hr-undo:${contactId}`;

/**
 * The call this tab just recorded, kept so Undo survives the row moving.
 *
 * In sessionStorage rather than component state because marking a call moves the row: on the HR
 * page it changes section and on the dashboard it leaves the list, and either remounts this
 * component -- taking an in-memory Undo with it at exactly the moment it is needed.
 */
const UNDO_EVENT = "hr-undo";

function readRaw(contactId: string): string | null {
  try {
    return sessionStorage.getItem(undoKey(contactId));
  } catch {
    return null;
  }
}

function writeUndo(contactId: string, rec: UndoRecord | null) {
  try {
    if (rec) sessionStorage.setItem(undoKey(contactId), JSON.stringify(rec));
    else sessionStorage.removeItem(undoKey(contactId));
  } catch {
    // Private mode or blocked storage: there is simply no Undo after the row re-renders.
  }
  window.dispatchEvent(new Event(UNDO_EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener(UNDO_EVENT, onChange);
  return () => window.removeEventListener(UNDO_EVENT, onChange);
}

/** Only an Undo for the stamp this tab made: a later call from elsewhere makes it stale. */
function parseUndo(raw: string | null, lastCalledMs: number | null): UndoRecord | null {
  try {
    const rec = raw ? (JSON.parse(raw) as UndoRecord) : null;
    return rec && rec.at === lastCalledMs ? rec : null;
  } catch {
    return null;
  }
}

/**
 * Call, message, and record that the call happened.
 *
 * Plain links for dialling and WhatsApp, because they hand off to another app and work the same
 * in the iPhone home-screen PWA. "Called" is the only thing that changes state, and it offers an
 * undo instead of a confirmation dialog — native dialogs silently do nothing in that PWA.
 */
export function HrCallActions({
  contactId,
  name,
  tel,
  whatsapp,
  lastCalledMs,
  primary,
}: {
  contactId: string;
  name: string;
  tel: string | null;
  whatsapp: string | null;
  lastCalledMs: number | null;
  primary: boolean;
}) {
  const [pending, start] = useTransition();
  // The server snapshot is null, so the first render matches the server's and storage is only
  // consulted after hydration.
  const raw = useSyncExternalStore(subscribe, () => readRaw(contactId), () => null);
  const undo = parseUndo(raw, lastCalledMs);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tel && (
        <a
          href={`tel:+${tel}`}
          className={cx(
            linkButton,
            primary && "border-accent/40 bg-accent-soft text-accent-ink hover:text-accent-ink",
          )}
        >
          Call {name}
        </a>
      )}
      {whatsapp && (
        <a href={whatsapp} target="_blank" rel="noreferrer" className={linkButton}>
          WhatsApp
        </a>
      )}
      {undo ? (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              await undoCalled(contactId, undo.prev);
              writeUndo(contactId, null);
            })
          }
          className={cx(
            "rounded px-1.5 py-1 text-[12px] text-ink-faint underline-offset-2 transition hover:text-ink-dim hover:underline",
            pending && "opacity-50",
          )}
        >
          Marked called · Undo
        </button>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const at = await markCalled(contactId);
              writeUndo(contactId, { at, prev: lastCalledMs });
            })
          }
          title="Record that you spoke to them — the prompt returns when something new opens"
          className={cx(linkButton, pending && "opacity-50")}
        >
          Called
        </button>
      )}
    </div>
  );
}
