import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { envWithoutGit, fromVersionFromGit, migrate, parseMigrateArgs, printMigrateReport } from "./migrate";

const FIXTURE_NOTE = fs.readFileSync(path.join(import.meta.dirname, "..", "test-fixtures", "migrations", "core-0.5.0.md"), "utf8");

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "typren-migrate-"));
});

afterEach(() => {
  process.exitCode = undefined;
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** A fake installed `@typren/core` under `dir/node_modules`, resolvable the
 *  same way `migrate()` resolves a real one: via `require.resolve` from the
 *  project. `version` is what the project has installed; `notes` are the
 *  migration-note filenames (under the package's own `migrations/`) to seed. */
function installFakeCore(projectDir: string, version: string, notes: string[] = ["core-0.5.0.md"]): void {
  const coreDir = path.join(projectDir, "node_modules", "@typren", "core");
  fs.mkdirSync(path.join(coreDir, "migrations"), { recursive: true });
  fs.writeFileSync(path.join(coreDir, "package.json"), JSON.stringify({ name: "@typren/core", version }));
  for (const note of notes) fs.writeFileSync(path.join(coreDir, "migrations", note), FIXTURE_NOTE);
}

function writeProjectPackageJson(projectDir: string, coreRange: string): void {
  fs.writeFileSync(path.join(projectDir, "package.json"), JSON.stringify({ dependencies: { "@typren/core": coreRange } }));
}

describe("parseMigrateArgs", () => {
  it("reads every flag regardless of order", () => {
    expect(parseMigrateArgs(["migrate", "--from", "0.4.0", "--to", "0.5.0", "--json", "--remote", "--cwd", "/tmp/site"])).toEqual({
      from: "0.4.0",
      to: "0.5.0",
      cwd: "/tmp/site",
      json: true,
      remote: true,
    });
  });

  it("defaults the flags that are omitted", () => {
    expect(parseMigrateArgs(["migrate"])).toEqual({ from: undefined, to: undefined, cwd: undefined, json: false, remote: false });
  });
});

describe("fromVersionFromGit", () => {
  function initGitRepo(repoDir: string): void {
    const git = (args: string[]) => execFileSync("git", args, { cwd: repoDir, stdio: "ignore", env: envWithoutGit() });
    git(["init", "-q"]);
    git(["config", "user.email", "test@example.com"]);
    git(["config", "user.name", "Test"]);
  }

  it("strips the range prefix off the committed @typren/core dependency", () => {
    initGitRepo(dir);
    writeProjectPackageJson(dir, "^0.4.0");
    execFileSync("git", ["add", "-A"], { cwd: dir, stdio: "ignore", env: envWithoutGit() });
    execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir, stdio: "ignore", env: envWithoutGit() });
    expect(fromVersionFromGit(dir)).toBe("0.4.0");
  });

  it("ignores an inherited GIT_DIR (as set inside git hooks) and reads the repo at cwd", () => {
    initGitRepo(dir);
    writeProjectPackageJson(dir, "^0.4.0");
    execFileSync("git", ["add", "-A"], { cwd: dir, stdio: "ignore", env: envWithoutGit() });
    execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir, stdio: "ignore", env: envWithoutGit() });
    vi.stubEnv("GIT_DIR", path.join(os.tmpdir(), "typren-nonexistent-git-dir"));
    try {
      expect(fromVersionFromGit(dir)).toBe("0.4.0");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("returns null with no git history", () => {
    expect(fromVersionFromGit(dir)).toBeNull();
  });
});

describe("migrate: @typren/core not installed", () => {
  it("throws a clear error instead of crashing when no node_modules/@typren/core exists above cwd", async () => {
    await expect(migrate({ cwd: dir, from: "0.4.0" })).rejects.toThrow(/cannot find @typren\/core installed/);
  });
});

describe("migrate: version range selection", () => {
  it("selects a note strictly after `from` and up to (inclusive) `to`", async () => {
    installFakeCore(dir, "0.5.0");
    const result = await migrate({ cwd: dir, from: "0.4.0" });
    expect(result.from).toBe("0.4.0");
    expect(result.to).toBe("0.5.0");
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toMatchObject({ package: "@typren/core", version: "0.5.0", source: "bundled" });
  });

  it("excludes a note at or below `from`", async () => {
    installFakeCore(dir, "0.5.0");
    const result = await migrate({ cwd: dir, from: "0.5.0" });
    expect(result.notes).toHaveLength(0);
  });

  it("excludes a note above `to`", async () => {
    installFakeCore(dir, "0.5.0");
    const result = await migrate({ cwd: dir, from: "0.4.0", to: "0.4.5" });
    expect(result.notes).toHaveLength(0);
  });

  it("requires --from when git can't supply one", async () => {
    installFakeCore(dir, "0.5.0");
    await expect(migrate({ cwd: dir })).rejects.toThrow(/--from/);
  });

  // Regression for a crash seen with every published @typren/core: its
  // `exports` map never listed `./package.json`, so resolving the installed
  // core's package.json via `require.resolve(..., { paths: [cwd] })` threw
  // ERR_PACKAGE_PATH_NOT_EXPORTED even though the file is right there on
  // disk. migrate() must read it directly off the filesystem instead.
  it("resolves the installed core's package.json even when its exports map doesn't list it", async () => {
    const coreDir = path.join(dir, "node_modules", "@typren", "core");
    fs.mkdirSync(path.join(coreDir, "migrations"), { recursive: true });
    fs.writeFileSync(
      path.join(coreDir, "package.json"),
      JSON.stringify({ name: "@typren/core", version: "0.5.0", exports: { ".": "./dist/index.js" } })
    );
    fs.writeFileSync(path.join(coreDir, "migrations", "core-0.5.0.md"), FIXTURE_NOTE);
    const result = await migrate({ cwd: dir, from: "0.4.0" });
    expect(result.to).toBe("0.5.0");
    expect(result.notes).toHaveLength(1);
  });

  it("falls back to the @typren/core range committed at HEAD", async () => {
    const git = (args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore", env: envWithoutGit() });
    git(["init", "-q"]);
    git(["config", "user.email", "test@example.com"]);
    git(["config", "user.name", "Test"]);
    writeProjectPackageJson(dir, "^0.4.0");
    git(["add", "-A"]);
    git(["commit", "-q", "-m", "init"]);
    installFakeCore(dir, "0.5.0");

    const result = await migrate({ cwd: dir });
    expect(result.from).toBe("0.4.0");
  });
});

describe("migrate: detect matches", () => {
  it("reports file:line matches for the note's detect pattern", async () => {
    installFakeCore(dir, "0.5.0");
    fs.mkdirSync(path.join(dir, "app"), { recursive: true });
    fs.writeFileSync(path.join(dir, "app", "page.ts"), 'const x = cmsStore.getPublished("home");\nconst y = 1;\n');

    const result = await migrate({ cwd: dir, from: "0.4.0" });
    expect(result.notes[0].matches).toEqual([
      { file: "app/page.ts", line: 1, hint: "ContentStore reads now return Promises; add await." },
    ]);
  });

  it("ignores node_modules, .next, dist, out, coverage, build, .turbo, .vercel, .svelte-kit and .output", async () => {
    installFakeCore(dir, "0.5.0");
    for (const ignored of [
      "node_modules/some-lib",
      ".next/cache",
      "dist",
      "out",
      "coverage",
      "build",
      ".turbo",
      ".vercel",
      ".svelte-kit",
      ".output",
    ]) {
      fs.mkdirSync(path.join(dir, ignored), { recursive: true });
      fs.writeFileSync(path.join(dir, ignored, "evil.ts"), "cmsStore.getPublished(\"x\");");
    }

    const result = await migrate({ cwd: dir, from: "0.4.0" });
    expect(result.notes[0].matches).toHaveLength(0);
  });

  it("doesn't follow a symlink into or out of the scanned tree", async () => {
    installFakeCore(dir, "0.5.0");
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "typren-migrate-outside-"));
    fs.writeFileSync(path.join(outside, "secret.ts"), 'cmsStore.getPublished("x");');
    try {
      fs.symlinkSync(outside, path.join(dir, "link-to-outside"));
      fs.writeFileSync(path.join(dir, "real.ts"), "const y = 1;");
      fs.symlinkSync(path.join(dir, "real.ts"), path.join(dir, "link-to-real.ts"));

      const result = await migrate({ cwd: dir, from: "0.4.0" });
      expect(result.notes[0].matches).toEqual([]);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("skips a file over the 1 MB scan cap instead of reading it", async () => {
    installFakeCore(dir, "0.5.0");
    fs.writeFileSync(path.join(dir, "huge.ts"), 'cmsStore.getPublished("x");' + " ".repeat(1_000_001));

    const result = await migrate({ cwd: dir, from: "0.4.0" });
    expect(result.notes[0].matches).toEqual([]);
  });

  it("reads each file once even when multiple detect patterns/notes apply to it", async () => {
    installFakeCore(dir, "0.5.0", []);
    fs.writeFileSync(
      path.join(dir, "node_modules", "@typren", "core", "migrations", "core-0.5.0.md"),
      `---\npackage: "@typren/core"\nversion: "0.5.0"\ntitle: "two patterns"\ndetect:\n` +
        `  - pattern: "cmsStore"\n    glob: "**/*.ts"\n    hint: "a"\n` +
        `  - pattern: "getPublished"\n    glob: "**/*.ts"\n    hint: "b"\n---\nbody\n`
    );
    fs.writeFileSync(path.join(dir, "page.ts"), 'cmsStore.getPublished("x");');
    const readSpy = vi.spyOn(fs, "readFileSync");

    const result = await migrate({ cwd: dir, from: "0.4.0" });

    expect(result.notes[0].matches).toHaveLength(2);
    const pageReads = readSpy.mock.calls.filter((c) => String(c[0]).endsWith("page.ts"));
    expect(pageReads).toHaveLength(1);
  });

  it("reports a clean note (no matches) as an empty array, not an omitted note", async () => {
    installFakeCore(dir, "0.5.0");
    const result = await migrate({ cwd: dir, from: "0.4.0" });
    expect(result.notes[0].matches).toEqual([]);
  });
});

describe("migrate: json shape", () => {
  it("matches the documented contract", async () => {
    installFakeCore(dir, "0.5.0");
    fs.writeFileSync(path.join(dir, "page.ts"), "store.getDraft(\"x\");");

    const result = await migrate({ cwd: dir, from: "0.4.0" });
    expect(result).toEqual({
      from: "0.4.0",
      to: "0.5.0",
      notes: [
        {
          package: "@typren/core",
          version: "0.5.0",
          title: "ContentAdapter and ContentStore are async",
          matches: [{ file: "page.ts", line: 1, hint: "ContentStore reads now return Promises; add await." }],
          body: expect.stringContaining("## Fix"),
          source: "bundled",
        },
      ],
    });
  });
});

describe("migrate: dropped-notes warning (postbuild's keep-5 .min-version)", () => {
  it("warns and signals when `from` predates the oldest packed note", async () => {
    installFakeCore(dir, "0.5.0");
    fs.writeFileSync(path.join(dir, "node_modules", "@typren", "core", "migrations", ".min-version"), "0.4.0");

    const result = await migrate({ cwd: dir, from: "0.2.0" });
    expect(result.droppedNotesWarning).toMatch(/0\.4\.0/);
    expect(result.droppedNotesWarning).toMatch(/0\.2\.0/);
  });

  it("stays silent when `from` is at or after the oldest packed note", async () => {
    installFakeCore(dir, "0.5.0");
    fs.writeFileSync(path.join(dir, "node_modules", "@typren", "core", "migrations", ".min-version"), "0.4.0");

    const result = await migrate({ cwd: dir, from: "0.4.0" });
    expect(result.droppedNotesWarning).toBeUndefined();
  });

  it("stays silent with no .min-version file (e.g. an older @typren/core install)", async () => {
    installFakeCore(dir, "0.5.0");
    const result = await migrate({ cwd: dir, from: "0.1.0" });
    expect(result.droppedNotesWarning).toBeUndefined();
  });
});

describe("migrate: --remote", () => {
  const REMOTE_INDEX = "https://typren.com/migrations/index.json";
  const REMOTE_NOTE = "https://typren.com/migrations/core-0.6.0.md";

  function fakeResponse(body: string, ok = true): Response {
    return { ok, status: ok ? 200 : 500, statusText: ok ? "OK" : "Error", text: async () => body } as Response;
  }

  it("rejects an index entry whose url isn't under the hardcoded origin", async () => {
    installFakeCore(dir, "0.5.0");
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === REMOTE_INDEX) {
        return fakeResponse(JSON.stringify([{ package: "@typren/core", version: "0.6.0", url: "https://evil.example/pwn.md" }]));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await migrate({ cwd: dir, from: "0.4.0", to: "0.6.0", remote: true, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.notes.some((n) => n.source === "remote")).toBe(false);
  });

  it("labels a validated remote note as unverified and fetches only typren.com urls", async () => {
    installFakeCore(dir, "0.5.0");
    const remoteBody = FIXTURE_NOTE.replace('version: "0.5.0"', 'version: "0.6.0"');
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === REMOTE_INDEX) return fakeResponse(JSON.stringify([{ package: "@typren/core", version: "0.6.0", url: REMOTE_NOTE }]));
      if (url === REMOTE_NOTE) return fakeResponse(remoteBody);
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await migrate({ cwd: dir, from: "0.4.0", to: "0.6.0", remote: true, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).toHaveBeenCalledWith(REMOTE_INDEX, expect.objectContaining({ redirect: "error" }));
    expect(fetchImpl).toHaveBeenCalledWith(REMOTE_NOTE, expect.objectContaining({ redirect: "error" }));
    const remoteNote = result.notes.find((n) => n.source === "remote");
    // Display-only: an untrusted note's detect regexes are never run.
    expect(remoteNote).toMatchObject({ version: "0.6.0", source: "remote", matches: [] });
  });

  it("falls back to bundled notes, not an error, when the remote fetch fails", async () => {
    installFakeCore(dir, "0.5.0");
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });

    const result = await migrate({ cwd: dir, from: "0.4.0", remote: true, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0].source).toBe("bundled");
  });

  it("drops a remote note with an invalid package name or non-semver version, with a warning, not a throw", async () => {
    installFakeCore(dir, "0.5.0");
    const badPackage = FIXTURE_NOTE.replace('package: "@typren/core"', 'package: "../../evil"').replace(
      'version: "0.5.0"',
      'version: "0.6.0"'
    );
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === REMOTE_INDEX) return fakeResponse(JSON.stringify([{ package: "@typren/core", version: "0.6.0", url: REMOTE_NOTE }]));
      if (url === REMOTE_NOTE) return fakeResponse(badPackage);
      throw new Error(`unexpected fetch: ${url}`);
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await migrate({ cwd: dir, from: "0.4.0", to: "0.6.0", remote: true, fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result.notes.some((n) => n.source === "remote")).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("invalid package/version"));
  });

  // `isValidSemver` used to be a prefix match (`/^\d+\.\d+\.\d+/`), so a
  // version like "0.6.0<escape sequence>" passed validation and the escape
  // sequence rode along into the version string printed to the terminal.
  it("rejects a remote note whose version is a semver prefix followed by control characters", async () => {
    installFakeCore(dir, "0.5.0");
    const withEscapeSuffix = FIXTURE_NOTE.replace('version: "0.5.0"', 'version: "0.6.0\\x1b[31m"');
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === REMOTE_INDEX) return fakeResponse(JSON.stringify([{ package: "@typren/core", version: "0.6.0", url: REMOTE_NOTE }]));
      if (url === REMOTE_NOTE) return fakeResponse(withEscapeSuffix);
      throw new Error(`unexpected fetch: ${url}`);
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await migrate({ cwd: dir, from: "0.4.0", to: "0.6.0", remote: true, fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result.notes.some((n) => n.source === "remote")).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("invalid package/version"));
  });

  // The index entry's url is untrusted and gets printed verbatim when it's
  // rejected; it must not be able to carry an escape sequence into that
  // warning.
  it("strips control characters from an untrusted index url before printing it", async () => {
    installFakeCore(dir, "0.5.0");
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === REMOTE_INDEX) {
        return fakeResponse(
          JSON.stringify([{ package: "@typren/core", version: "0.6.0", url: "https://evil.example/\u001b[31mpwn.md" }])
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await migrate({ cwd: dir, from: "0.4.0", to: "0.6.0", remote: true, fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("untrusted url"));
    for (const call of warn.mock.calls) {
      // eslint-disable-next-line no-control-regex -- asserting these control characters are gone
      expect(call[0]).not.toMatch(/\u001b/);
    }
  });

  it("strips control characters from a remote note's title/body before they're printed", async () => {
    installFakeCore(dir, "0.5.0");
    const withControlChars = FIXTURE_NOTE.replace('version: "0.5.0"', 'version: "0.6.0"').replace(
      "## What changed",
      "## What changed\u0007\u001b[31m"
    );
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === REMOTE_INDEX) return fakeResponse(JSON.stringify([{ package: "@typren/core", version: "0.6.0", url: REMOTE_NOTE }]));
      if (url === REMOTE_NOTE) return fakeResponse(withControlChars);
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await migrate({ cwd: dir, from: "0.4.0", to: "0.6.0", remote: true, fetchImpl: fetchImpl as unknown as typeof fetch });

    const remoteNote = result.notes.find((n) => n.source === "remote");
    // eslint-disable-next-line no-control-regex -- asserting these control characters are gone
    expect(remoteNote?.body).not.toMatch(/[\u0007\u001b]/);
    expect(remoteNote?.body).toContain("## What changed");
  });

  it("aborts past the 1 MB cap while streaming, without buffering the whole response first", async () => {
    installFakeCore(dir, "0.5.0");
    const oversized = "x".repeat(1_000_001);
    function streamingResponse(body: string): Response {
      const bytes = new TextEncoder().encode(body);
      let offset = 0;
      const CHUNK = 65_536;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (offset >= bytes.length) {
            controller.close();
            return;
          }
          const next = bytes.subarray(offset, offset + CHUNK);
          offset += CHUNK;
          controller.enqueue(next);
        },
      });
      return { ok: true, status: 200, statusText: "OK", body: stream } as unknown as Response;
    }
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === REMOTE_INDEX) return fakeResponse(JSON.stringify([{ package: "@typren/core", version: "0.6.0", url: REMOTE_NOTE }]));
      if (url === REMOTE_NOTE) return streamingResponse(oversized);
      throw new Error(`unexpected fetch: ${url}`);
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await migrate({ cwd: dir, from: "0.4.0", to: "0.6.0", remote: true, fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result.notes.some((n) => n.source === "remote")).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("1 MB cap"));
  });
});

describe("migrate: malformed input", () => {
  it("fromVersionFromGit returns null for unparseable committed package.json", () => {
    const git = (args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore", env: envWithoutGit() });
    git(["init", "-q"]);
    git(["config", "user.email", "test@example.com"]);
    git(["config", "user.name", "Test"]);
    fs.writeFileSync(path.join(dir, "package.json"), "not json");
    git(["add", "-A"]);
    git(["commit", "-q", "-m", "init"]);
    expect(fromVersionFromGit(dir)).toBeNull();
  });

  it("skips an unusable detect pattern (bad regex source) with a warning, not a crash", async () => {
    installFakeCore(dir, "0.5.0", []);
    fs.writeFileSync(
      path.join(dir, "node_modules", "@typren", "core", "migrations", "core-0.5.0.md"),
      `---\npackage: "@typren/core"\nversion: "0.5.0"\ntitle: "bad pattern"\ndetect:\n  - pattern: "(unterminated"\n    glob: "**/*.ts"\n    hint: "n/a"\n---\nbody\n`
    );
    fs.writeFileSync(path.join(dir, "page.ts"), "anything");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await migrate({ cwd: dir, from: "0.4.0" });

    expect(result.notes[0].matches).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("skipping unusable detect pattern"));
  });

  it("matches `**` with no trailing slash and `?` as a single-char glob wildcard", async () => {
    installFakeCore(dir, "0.5.0", []);
    fs.writeFileSync(
      path.join(dir, "node_modules", "@typren", "core", "migrations", "core-0.5.0.md"),
      `---\npackage: "@typren/core"\nversion: "0.5.0"\ntitle: "glob edges"\ndetect:\n  - pattern: "x"\n    glob: "**.ts"\n    hint: "double-star, no slash"\n  - pattern: "x"\n    glob: "pag?.ts"\n    hint: "question mark"\n---\nbody\n`
    );
    fs.writeFileSync(path.join(dir, "a.ts"), "x");
    fs.writeFileSync(path.join(dir, "page.ts"), "no match here");
    fs.writeFileSync(path.join(dir, "pag1.ts"), "x");

    const result = await migrate({ cwd: dir, from: "0.4.0" });

    const files = result.notes[0].matches.map((m) => m.file).sort();
    expect(files).toEqual(["a.ts", "pag1.ts", "pag1.ts"]);
  });
});

describe("printMigrateReport", () => {
  it("prints JSON and nothing else when --json", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    printMigrateReport({ from: "0.4.0", to: "0.5.0", notes: [] }, { json: true });
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls[0][0] as string)).toEqual({ from: "0.4.0", to: "0.5.0", notes: [] });
  });

  it("says no notes apply when the selected range is empty", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    printMigrateReport({ from: "0.5.0", to: "0.5.0", notes: [] });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("no notes apply"));
  });

  it("reports a clean note, flags a diverging remote note, and headers the remote section", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    printMigrateReport({
      from: "0.4.0",
      to: "0.6.0",
      notes: [
        { package: "@typren/core", version: "0.5.0", title: "clean one", matches: [], body: "body", source: "bundled" },
        {
          package: "@typren/core",
          version: "0.6.0",
          title: "remote one",
          matches: [],
          body: "remote body",
          source: "remote",
          divergesFromBundled: true,
        },
      ],
    });
    const lines = log.mock.calls.map((c) => c[0]).join("\n");
    expect(lines).toContain("no matches found.");
    expect(lines).toContain("differs from the bundled note");
    expect(lines).toContain("REMOTE (unverified, not lockfile-pinned)");
    expect(lines).toContain("no matches. Run each note's Verify step");
  });
});
