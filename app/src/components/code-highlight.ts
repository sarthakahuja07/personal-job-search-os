import hljs from "highlight.js/lib/common";
import scala from "highlight.js/lib/languages/scala";

// `lib/common` carries the thirty-odd languages most code is written in, which is every one
// this app maps an extension to except Scala. Registered once, here, so both the multi-file
// workspace and the single-file solution viewer share one registry instead of two.
hljs.registerLanguage("scala", scala);

export function highlightCode(content: string, language: string | null): string {
  if (language && hljs.getLanguage(language)) {
    try {
      return hljs.highlight(content, { language, ignoreIllegals: true }).value;
    } catch {
      // Fall through to plain text -- a grammar that chokes is not worth an error boundary.
    }
  }
  return escapeHtml(content);
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
