import { describe, expect, it } from "vitest";

import {
  allDirPaths,
  buildFileTree,
  languageFor,
  normalizeCodePath,
  type TreeNode,
} from "./code";

describe("languageFor", () => {
  it("maps the languages an LLD answer is actually written in", () => {
    expect(languageFor("src/model/Vehicle.java")).toBe("java");
    expect(languageFor("solution.py")).toBe("python");
    expect(languageFor("store.ts")).toBe("typescript");
    expect(languageFor("main.go")).toBe("go");
    expect(languageFor("Node.hpp")).toBe("cpp");
  });

  it("is case-insensitive, because an extension is not a decision", () => {
    expect(languageFor("Main.JAVA")).toBe("java");
    expect(languageFor("README.MD")).toBe("markdown");
  });

  it("recognises files that carry the language in the name", () => {
    expect(languageFor("Dockerfile")).toBe("bash");
    expect(languageFor("build/Makefile")).toBe("bash");
  });

  it("returns null rather than guessing", () => {
    expect(languageFor("LICENSE")).toBeNull();
    expect(languageFor("notes.wat")).toBeNull();
    expect(languageFor("")).toBeNull();
  });

  it("treats a dotfile as having no extension", () => {
    // ".gitignore" is a name beginning with a dot, not a file of type "gitignore".
    expect(languageFor(".gitignore")).toBeNull();
  });
});

describe("normalizeCodePath", () => {
  it("collapses the ways a human writes the same path", () => {
    expect(normalizeCodePath("  src/model/Vehicle.java ")).toBe("src/model/Vehicle.java");
    expect(normalizeCodePath("/src/model/Vehicle.java")).toBe("src/model/Vehicle.java");
    expect(normalizeCodePath("./src//model/Vehicle.java")).toBe("src/model/Vehicle.java");
    expect(normalizeCodePath("src\\model\\Vehicle.java")).toBe("src/model/Vehicle.java");
  });

  it("returns empty for a path that is only separators", () => {
    expect(normalizeCodePath("///")).toBe("");
    expect(normalizeCodePath("   ")).toBe("");
  });
});

describe("buildFileTree", () => {
  const files = [
    { id: "3", path: "README.md" },
    { id: "1", path: "src/model/Vehicle.java" },
    { id: "2", path: "src/Main.java" },
    { id: "4", path: "src/model/Spot.java" },
  ];

  it("nests files under the folders their paths name", () => {
    const tree = buildFileTree(files);

    expect(tree.map((n) => n.name)).toEqual(["src", "README.md"]);
    const src = tree[0] as Extract<TreeNode, { kind: "dir" }>;
    expect(src.kind).toBe("dir");
    expect(src.children.map((n) => n.name)).toEqual(["model", "Main.java"]);
  });

  it("sorts folders before files, then by name", () => {
    const tree = buildFileTree(files);
    const src = tree[0] as Extract<TreeNode, { kind: "dir" }>;
    const model = src.children[0] as Extract<TreeNode, { kind: "dir" }>;

    expect(model.name).toBe("model");
    expect(model.children.map((n) => n.name)).toEqual(["Spot.java", "Vehicle.java"]);
  });

  it("creates each folder once, however many files it holds", () => {
    const tree = buildFileTree(files);
    expect(tree.filter((n) => n.name === "src")).toHaveLength(1);
  });

  it("gives every folder its full path, not just its name", () => {
    const tree = buildFileTree(files);
    const src = tree[0] as Extract<TreeNode, { kind: "dir" }>;
    const model = src.children[0] as Extract<TreeNode, { kind: "dir" }>;

    expect(src.path).toBe("src");
    expect(model.path).toBe("src/model");
  });

  it("ignores a path that names nothing", () => {
    expect(buildFileTree([{ id: "x", path: "" }])).toEqual([]);
  });
});

describe("allDirPaths", () => {
  it("returns every folder, at every depth", () => {
    const tree = buildFileTree([
      { id: "1", path: "src/model/Vehicle.java" },
      { id: "2", path: "test/ModelTest.java" },
      { id: "3", path: "README.md" },
    ]);

    expect(allDirPaths(tree).sort()).toEqual(["src", "src/model", "test"]);
  });

  it("is empty when nothing is nested", () => {
    expect(allDirPaths(buildFileTree([{ id: "1", path: "Main.java" }]))).toEqual([]);
  });
});
