"use client";

import { useState } from "react";

import { CodeView, CopyButton, ExpandIcon, Modal, type CodeFile } from "./code-workspace";

/**
 * One file, shown in full, right where it's discussed.
 *
 * A DSA answer has exactly two code artifacts -- the brute force and the optimized solution --
 * each tied to a specific paragraph of explanation. `CodeWorkspace`'s file tree and add/remove
 * controls exist for a design's whole module of source files and are pure overhead here: one
 * file, always expanded, no explorer. The full-screen modal is the one piece of that machinery
 * still worth keeping -- a long solution in a 32rem inline pane is exactly what LLD's Expand
 * button exists to fix, and a DSA answer is no less long.
 */
export function SolutionCode({ file }: { file: CodeFile | undefined }) {
  const [fullScreen, setFullScreen] = useState(false);

  if (!file) {
    return (
      <p className="mb-4 rounded-card border border-line bg-surface px-3.5 py-3 text-[12.5px] text-ink-faint">
        Code for this section has not been added yet.
      </p>
    );
  }

  return (
    <div className="mb-4 overflow-hidden rounded-card border border-line bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-surface-2 px-3.5 py-2">
        <span className="truncate font-mono text-[12px] text-ink-dim">{file.path}</span>
        <div className="flex shrink-0 items-center gap-2">
          {file.language && (
            <span className="text-[10.5px] uppercase tracking-wide text-ink-faint">
              {file.language}
            </span>
          )}
          <CopyButton text={file.content} />
          <button
            type="button"
            onClick={() => setFullScreen(true)}
            className="flex items-center gap-1.5 text-[12px] text-ink-dim transition hover:text-ink"
            title="Open full screen"
          >
            <ExpandIcon />
            Expand
          </button>
        </div>
      </div>
      <div className="max-h-[32rem] overflow-auto">
        <CodeView file={file} />
      </div>

      {fullScreen && (
        <Modal onClose={() => setFullScreen(false)} title={file.path}>
          <div className="h-full overflow-auto">
            <CodeView file={file} />
          </div>
        </Modal>
      )}
    </div>
  );
}
