import type * as childProcess from "node:child_process";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applySettings,
  getSeoRegistryKeys,
  main,
  nextSteps,
  openOrUpdateContentPr,
  resolveReviewPaths,
  review,
  scaffold,
  type ReviewPaths,
} from "./cli";
import { envWithoutGit } from "./migrate";
import * as telemetry from "./telemetry";

// `typren studio` hands the terminal to `next dev`; its tests stub that spawn.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof childProcess>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

/** When this suite runs inside a git hook (the repo's own pre-push runs it),
 *  git has exported GIT_DIR and friends, which redirect every git call below
 *  (and the CLI's own) at the surrounding repository instead of the tmp
 *  dirs the tests set up. Left in place, initGitRepo's `git init` re-inits
 *  the real repo (flipping it bare) and the review tests read the wrong
 *  history. Scrub the inherited overrides before anything shells out. */
for (const key of Object.keys(process.env)) {
  if (key.startsWith("GIT_")) delete process.env[key];
}

/** A throwaway git repo for the `review` paths that shell out to `git`
 *  (gitChangedContentFiles, gitShow, gitDiffRaw). Lives under the tmp `dir`
 *  each test already gets, so it's cleaned up the same way. */
function initGitRepo(repoDir: string): void {
  const git = (args: string[]) => execFileSync("git", args, { cwd: repoDir, stdio: "ignore", env: envWithoutGit() });
  git(["init", "-q"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);
}

function commitAll(repoDir: string, message: string): void {
  execFileSync("git", ["add", "-A"], { cwd: repoDir, stdio: "ignore", env: envWithoutGit() });
  execFileSync("git", ["commit", "-q", "-m", message], { cwd: repoDir, stdio: "ignore", env: envWithoutGit() });
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
    expect(fs.existsSync(path.join(dir, "src/slices/registry.ts"))).toBe(true);
    expect(fs.readFileSync(path.join(dir, "src/app/typren/section/page.tsx"), "utf8")).toContain("createSectionCanvas(cmsConfig.registry)");
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
    expect(fs.readFileSync(path.join(dir, "cms.config.ts"), "utf8")).toContain('"content"');
  });

  // The editor runs in `typren studio`, beside the site: the scaffold emits no
  // editor, preview or API route and no write surface, and imports nothing
  // from @typren/studio. Asserted directly, since a stray route is the
  // regression that would matter most.
  it("scaffolds the site side only: no editor, preview or API routes, no write surface", () => {
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

    expect(result.created.filter((f) => f.startsWith("src/app/"))).toEqual(["src/app/typren/section/page.tsx"]);
    expect(fs.existsSync(path.join(dir, "src/cms-actions.ts"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "next.config.ts"))).toBe(false);

    // A quoted specifier, not a bare substring match: an actual
    // `from "@typren/studio"` import is the regression this guards against.
    const sources = result.created
      .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
      .map((f) => fs.readFileSync(path.join(dir, f), "utf8"));
    expect(sources.some((src) => src.includes('"@typren/studio"'))).toBe(false);
  });

  it("prefers src/app when both src/app and app exist", () => {
    fs.mkdirSync(path.join(dir, "src", "app"), { recursive: true });
    fs.mkdirSync(path.join(dir, "app"), { recursive: true });
    const result = scaffold(dir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.baseDir).toBe("src");
  });

  // Regression: the docs promised a loopback-bound dev script, but init never
  // wrote one, and `next dev` listens on all interfaces by default. In
  // studio preview mode that dev server renders drafts.
  describe("dev script", () => {
    function scaffoldWith(pkg: object | null) {
      fs.mkdirSync(path.join(dir, "app"), { recursive: true });
      if (pkg) fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg));
      const result = scaffold(dir);
      if (!result.ok) throw new Error(result.error);
      const written = pkg ? JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) : null;
      return { status: result.devScript, dev: written?.scripts?.dev, written };
    }

    it("binds a plain `next dev` to 127.0.0.1, keeping its other flags and fields", () => {
      const { status, dev, written } = scaffoldWith({ name: "site", scripts: { dev: "next dev --turbopack", build: "next build" } });
      expect(status).toBe("bound");
      expect(dev).toBe("next dev -H 127.0.0.1 --turbopack");
      expect(written.name).toBe("site");
      expect(written.scripts.build).toBe("next build");
    });

    it("adds a bound dev script when there is none", () => {
      expect(scaffoldWith({ name: "site" })).toMatchObject({ status: "bound", dev: "next dev -H 127.0.0.1" });
    });

    it("is idempotent on an already-bound script", () => {
      for (const dev of ["next dev -H 127.0.0.1", "next dev --hostname=127.0.0.1 -p 4000"]) {
        fs.rmSync(dir, { recursive: true, force: true });
        fs.mkdirSync(dir);
        expect(scaffoldWith({ scripts: { dev } })).toEqual(expect.objectContaining({ status: "already-bound", dev }));
      }
    });

    it("leaves scripts it can't safely rewrite alone and reports them", () => {
      for (const dev of ["next dev -H 0.0.0.0", "next dev -H localhost", "next dev -H ::1", "concurrently 'next dev' 'tsc -w'"]) {
        fs.rmSync(dir, { recursive: true, force: true });
        fs.mkdirSync(dir);
        expect(scaffoldWith({ scripts: { dev } })).toEqual(expect.objectContaining({ status: "custom", dev }));
      }
    });

    it("reports a missing package.json without creating one", () => {
      expect(scaffoldWith(null).status).toBe("no-package-json");
      expect(fs.existsSync(path.join(dir, "package.json"))).toBe(false);
    });
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

  it("does not write through a dangling symlink at a scaffold target (skips it like an existing file)", () => {
    fs.mkdirSync(path.join(dir, "src", "app"), { recursive: true });
    const outside = path.join(dir, "..", `typren-outside-${path.basename(dir)}.json`);
    fs.symlinkSync(outside, path.join(dir, "typren.config.json"));
    try {
      const result = scaffold(dir);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // fs.existsSync on a dangling symlink reports false, which used to make
      // scaffold treat the target as "doesn't exist" and write through the
      // link; lstatSync sees the symlink itself and skips it instead.
      expect(result.skipped).toContain("typren.config.json");
      expect(result.created).not.toContain("typren.config.json");
      expect(fs.existsSync(outside)).toBe(false);
    } finally {
      fs.rmSync(path.join(dir, "typren.config.json"), { force: true });
      fs.rmSync(outside, { force: true });
    }
  });

  it("--force refuses to overwrite a symlinked target rather than writing through it", () => {
    fs.mkdirSync(path.join(dir, "src", "app"), { recursive: true });
    const outside = path.join(dir, "..", `typren-outside-force-${path.basename(dir)}.json`);
    fs.writeFileSync(outside, "{}");
    fs.symlinkSync(outside, path.join(dir, "typren.config.json"));
    try {
      const result = scaffold(dir, { force: true });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain("typren.config.json");
      expect(fs.readFileSync(outside, "utf8")).toBe("{}"); // never written through
    } finally {
      fs.rmSync(path.join(dir, "typren.config.json"), { force: true });
      fs.rmSync(outside, { force: true });
    }
  });

  it("refuses to write through a symlinked parent directory", () => {
    fs.mkdirSync(path.join(dir, "src", "app"), { recursive: true });
    const outsideDir = path.join(dir, "..", `typren-outside-dir-${path.basename(dir)}`);
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.symlinkSync(outsideDir, path.join(dir, "src", "slices"));
    try {
      const result = scaffold(dir);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain("slices");
      expect(fs.readdirSync(outsideDir)).toHaveLength(0); // never written through
    } finally {
      fs.rmSync(path.join(dir, "src", "slices"), { force: true });
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("places typren.config.json at the project root even with a src/ layout", () => {
    fs.mkdirSync(path.join(dir, "src", "app"), { recursive: true });
    const result = scaffold(dir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(fs.existsSync(path.join(dir, "typren.config.json"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "src", "typren.config.json"))).toBe(false);
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

  it("validates a good config and writes nothing", () => {
    writeBootstrap();
    const result = applySettings(dir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cmsConfig).toBe("not-found");
    expect(fs.readdirSync(dir)).toEqual(["typren.config.json"]);
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
  it("points at the studio and the preview build dir it needs beside your own dev server", () => {
    const text = nextSteps("src");
    expect(text).toContain("npx typren studio");
    expect(text).toContain('distDir: process.env.TYPREN_PREVIEW === "1"');
  });

  it("does not point Tailwind at the removed, unpublished editor package", () => {
    expect(nextSteps("src")).not.toContain("@typren/studio/dist");
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

  it("points at `typren migrate` for future @typren upgrades", () => {
    expect(nextSteps("src")).toContain("npx typren migrate");
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

describe("getSeoRegistryKeys", () => {
  const paths: ReviewPaths = {
    contentDir: "content",
    resourcesDir: "content/resources",
    seoFile: "app/seo.tsx",
    seoRegistryFile: "slices/seo-registry.ts",
  };

  it("returns null when the registry file doesn't exist", () => {
    expect(getSeoRegistryKeys(dir, paths)).toBeNull();
  });

  it("collects both sync and async entry keys, ignoring non-entry lines", () => {
    fs.mkdirSync(path.join(dir, "slices"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "slices/seo-registry.ts"),
      "export const seoRegistry = {\n" +
        "  faq: (slice) => ({}),\n" +
        "  testimonial: async (slice) => ({}),\n" +
        "  // comment: not an entry\n" +
        "};\n"
    );
    expect(getSeoRegistryKeys(dir, paths)).toEqual(["faq", "testimonial"]);
  });

  // The registry file is read straight from the repo being reviewed, so a
  // contributor-controlled file is untrusted input. This file is deliberately
  // pathological for a regex scan (many near-miss "key:" lines with long
  // whitespace runs and no closing paren) to guard against a parser that
  // reverts to catastrophic-backtracking-prone regex and goes quadratic.
  it("stays fast on a large file full of near-miss lines", () => {
    fs.mkdirSync(path.join(dir, "slices"), { recursive: true });
    const line = `key${" ".repeat(200)}:${" ".repeat(200)}async${" ".repeat(200)}x\n`;
    fs.writeFileSync(path.join(dir, "slices/seo-registry.ts"), line.repeat(20000));
    const start = Date.now();
    getSeoRegistryKeys(dir, paths);
    expect(Date.now() - start).toBeLessThan(1000);
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

  it("refuses javascript front-matter instead of eval()ing it", () => {
    fs.mkdirSync(path.join(dir, "content"), { recursive: true });
    // gray-matter's default `javascript` engine would eval() this block;
    // review runs on writer-supplied markdown, so it must throw, not execute.
    fs.writeFileSync(path.join(dir, "content/evil.md"), "---javascript\n({ slices: [] })\n---\nbody");
    expect(() => review(dir, { slug: "evil" })).toThrow(/javascript front-matter is not supported/);
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

  it("rejects a --base ref starting with \"-\" instead of handing it to git as an option", () => {
    fs.mkdirSync(path.join(dir, "content"), { recursive: true });
    const result = review(dir, { base: "--upload-pack=touch /tmp/pwned" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("not a valid --base ref");
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

    it("ignores an inherited GIT_DIR and diffs the repo at `dir`, not whatever GIT_DIR points at", () => {
      initGitRepo(dir);
      fs.mkdirSync(path.join(dir, "content"), { recursive: true });
      fs.writeFileSync(path.join(dir, "content/home.md"), "---\ntitle: Home\n---\n");
      commitAll(dir, "base");
      fs.writeFileSync(path.join(dir, "content/home.md"), "---\ntitle: Home Updated\n---\n");

      vi.stubEnv("GIT_DIR", path.join(os.tmpdir(), "typren-nonexistent-git-dir"));
      try {
        const result = review(dir, { base: "HEAD" });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.briefs.map((b) => b.file)).toEqual(["content/home.md"]);
      } finally {
        vi.unstubAllEnvs();
      }
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

    it("reports the dev-script rewrite, and warns when it can't bind the script itself", () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      fs.mkdirSync(path.join(dir, "app"), { recursive: true });
      process.chdir(dir);

      main(["init"]);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("-H 127.0.0.1"));

      fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts: { dev: "next dev" } }));
      main(["init"]);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('"dev" now runs `next dev -H 127.0.0.1`'));
    });

    it("does not record init when scaffold fails", () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      process.chdir(dir); // no src/app or app: scaffold() fails

      main(["init"]);

      expect(process.exitCode).toBe(1);
      expect(telemetry.record).not.toHaveBeenCalled();
    });
  });

  describe("studio", () => {
    it("fails with a message and records nothing when the site has no slice defaults", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      process.chdir(dir);

      await main(["studio"]);

      expect(process.exitCode).toBe(1);
      expect(error).toHaveBeenCalledWith(expect.stringContaining("typren init"));
      expect(spawn).not.toHaveBeenCalled();
      expect(telemetry.record).not.toHaveBeenCalled();
    });

    it("rejects bad flags before touching the site", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      await main(["studio", "--port", "nope"]);
      expect(process.exitCode).toBe(1);
      expect(error).toHaveBeenCalledWith(expect.stringContaining("--port"));
    });

    it("runs the studio for the site and passes its exit code through", async () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null)));
      // Inside the package: vitest won't import the site's defaults.ts from os.tmpdir().
      const site = fs.mkdtempSync(path.join(import.meta.dirname, "..", ".tmp-studio-"));
      try {
        fs.mkdirSync(path.join(site, "slices"));
        fs.writeFileSync(path.join(site, "slices", "defaults.ts"), "export const defaults = { hero: {} };\n");
        vi.mocked(spawn).mockClear();
        const child = Object.assign(new EventEmitter(), { kill: vi.fn() }) as unknown as ChildProcess;
        vi.mocked(spawn).mockReturnValueOnce(child);
        process.chdir(site);

        // --site-url: frame a running site, so the studio is the only child.
        const run = main(["studio", "--port", "4500", "--site-url", "http://127.0.0.1:3000"]);
        await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
        const [, args, options] = vi.mocked(spawn).mock.calls[0];
        expect(args).toEqual(expect.arrayContaining(["dev", "-H", "127.0.0.1", "-p", "4500"]));
        expect(JSON.parse((options as { env: Record<string, string> }).env.TYPREN_STUDIO)).toMatchObject({
          defaults: { hero: {} },
          siteUrl: "http://127.0.0.1:3000",
        });
        child.emit("exit", 3);
        await run;
        expect(process.exitCode).toBe(3);
        expect(telemetry.record).toHaveBeenCalledWith("studio");
      } finally {
        vi.unstubAllGlobals();
        process.chdir(originalCwd);
        fs.rmSync(site, { recursive: true, force: true });
      }
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

    describe("openOrUpdateContentPr (direct)", () => {
      /** Custom fake `gh` (withFakeGh only distinguishes on argv[0], but this
       *  path calls "pr list" then "pr create", two different "pr"
       *  subcommands that need different canned output). */
      function withFakeGhForPr(fn: () => void): void {
        const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "typren-fakegh-pr-"));
        fs.writeFileSync(
          path.join(binDir, "gh"),
          [
            "#!/bin/sh",
            'case "$1 $2" in',
            '  "--version ") exit 0 ;;',
            '  "pr list") echo "[]"; exit 0 ;;',
            '  "pr create") echo "https://github.com/example/repo/pull/1"; exit 0 ;;',
            '  "label list") echo "[]"; exit 0 ;;',
            '  "label create") exit 0 ;;',
            "  *) exit 1 ;;",
            "esac",
          ].join("\n"),
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

      it("opens the PR via plain git (checkout/add/commit/push) even with a poisoned GIT_DIR", () => {
        initGitRepo(dir);
        fs.mkdirSync(path.join(dir, "content"), { recursive: true });
        fs.writeFileSync(path.join(dir, "content/home.md"), "---\ntitle: Home\n---\n");
        commitAll(dir, "base");
        const origin = fs.mkdtempSync(path.join(os.tmpdir(), "typren-origin-"));
        execFileSync("git", ["init", "-q", "--bare", origin], { env: envWithoutGit() });
        execFileSync("git", ["remote", "add", "origin", origin], { cwd: dir, env: envWithoutGit() });
        fs.writeFileSync(path.join(dir, "content/home.md"), "---\ntitle: Home Updated\n---\n");

        const result = review(dir, { slug: "home", base: "HEAD" });
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        vi.stubEnv("GIT_DIR", path.join(os.tmpdir(), "typren-nonexistent-git-dir"));
        try {
          withFakeGhForPr(() => {
            const prResult = openOrUpdateContentPr(dir, result.briefs[0]);
            expect(prResult).toMatchObject({ ok: true, action: "created", url: "https://github.com/example/repo/pull/1" });
          });
        } finally {
          vi.unstubAllEnvs();
          fs.rmSync(origin, { recursive: true, force: true });
        }
      });

      it("widens the PR-body JSON fence past a backtick run already present in the diff", () => {
        initGitRepo(dir);
        fs.mkdirSync(path.join(dir, "content"), { recursive: true });
        fs.writeFileSync(path.join(dir, "content/home.md"), "---\ntitle: Home\n---\nplain body\n");
        commitAll(dir, "base");
        const origin = fs.mkdtempSync(path.join(os.tmpdir(), "typren-origin-"));
        execFileSync("git", ["init", "-q", "--bare", origin], { env: envWithoutGit() });
        execFileSync("git", ["remote", "add", "origin", origin], { cwd: dir, env: envWithoutGit() });
        // A writer's markdown containing its own fenced code block: the diff
        // of this change embeds a ``` run inside the JSON the PR body wraps.
        fs.writeFileSync(path.join(dir, "content/home.md"), "---\ntitle: Home\n---\n```js\nconsole.log(1)\n```\n");

        const result = review(dir, { slug: "home", base: "HEAD" });
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "typren-fakegh-fence-"));
        const capture = path.join(binDir, "captured-body.md");
        fs.writeFileSync(
          path.join(binDir, "gh"),
          [
            "#!/bin/sh",
            'case "$1 $2" in',
            '  "--version ") exit 0 ;;',
            '  "pr list") echo "[]"; exit 0 ;;',
            // Fixed argv shape from openOrUpdateContentPr: $6 is the --body-file path.
            `  "pr create") cp "$6" "${capture}"; echo "https://github.com/example/repo/pull/1"; exit 0 ;;`,
            '  "label list") echo "[]"; exit 0 ;;',
            '  "label create") exit 0 ;;',
            "  *) exit 1 ;;",
            "esac",
          ].join("\n"),
          { mode: 0o755 }
        );
        const originalPath = process.env.PATH;
        process.env.PATH = `${binDir}${path.delimiter}${originalPath ?? ""}`;
        try {
          const prResult = openOrUpdateContentPr(dir, result.briefs[0]);
          expect(prResult).toMatchObject({ ok: true, action: "created" });
          const body = fs.readFileSync(capture, "utf8");
          // The JSON itself still carries the diff's literal ``` run (escaped
          // newlines keep it on one line); the opening fence around that JSON
          // must be longer than any backtick run found anywhere in it, or a
          // fixed "```json" fence would be no longer than content it wraps.
          const openingFence = body.match(/^(`{3,})json$/m)?.[1];
          expect(openingFence).toBeDefined();
          expect(openingFence!.length).toBeGreaterThan(3);
        } finally {
          process.env.PATH = originalPath;
          fs.rmSync(binDir, { recursive: true, force: true });
          fs.rmSync(origin, { recursive: true, force: true });
        }
      });

      it("writes the PR body file under a private mkdtemp directory, not a predictable shared-tmp path", () => {
        initGitRepo(dir);
        fs.mkdirSync(path.join(dir, "content"), { recursive: true });
        fs.writeFileSync(path.join(dir, "content/home.md"), "---\ntitle: Home\n---\n");
        commitAll(dir, "base");
        const origin = fs.mkdtempSync(path.join(os.tmpdir(), "typren-origin-"));
        execFileSync("git", ["init", "-q", "--bare", origin], { env: envWithoutGit() });
        execFileSync("git", ["remote", "add", "origin", origin], { cwd: dir, env: envWithoutGit() });
        fs.writeFileSync(path.join(dir, "content/home.md"), "---\ntitle: Home Updated\n---\n");

        const result = review(dir, { slug: "home", base: "HEAD" });
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        // A fixed `typren-review-<slug>-<timestamp>.md` name directly under
        // os.tmpdir() is guessable, so another local process could pre-place
        // a symlink at that exact path before writeFileSync runs. Asserting
        // mkdtempSync is used proves the body file instead lands in a
        // freshly-random, unpredictable directory.
        const mkdtempSpy = vi.spyOn(fs, "mkdtempSync");
        try {
          withFakeGhForPr(() => {
            const prResult = openOrUpdateContentPr(dir, result.briefs[0]);
            expect(prResult).toMatchObject({ ok: true, action: "created" });
          });
          expect(mkdtempSpy).toHaveBeenCalledWith(expect.stringContaining("typren-review-"));
        } finally {
          fs.rmSync(origin, { recursive: true, force: true });
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

  describe("migrate", () => {
    function installFakeCore(projectDir: string): void {
      const coreDir = path.join(projectDir, "node_modules", "@typren", "core");
      fs.mkdirSync(path.join(coreDir, "migrations"), { recursive: true });
      fs.writeFileSync(path.join(coreDir, "package.json"), JSON.stringify({ name: "@typren/core", version: "0.5.0" }));
      fs.copyFileSync(
        path.join(import.meta.dirname, "..", "test-fixtures", "migrations", "core-0.5.0.md"),
        path.join(coreDir, "migrations", "core-0.5.0.md")
      );
    }

    it("exits non-zero and prints matches when the project still needs the fix", async () => {
      installFakeCore(dir);
      fs.writeFileSync(path.join(dir, "page.ts"), 'cmsStore.getPublished("home");');
      const log = vi.spyOn(console, "log").mockImplementation(() => {});

      await main(["migrate", "--cwd", dir, "--from", "0.4.0"]);

      expect(process.exitCode).toBe(1);
      expect(log).toHaveBeenCalledWith(expect.stringContaining("page.ts:1"));
      expect(telemetry.record).toHaveBeenCalledWith("migrate");
    });

    it("exits zero when no note applies or nothing matches", async () => {
      installFakeCore(dir);
      vi.spyOn(console, "log").mockImplementation(() => {});

      await main(["migrate", "--cwd", dir, "--from", "0.5.0"]);

      expect(process.exitCode).toBeUndefined();
    });

    it("prints the error and exits non-zero without a --from and no git history", async () => {
      installFakeCore(dir);
      const error = vi.spyOn(console, "error").mockImplementation(() => {});

      await main(["migrate", "--cwd", dir]);

      expect(process.exitCode).toBe(1);
      expect(error).toHaveBeenCalledWith(expect.stringContaining("--from"));
      expect(telemetry.record).not.toHaveBeenCalled();
    });

    it("prints JSON with --json", async () => {
      installFakeCore(dir);
      const log = vi.spyOn(console, "log").mockImplementation(() => {});

      await main(["migrate", "--cwd", dir, "--from", "0.4.0", "--json"]);

      const printed = log.mock.calls.map((c) => c[0]).find((line) => typeof line === "string" && line.startsWith("{"));
      expect(JSON.parse(printed as string)).toMatchObject({ from: "0.4.0", to: "0.5.0" });
    });

    it("exits non-zero when notes were dropped below the installed core's .min-version, even with no matches", async () => {
      installFakeCore(dir);
      fs.writeFileSync(path.join(dir, "node_modules", "@typren", "core", "migrations", ".min-version"), "0.4.0");
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(console, "log").mockImplementation(() => {});

      await main(["migrate", "--cwd", dir, "--from", "0.1.0"]);

      expect(process.exitCode).toBe(1);
      expect(error).toHaveBeenCalledWith(expect.stringContaining("0.4.0"));
    });
  });
});
