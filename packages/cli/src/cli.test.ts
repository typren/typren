import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applySettings, scaffold } from "./cli";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "typren-cli-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("scaffold", () => {
  it("fails when neither src/app nor app exists", () => {
    const result = scaffold(dir);
    expect(result.ok).toBe(false);
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });

  it("scaffolds under src/ when src/app exists, wiring cms.config.ts to src/content", () => {
    fs.mkdirSync(path.join(dir, "src", "app"), { recursive: true });
    const result = scaffold(dir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.baseDir).toBe("src");
    expect(result.skipped).toHaveLength(0);
    expect(fs.existsSync(path.join(dir, "src/cms.config.ts"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "src/app/editor/[[...segment]]/page.tsx"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "src/slices/registry.ts"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "src/content/home.md"))).toBe(true);
    expect(fs.readFileSync(path.join(dir, "src/cms.config.ts"), "utf8")).toContain('"src/content"');
  });

  it("scaffolds at the project root when only app/ exists, wiring cms.config.ts to content", () => {
    fs.mkdirSync(path.join(dir, "app"), { recursive: true });
    const result = scaffold(dir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.baseDir).toBe(".");
    expect(fs.existsSync(path.join(dir, "cms.config.ts"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "app/editor/[[...segment]]/page.tsx"))).toBe(true);
    expect(fs.readFileSync(path.join(dir, "cms.config.ts"), "utf8")).toContain('"content"');
  });

  // The scaffold mounts the editor from the dedicated @typren/editor package,
  // never from @typren/core (that package has no UI), and it is scoped to the
  // Pages editing loop that package actually ships. The optional catch-all
  // must also stay the only `page` directly under app/editor (a sibling
  // page.tsx there is a same-specificity conflict Next refuses to build).
  it("scaffolds the editor: catch-all route, TyprenEditor from @typren/editor, Pages loop only", () => {
    fs.mkdirSync(path.join(dir, "src", "app"), { recursive: true });
    const result = scaffold(dir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const editorDir = path.join(dir, "src/app/editor");
    expect(fs.existsSync(path.join(editorDir, "page.tsx"))).toBe(false);
    expect(fs.existsSync(path.join(editorDir, "shell-client.tsx"))).toBe(true);
    expect(fs.existsSync(path.join(editorDir, "preview/bridge.tsx"))).toBe(true);

    const sources = result.created
      .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
      .map((f) => fs.readFileSync(path.join(dir, f), "utf8"));
    expect(sources.some((src) => src.includes('"@typren/core/element"') || src.includes('"@typren/core/editor"'))).toBe(false);
    expect(sources.some((src) => src.includes('"@typren/editor"'))).toBe(true);

    // The shell mounts the React component, not the predecessor's dropped
    // custom element.
    const shell = fs.readFileSync(path.join(editorDir, "shell-client.tsx"), "utf8");
    expect(shell).toContain("TyprenEditor");
    expect(shell).not.toContain("typren-shell");

    // Dropped surfaces stay dropped: the editor ships no Settings screen, so
    // emitting settings handlers would be dead wiring against a missing UI.
    const actions = fs.readFileSync(path.join(editorDir, "actions.ts"), "utf8");
    expect(actions).not.toContain("writeBootstrap");
    expect(actions).not.toContain("saveSettingsDraft");
  });

  it("prefers src/app when both src/app and app exist", () => {
    fs.mkdirSync(path.join(dir, "src", "app"), { recursive: true });
    fs.mkdirSync(path.join(dir, "app"), { recursive: true });
    const result = scaffold(dir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.baseDir).toBe("src");
  });

  it("is idempotent: a second run skips every file and writes nothing new", () => {
    fs.mkdirSync(path.join(dir, "src", "app"), { recursive: true });
    const first = scaffold(dir);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const before = fs.readFileSync(path.join(dir, "src/cms.config.ts"), "utf8");
    fs.writeFileSync(path.join(dir, "src/cms.config.ts"), "// user-edited\n" + before);

    const second = scaffold(dir);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.created).toHaveLength(0);
    expect(second.skipped.length).toBe(first.created.length);
    // The user's edit survived — nothing was overwritten.
    expect(fs.readFileSync(path.join(dir, "src/cms.config.ts"), "utf8")).toContain("// user-edited");
  });

  it("--force overwrites existing files", () => {
    fs.mkdirSync(path.join(dir, "src", "app"), { recursive: true });
    scaffold(dir);
    fs.writeFileSync(path.join(dir, "src/cms.config.ts"), "// stale\n");

    const result = scaffold(dir, { force: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skipped).toHaveLength(0);
    expect(fs.readFileSync(path.join(dir, "src/cms.config.ts"), "utf8")).not.toContain("// stale");
  });

  it("places next.config.ts and typren.config.json at the project root even with a src/ layout", () => {
    fs.mkdirSync(path.join(dir, "src", "app"), { recursive: true });
    const result = scaffold(dir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(fs.existsSync(path.join(dir, "next.config.ts"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "typren.config.json"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "src", "next.config.ts"))).toBe(false);
    expect(result.created).toContain("next.config.ts");
    expect(result.created).toContain("typren.config.json");
    // cms.config.ts reads the bootstrap it scaffolds alongside it.
    expect(fs.readFileSync(path.join(dir, "src/cms.config.ts"), "utf8")).toContain("createFsSettingsAdapter");
  });
});

describe("applySettings", () => {
  function writeBootstrap(overrides: Record<string, unknown> = {}) {
    fs.writeFileSync(
      path.join(dir, "typren.config.json"),
      JSON.stringify(
        { adminRoute: "editor", locales: ["en"], defaultLocale: "en", routing: "prefix-except-default", onboarded: false, ...overrides },
        null,
        2
      )
    );
  }

  it("validates a good config and creates a wired next.config.ts when none exists", () => {
    writeBootstrap();
    const result = applySettings(dir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nextConfig).toBe("created");
    expect(result.cmsConfig).toBe("not-found");
    expect(fs.readFileSync(path.join(dir, "next.config.ts"), "utf8")).toContain("typren:admin-route-rewrite");
  });

  it("rejects a bad adminRoute (reserved word)", () => {
    writeBootstrap({ adminRoute: "api" });
    const result = applySettings(dir);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/reserved/);
  });

  it("rejects a bad adminRoute (unsafe shape)", () => {
    writeBootstrap({ adminRoute: "a/b" });
    const result = applySettings(dir);
    expect(result.ok).toBe(false);
  });

  it("rejects a defaultLocale not present in locales", () => {
    writeBootstrap({ locales: ["en", "es"], defaultLocale: "fr" });
    const result = applySettings(dir);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/defaultLocale/);
  });

  it("is idempotent: a second run reports already-wired and leaves the file untouched", () => {
    writeBootstrap();
    const first = applySettings(dir);
    expect(first.ok).toBe(true);
    const contentAfterFirst = fs.readFileSync(path.join(dir, "next.config.ts"), "utf8");

    const second = applySettings(dir);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.nextConfig).toBe("already-wired");
    expect(fs.readFileSync(path.join(dir, "next.config.ts"), "utf8")).toBe(contentAfterFirst);
  });

  it("detects an already-wired cms.config.ts via the marker comment", () => {
    writeBootstrap();
    fs.writeFileSync(path.join(dir, "cms.config.ts"), "// typren:bootstrap-wired\nexport {};\n");
    const result = applySettings(dir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cmsConfig).toBe("already-wired");
  });

  it("flags a legacy cms.config.ts that doesn't read typren.config.json, without touching it", () => {
    writeBootstrap();
    fs.writeFileSync(path.join(dir, "cms.config.ts"), "export const cmsConfig = {};\n");
    const result = applySettings(dir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cmsConfig).toBe("needs-manual-update");
    expect(result.notes.join("\n")).toContain("cms.config.ts");
    expect(fs.readFileSync(path.join(dir, "cms.config.ts"), "utf8")).toBe("export const cmsConfig = {};\n");
  });
});
