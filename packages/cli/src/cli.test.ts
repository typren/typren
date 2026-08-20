import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applySettings, main, nextSteps, resolveReviewPaths, review, scaffold } from "./cli";
import * as telemetry from "./telemetry";

/** A throwaway git repo for the `review` paths that shell out to `git`
 *  (gitChangedContentFiles, gitShow, gitDiffRaw). Lives under the tmp `dir`
 *  each test already gets, so it's cleaned up the same way. */
function initGitRepo(repoDir: string): void {
  const git = (args: string[]) => execFileSync("git", args, { cwd: repoDir, stdio: "ignore" });
  git(["init", "-q"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);
}

function commitAll(repoDir: string, message: string): void {
  execFileSync("git", ["add", "-A"], { cwd: repoDir, stdio: "ignore" });
  execFileSync("git", ["commit", "-q", "-m", message], { cwd: repoDir, stdio: "ignore" });
}

/**
 * Vitest can't spy on node:child_process ("Module namespace is not
 * configurable in ESM"), so faking `gh`'s exit behavior for
 * ghAvailable()/openOrUpdateContentPr's real execFileSync calls means giving
 * them an actual `gh` to find: a throwaway shell script on a PATH prepended
 * for just this call. `okSubcommands` lists the argv[0] values (e.g.
 * "--version") the fake exits 0 for; anything else exits 1, simulating a
 * real gh failure. POSIX-only (`#!/bin/sh`), matching this repo's own
 * pre-push hook, which is meant to run on a contributor's own machine, not a
 * hosted Windows runner.
 */
function withFakeGh(okSubcommands: string[], fn: () => void): void {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "typren-fakegh-"));
  const cases = okSubcommands.map((s) => `  "${s}") exit 0 ;;`).join("\n");
  fs.writeFileSync(
    path.join(binDir, "gh"),
    `#!/bin/sh\ncase "$1" in\n${cases}\n  *) exit 1 ;;\nesac\n`,
    { mode: 0o755 }
  );
  const originalPath = process.env.PATH;
  process.env.PATH = `${binDir}${path.delimiter}${originalPath ?? ""}`;
  try {
    fn();
  } finally {
    process.env.PATH = originalPath;
    fs.rmSync(binDir, { recursive: true, force: true });
  }
}

let dir: string;
let originalCwd: string;
let noticeSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "typren-cli-"));
  originalCwd = process.cwd();
  // Every command main() dispatches to touches telemetry; stub all four so
  // no test ever reads or writes this machine's real telemetry state file,
  // and so wiring assertions (record called/not called) are deterministic.
  vi.spyOn(telemetry, "isEnabled").mockReturnValue(true);
  noticeSpy = vi.spyOn(telemetry, "firstRunNotice").mockReturnValue(null);
  vi.spyOn(telemetry, "record").mockImplementation(() => {});
  vi.spyOn(telemetry, "setEnabled").mockImplementation(() => {});
});

afterEach(() => {
  process.chdir(originalCwd);
  process.exitCode = undefined;
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
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
    expect(fs.existsSync(path.join(dir, "src/cms-actions.ts"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "src/app/media/upload/route.ts"))).toBe(true);
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
    expect(fs.existsSync(path.join(dir, "cms-actions.ts"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "app/media/upload/route.ts"))).toBe(true);
    expect(fs.readFileSync(path.join(dir, "cms.config.ts"), "utf8")).toContain('"content"');
  });

  // The editor was dropped from the scaffold entirely: no editor route, no
  // @typren/editor import anywhere in the output. This is the regression
  // that would matter most, so it's asserted directly rather than inferred
  // from a positive check on unrelated files.
  it("drops the editor entirely: no editor routes, no @typren/editor import, actions relocated", () => {
    fs.mkdirSync(path.join(dir, "src", "app"), { recursive: true });
    const result = scaffold(dir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const dropped of [
      "src/app/editor/layout.tsx",
      "src/app/editor/shell-client.tsx",
      "src/app/editor/[[...segment]]/page.tsx",
      "src/app/editor/preview/bridge.tsx",
      "src/app/editor/preview/[slug]/page.tsx",
    ]) {
      expect(fs.existsSync(path.join(dir, dropped))).toBe(false);
    }

    // Relocated, not dropped: the predecessor's app/editor/actions.ts and
    // app/editor/media/upload/route.ts now live outside the (removed) editor
    // route tree.
    expect(fs.existsSync(path.join(dir, "src/cms-actions.ts"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "src/app/editor/actions.ts"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "src/app/media/upload/route.ts"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "src/app/editor/media/upload/route.ts"))).toBe(false);

    // A quoted specifier, not a bare substring match: field-schema.ts's own
    // doc comment mentions @typren/editor by name (it says the field hints
    // are inert until that package is installed), which is fine. An actual
    // `from "@typren/editor"` import is the regression this guards against.
    const sources = result.created
      .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
      .map((f) => fs.readFileSync(path.join(dir, f), "utf8"));
    expect(sources.some((src) => src.includes('"@typren/editor"'))).toBe(false);
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
    // The user's edit survived because nothing was overwritten.
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

describe("nextSteps", () => {
  it("says the editor package is unpublished, without implying an editor route exists", () => {
    const text = nextSteps("src");
    expect(text).toContain("not published to npm yet");
    expect(text).not.toContain("editor route compiles");
  });

  it("does not point Tailwind at the removed, unpublished editor package", () => {
    expect(nextSteps("src")).not.toContain("@typren/editor/dist");
  });

  it("does not tell users to open a /editor route, which no longer exists in this scaffold", () => {
    expect(nextSteps("src")).not.toContain("open /editor");
  });

  it("roots the content-rendering hint in baseDir", () => {
    expect(nextSteps("src")).toContain("src/app/");
    expect(nextSteps(".")).toContain("app/");
  });

  it("keeps the tsconfig path-alias step, still needed regardless of baseDir", () => {
    expect(nextSteps("src")).toContain('"@/*": ["./src/*"]');
    expect(nextSteps(".")).toContain('"@/*": ["./*"]');
  });
});

describe("resolveReviewPaths", () => {
  it("defaults to src/content (and siblings) when a src/ directory exists", () => {
    fs.mkdirSync(path.join(dir, "src"));
    const paths = resolveReviewPaths(dir);
    expect(paths).toEqual({
      contentDir: "src/content",
      resourcesDir: "src/content/resources",
      seoFile: "src/app/seo.tsx",
      seoRegistryFile: "src/slices/seo-registry.ts",
    });
  });

  it("falls back to content/ at the project root when there's no src/ directory", () => {
    const paths = resolveReviewPaths(dir);
    expect(paths.contentDir).toBe("content");
    expect(paths.resourcesDir).toBe("content/resources");
    expect(paths.seoFile).toBe("app/seo.tsx");
    expect(paths.seoRegistryFile).toBe("slices/seo-registry.ts");
  });

  it("lets typren.config.json's review key override individual paths, leaving the rest auto-detected", () => {
    fs.mkdirSync(path.join(dir, "src"));
    fs.writeFileSync(path.join(dir, "typren.config.json"), JSON.stringify({ review: { contentDir: "docs/content" } }));
    const paths = resolveReviewPaths(dir);
    expect(paths.contentDir).toBe("docs/content");
    expect(paths.seoFile).toBe("src/app/seo.tsx"); // untouched key keeps its auto-detected default
  });

  it("falls back to defaults on a malformed typren.config.json rather than throwing", () => {
    fs.writeFileSync(path.join(dir, "typren.config.json"), "{ not valid json");
    expect(() => resolveReviewPaths(dir)).not.toThrow();
    expect(resolveReviewPaths(dir).contentDir).toBe("content");
  });
});

describe("review", () => {
  it("finds a slug via the auto-detected content dir and skips SEO checks whose file doesn't exist", () => {
    fs.mkdirSync(path.join(dir, "content"), { recursive: true });
    fs.writeFileSync(path.join(dir, "content/home.md"), "---\ntitle: Home\nslices: []\n---\n");
    const result = review(dir, { slug: "home" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.briefs[0].file).toBe("content/home.md");
    expect(result.briefs[0].checks).toContainEqual({
      id: "aio.entity.description-present",
      status: "skip",
      message: "app/seo.tsx not found",
    });
  });

  it("finds a resources/*.md post via the auto-detected resourcesDir, under a src/ layout", () => {
    fs.mkdirSync(path.join(dir, "src", "content", "resources"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src/content/resources/first-post.md"), "Just a post body, no frontmatter.\n");
    const result = review(dir, { slug: "first-post" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.briefs[0].file).toBe("src/content/resources/first-post.md");
  });

  it("reports a clear error naming the resolved paths when the slug isn't found anywhere", () => {
    const result = review(dir, { slug: "missing" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("content/missing.md");
    expect(result.error).toContain("content/resources/missing.md");
  });

  it("honors a review.seoFile override from typren.config.json for the entity-description check", () => {
    fs.mkdirSync(path.join(dir, "content"), { recursive: true });
    fs.writeFileSync(path.join(dir, "content/home.md"), "---\ntitle: Home\n---\n");
    fs.mkdirSync(path.join(dir, "config"), { recursive: true });
    fs.writeFileSync(path.join(dir, "config/seo.ts"), 'export const SITE_ENTITY_DESCRIPTION = "Example, Inc.";\n');
    fs.writeFileSync(path.join(dir, "typren.config.json"), JSON.stringify({ review: { seoFile: "config/seo.ts" } }));

    const result = review(dir, { slug: "home" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.briefs[0].checks).toContainEqual({ id: "aio.entity.description-present", status: "pass" });
  });

  describe("with no slug", () => {
    it("reports a clean error when the base ref can't be diffed against (not a git repo)", () => {
      fs.mkdirSync(path.join(dir, "content"), { recursive: true });
      const result = review(dir, {});
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain("content");
    });

    it("finds every changed file under the resolved content dir against --base", () => {
      initGitRepo(dir);
      fs.mkdirSync(path.join(dir, "content"), { recursive: true });
      fs.writeFileSync(path.join(dir, "content/home.md"), "---\ntitle: Home\n---\n");
      commitAll(dir, "base");
      // Uncommitted edit: gitChangedContentFiles diffs the working tree too.
      fs.writeFileSync(path.join(dir, "content/home.md"), "---\ntitle: Home Updated\n---\n");

      const result = review(dir, { base: "HEAD" });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.briefs.map((b) => b.file)).toEqual(["content/home.md"]);
    });
  });
});

describe("main", () => {
  it("prints the CLI's own version, read from package.json, for --version", () => {
    // vitest runs with cwd at the repo root (same assumption the root
    // package.json's other scripts, e.g. coverage-new-code.mjs, make).
    const version = JSON.parse(fs.readFileSync(path.resolve("packages/cli/package.json"), "utf8")).version;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    main(["--version"]);
    expect(log).toHaveBeenCalledWith(version);
  });

  it("also accepts -v", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    main(["-v"]);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("never shows the telemetry notice or records anything for --version", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    main(["--version"]);
    expect(telemetry.firstRunNotice).not.toHaveBeenCalled();
    expect(telemetry.record).not.toHaveBeenCalled();
  });

  it("never records anything for --help", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    main(["--help"]);
    expect(telemetry.firstRunNotice).not.toHaveBeenCalled();
    expect(telemetry.record).not.toHaveBeenCalled();
  });

  it("rejects an unknown command, exits non-zero, and records nothing (it's an error path, not a usage signal)", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    main(["bogus"]);
    expect(process.exitCode).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('unknown command "bogus"'));
    expect(telemetry.firstRunNotice).not.toHaveBeenCalled();
    expect(telemetry.record).not.toHaveBeenCalled();
  });

  describe("init", () => {
    it("records init on success, printing any first-run notice before init's own output", () => {
      noticeSpy.mockReturnValue("TELEMETRY NOTICE");
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      fs.mkdirSync(path.join(dir, "src", "app"), { recursive: true });
      process.chdir(dir);

      main(["init"]);

      expect(telemetry.record).toHaveBeenCalledWith("init");
      expect(log.mock.calls[0][0]).toBe("TELEMETRY NOTICE");
    });

    it("does not record init when scaffold fails", () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      process.chdir(dir); // no src/app or app: scaffold() fails

      main(["init"]);

      expect(process.exitCode).toBe(1);
      expect(telemetry.record).not.toHaveBeenCalled();
    });
  });

  describe("apply-settings", () => {
    function writeBootstrap(overrides: Record<string, unknown> = {}) {
      fs.writeFileSync(
        path.join(dir, "typren.config.json"),
        JSON.stringify({ adminRoute: "editor", locales: ["en"], defaultLocale: "en", routing: "prefix-except-default", onboarded: false, ...overrides })
      );
    }

    it("records apply-settings on success", () => {
      writeBootstrap();
      vi.spyOn(console, "log").mockImplementation(() => {});
      process.chdir(dir);

      main(["apply-settings"]);

      expect(telemetry.record).toHaveBeenCalledWith("apply-settings");
    });

    it("does not record apply-settings when the config is invalid", () => {
      writeBootstrap({ adminRoute: "api" }); // reserved word: rejected
      vi.spyOn(console, "error").mockImplementation(() => {});
      process.chdir(dir);

      main(["apply-settings"]);

      expect(process.exitCode).toBe(1);
      expect(telemetry.record).not.toHaveBeenCalled();
    });
  });

  describe("review", () => {
    it("records review on a successful run", () => {
      fs.mkdirSync(path.join(dir, "content"), { recursive: true });
      fs.writeFileSync(path.join(dir, "content/home.md"), "---\ntitle: Home\n---\n");
      vi.spyOn(console, "log").mockImplementation(() => {});
      process.chdir(dir);

      main(["review", "home"]);

      expect(telemetry.record).toHaveBeenCalledWith("review");
      expect(process.exitCode).toBeUndefined();
    });

    it("does not record review when the slug can't be found", () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      vi.spyOn(console, "error").mockImplementation(() => {});
      process.chdir(dir);

      main(["review", "missing"]);

      expect(process.exitCode).toBe(1);
      expect(telemetry.record).not.toHaveBeenCalled();
    });

    it("still records review on a successful run that finds nothing changed", () => {
      initGitRepo(dir);
      fs.mkdirSync(path.join(dir, "content"), { recursive: true });
      fs.writeFileSync(path.join(dir, "content/home.md"), "---\ntitle: Home\n---\n");
      commitAll(dir, "base");
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      process.chdir(dir);

      main(["review", "--base", "HEAD"]);

      expect(log).toHaveBeenCalledWith("typren review: no changed content files found against the base ref.");
      expect(telemetry.record).toHaveBeenCalledWith("review");
    });

    describe("--update-pr", () => {
      it("requires a numeric PR number and a --body-file", () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        process.chdir(dir);

        main(["review", "--update-pr", "not-a-number", "--body-file", "x.md"]);

        expect(process.exitCode).toBe(1);
        expect(error).toHaveBeenCalledWith(expect.stringContaining("requires a numeric PR number"));
        expect(telemetry.record).not.toHaveBeenCalled();
      });

      it("fails when the --body-file doesn't exist, with gh available", () => {
        withFakeGh(["--version"], () => {
          const error = vi.spyOn(console, "error").mockImplementation(() => {});
          process.chdir(dir);

          main(["review", "--update-pr", "42", "--body-file", "missing-body.md"]);

          expect(process.exitCode).toBe(1);
          expect(error).toHaveBeenCalledWith(expect.stringContaining("not found"));
          expect(telemetry.record).not.toHaveBeenCalled();
        });
      });

      it("records review and confirms the PR action when gh isn't available (a deterministic no-op)", () => {
        const originalPath = process.env.PATH;
        process.env.PATH = ""; // no gh (or anything else) resolvable on PATH
        try {
          const log = vi.spyOn(console, "log").mockImplementation(() => {});
          process.chdir(dir);

          main(["review", "--update-pr", "7", "--body-file", "whatever.md"]);

          expect(process.exitCode).toBeUndefined();
          expect(log).toHaveBeenCalledWith("typren review: PR #7 skipped-no-gh.");
          expect(telemetry.record).toHaveBeenCalledWith("review");
        } finally {
          process.env.PATH = originalPath;
        }
      });
    });

    describe("--pr", () => {
      it("marks the run failed and records nothing when a PR step errors, without stopping the rest of the loop", () => {
        fs.mkdirSync(path.join(dir, "content"), { recursive: true });
        fs.writeFileSync(path.join(dir, "content/home.md"), "---\ntitle: Home\n---\n");
        // "gh --version" succeeds (ghAvailable() -> true); every other gh/git
        // subcommand the fake sees fails, including "pr" (openOrUpdateContentPr's
        // first real call). buildBrief's own git calls (gitShow/gitDiffRaw)
        // already degrade to an empty/"unable to diff" result on failure, so
        // this only surfaces as a PR-step error, not a crash.
        withFakeGh(["--version"], () => {
          vi.spyOn(console, "log").mockImplementation(() => {});
          const error = vi.spyOn(console, "error").mockImplementation(() => {});
          process.chdir(dir);

          main(["review", "home", "--pr"]);

          expect(process.exitCode).toBe(1);
          expect(error).toHaveBeenCalledWith(expect.stringContaining("PR step failed"));
          expect(telemetry.record).not.toHaveBeenCalled();
        });
      });
    });
  });

  describe("telemetry", () => {
    it("prints the current state with no argument", () => {
      vi.mocked(telemetry.isEnabled).mockReturnValue(true);
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      main(["telemetry"]);
      expect(log).toHaveBeenCalledWith("typren telemetry: on");
    });

    it("reflects isEnabled() being false in the no-argument state line", () => {
      vi.mocked(telemetry.isEnabled).mockReturnValue(false);
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      main(["telemetry"]);
      expect(log).toHaveBeenCalledWith("typren telemetry: off");
    });

    it("turns telemetry on and confirms it", () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      main(["telemetry", "on"]);
      expect(telemetry.setEnabled).toHaveBeenCalledWith(true);
      expect(log).toHaveBeenCalledWith("typren telemetry: on.");
    });

    it("turns telemetry off and confirms it", () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      main(["telemetry", "off"]);
      expect(telemetry.setEnabled).toHaveBeenCalledWith(false);
      expect(log).toHaveBeenCalledWith("typren telemetry: off.");
    });

    it("rejects an unrecognized argument without touching setEnabled", () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      main(["telemetry", "bogus"]);
      expect(process.exitCode).toBe(1);
      expect(telemetry.setEnabled).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith(expect.stringContaining('unknown argument "bogus"'));
    });

    it("never records a telemetry event for the telemetry command itself", () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      main(["telemetry", "on"]);
      expect(telemetry.record).not.toHaveBeenCalled();
    });
  });
});
