import type { PrepResourceKind } from "@/db/schema";

/**
 * Working out what a pasted link actually is.
 *
 * Pasting a URL should be the whole interaction -- no dropdown asking whether it is a video,
 * no box asking who made it. Both are derivable, and anything derivable that you ask a person
 * for is a small tax charged every single time.
 *
 * Pure and total: an unparseable string is still saved as an article rather than rejected,
 * because losing a link you meant to keep is worse than filing it imperfectly.
 */

export type ParsedResource = {
  kind: PrepResourceKind;
  url: string;
  /** YouTube's video id, when this is one. Kept so the embed never re-parses the URL. */
  videoId: string | null;
  /** Publisher, when the host names one recognisably. */
  source: string | null;
  /** A readable fallback title, used only when none is supplied. */
  suggestedTitle: string;
};

/**
 * Hosts worth naming. Deliberately a short list of the places this material actually comes
 * from -- a general-purpose "prettify the domain" rule produces things like "Www" and "Co".
 */
const SOURCES: [RegExp, string][] = [
  [/(^|\.)youtube\.com$|(^|\.)youtu\.be$/, "YouTube"],
  [/(^|\.)hellointerview\.com$/, "Hello Interview"],
  [/(^|\.)bytebytego\.com$/, "ByteByteGo"],
  [/(^|\.)blog\.bytebytego\.com$/, "ByteByteGo"],
  [/(^|\.)systemdesign\.one$/, "System Design One"],
  [/(^|\.)highscalability\.com$/, "High Scalability"],
  [/(^|\.)martinfowler\.com$/, "Martin Fowler"],
  [/(^|\.)aws\.amazon\.com$/, "AWS"],
  [/(^|\.)cloud\.google\.com$/, "Google Cloud"],
  [/(^|\.)engineering\.fb\.com$/, "Meta Engineering"],
  [/(^|\.)netflixtechblog\.com$/, "Netflix Tech Blog"],
  [/(^|\.)eng\.uber\.com$|(^|\.)uber\.com$/, "Uber Engineering"],
  [/(^|\.)discord\.com$/, "Discord Engineering"],
  [/(^|\.)dropbox\.tech$/, "Dropbox Tech"],
  [/(^|\.)slack\.engineering$/, "Slack Engineering"],
  [/(^|\.)stripe\.com$/, "Stripe"],
  [/(^|\.)github\.com$/, "GitHub"],
  [/(^|\.)medium\.com$/, "Medium"],
  [/(^|\.)substack\.com$/, "Substack"],
  [/(^|\.)educative\.io$/, "Educative"],
  [/(^|\.)arxiv\.org$/, "arXiv"],
];

/** Every YouTube URL shape that gets pasted, including shorts and the share domain. */
export function youtubeId(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, "").toLowerCase();

  if (host === "youtu.be") {
    const id = u.pathname.slice(1).split("/")[0];
    return valid(id) ? id : null;
  }
  if (host !== "youtube.com" && host !== "m.youtube.com" && host !== "music.youtube.com") {
    return null;
  }
  const v = u.searchParams.get("v");
  if (v && valid(v)) return v;

  const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/);
  return m && valid(m[1]) ? m[1] : null;
}

/** YouTube ids are 11 characters of a fixed alphabet; anything else is a page, not a video. */
function valid(id: string): boolean {
  return /^[A-Za-z0-9_-]{11}$/.test(id);
}

function hostOf(raw: string): string | null {
  try {
    return new URL(raw.trim()).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export function sourceOf(raw: string): string | null {
  const host = hostOf(raw);
  if (!host) return null;
  for (const [pattern, name] of SOURCES) if (pattern.test(host)) return name;
  return host;
}

/** A title from the URL itself, for when a link is pasted without one. */
function titleFromUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    const last = u.pathname.split("/").filter(Boolean).pop();
    if (!last) return u.hostname.replace(/^www\./, "");
    const words = decodeURIComponent(last)
      .replace(/\.(html?|php|md)$/i, "")
      .replace(/[-_]+/g, " ")
      .trim();
    if (!words) return u.hostname.replace(/^www\./, "");
    return words.charAt(0).toUpperCase() + words.slice(1);
  } catch {
    return raw.slice(0, 80);
  }
}

export function parseResource(raw: string, title?: string | null): ParsedResource {
  const url = raw.trim();
  const videoId = youtubeId(url);
  return {
    kind: videoId ? "video" : "article",
    url,
    videoId,
    source: sourceOf(url),
    suggestedTitle: (title ?? "").trim() || titleFromUrl(url),
  };
}
