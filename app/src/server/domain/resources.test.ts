import { describe, expect, it } from "vitest";

import { parseResource, sourceOf, youtubeId } from "./resources";

describe("youtubeId", () => {
  it.each([
    ["https://www.youtube.com/watch?v=bUHFg8CZFws", "bUHFg8CZFws"],
    ["https://youtu.be/bUHFg8CZFws", "bUHFg8CZFws"],
    ["https://youtu.be/bUHFg8CZFws?t=120", "bUHFg8CZFws"],
    ["https://www.youtube.com/embed/bUHFg8CZFws", "bUHFg8CZFws"],
    ["https://www.youtube.com/shorts/bUHFg8CZFws", "bUHFg8CZFws"],
    ["https://m.youtube.com/watch?v=bUHFg8CZFws&list=PLk", "bUHFg8CZFws"],
    // A playlist link opened on a video still identifies the video.
    ["https://www.youtube.com/watch?list=PLabc&v=bUHFg8CZFws", "bUHFg8CZFws"],
  ])("reads %s", (url, id) => {
    expect(youtubeId(url)).toBe(id);
  });

  // A channel or playlist page is not a video: embedding one would render a broken player.
  it.each([
    "https://www.youtube.com/@hello_interview",
    "https://www.youtube.com/playlist?list=PLkQkbY7JNJuBoTemzQfjym0sqbOHt5fnV",
    "https://hellointerview.com/learn/system-design/problems/whatsapp",
    "not a url at all",
    "",
  ])("returns null for %s", (url) => {
    expect(youtubeId(url)).toBeNull();
  });
});

describe("sourceOf", () => {
  it.each([
    ["https://www.youtube.com/watch?v=bUHFg8CZFws", "YouTube"],
    ["https://www.hellointerview.com/learn/system-design/problems/whatsapp", "Hello Interview"],
    ["https://blog.bytebytego.com/p/design-a-url-shortener", "ByteByteGo"],
    ["https://netflixtechblog.com/some-post", "Netflix Tech Blog"],
  ])("names %s", (url, source) => {
    expect(sourceOf(url)).toBe(source);
  });

  it("falls back to the bare host rather than inventing a name", () => {
    expect(sourceOf("https://www.example.dev/a/b")).toBe("example.dev");
  });
});

describe("parseResource", () => {
  it("classifies a video and keeps its id", () => {
    const r = parseResource("https://youtu.be/bUHFg8CZFws");
    expect(r.kind).toBe("video");
    expect(r.videoId).toBe("bUHFg8CZFws");
    expect(r.source).toBe("YouTube");
  });

  it("classifies anything else as an article", () => {
    const r = parseResource("https://blog.bytebytego.com/p/design-a-url-shortener");
    expect(r.kind).toBe("article");
    expect(r.videoId).toBeNull();
  });

  it("derives a readable title from the path when none is given", () => {
    expect(parseResource("https://blog.bytebytego.com/p/design-a-url-shortener").suggestedTitle).toBe(
      "Design a url shortener",
    );
  });

  it("prefers a supplied title", () => {
    expect(parseResource("https://youtu.be/bUHFg8CZFws", "WhatsApp deep dive").suggestedTitle).toBe(
      "WhatsApp deep dive",
    );
  });

  // Losing a link you meant to keep is worse than filing it imperfectly.
  it("still yields something usable for an unparseable string", () => {
    const r = parseResource("totally not a url");
    expect(r.kind).toBe("article");
    expect(r.suggestedTitle).toBe("totally not a url");
  });
});
