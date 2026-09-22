import { CodeView, CopyButton, type CodeFile } from "./code-workspace";

/**
 * One file, shown in full, right where it's discussed.
 *
 * A DSA answer has exactly two code artifacts -- the brute force and the optimized solution --
 * each tied to a specific paragraph of explanation. `CodeWorkspace`'s file tree and add/remove
 * controls exist for a design's whole module of source files and are pure overhead here; this
 * is a server component (no explorer state to hold), always expanded, one file, done.
 */
export function SolutionCode({ file }: { file: CodeFile | undefined }) {
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
        </div>
      </div>
      <div className="max-h-[32rem] overflow-auto">
        <CodeView file={file} />
      </div>
    </div>
  );
}
