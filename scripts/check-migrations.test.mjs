// Run with `bun test scripts/check-migrations.test.mjs`. Standalone Bun test
// (not part of the vitest suite: scripts/ sits outside vitest.config.ts's
// `packages/*/src` include, and this gate has no package of its own to live
// under). Every fixture is a throwaway tmp dir: no real git, no real
// .changeset, so it can't touch or be confused by this repo's own state.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkMigrations } from "./check-migrations.mjs";

let repoRoot;

function writePackage(shortName, name, version) {
  const dir = path.join(repoRoot, "packages", shortName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, version }));
}

function writeChangeset(file, frontmatter, body) {
  mkdirSync(path.join(repoRoot, ".changeset"), { recursive: true });
  writeFileSync(path.join(repoRoot, ".changeset", file), `---\n${frontmatter}\n---\n${body}\n`);
}

function writeMigrationNote(filename) {
  mkdirSync(path.join(repoRoot, "docs", "migrations"), { recursive: true });
  writeFileSync(path.join(repoRoot, "docs", "migrations", filename), "---\ntitle: x\n---\nbody\n");
}

beforeEach(() => {
  repoRoot = mkdtempSync(path.join(os.tmpdir(), "typren-check-migrations-"));
  mkdirSync(path.join(repoRoot, "packages"), { recursive: true });
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

describe("checkMigrations", () => {
  it("passes with no changesets", () => {
    const result = checkMigrations(repoRoot);
    expect(result).toEqual({ ok: true, missing: [], unpacked: [], changesetsChecked: 0 });
  });

  it("ignores a non-breaking changeset even with no note", () => {
    writePackage("core", "@typren/core", "0.5.0");
    writeChangeset("a.md", '"@typren/core": minor', "just a feature, not breaking");
    const result = checkMigrations(repoRoot);
    expect(result.ok).toBe(true);
  });

  it("fails a breaking changeset with no matching note", () => {
    writePackage("core", "@typren/core", "0.5.0");
    writeChangeset("a.md", '"@typren/core": minor', "BREAKING: dropped sync reads");
    const result = checkMigrations(repoRoot);
    expect(result.ok).toBe(false);
    expect(result.missing[0]).toContain("core-0.6.0.md");
  });

  it("passes once the note for the exact next version exists", () => {
    writePackage("core", "@typren/core", "0.5.0");
    writeChangeset("a.md", '"@typren/core": minor', "BREAKING: dropped sync reads");
    writeMigrationNote("core-0.6.0.md");
    const result = checkMigrations(repoRoot);
    expect(result.ok).toBe(true);
  });

  it("requires the EXACT next version, not just any later note", () => {
    writePackage("core", "@typren/core", "0.5.0");
    writeChangeset("a.md", '"@typren/core": minor', "BREAKING: dropped sync reads");
    writeMigrationNote("core-0.7.0.md"); // later, but not what this bump produces
    const result = checkMigrations(repoRoot);
    expect(result.ok).toBe(false);
  });

  it("pre-1.0: a major-bump changeset still only needs the minor-bump note (repo convention)", () => {
    writePackage("core", "@typren/core", "0.5.0");
    writeChangeset("a.md", '"@typren/core": major', "BREAKING: dropped sync reads");
    writeMigrationNote("core-0.6.0.md");
    const result = checkMigrations(repoRoot);
    expect(result.ok).toBe(true);
  });

  it("accepts single-quoted and unquoted package keys", () => {
    writePackage("core", "@typren/core", "0.5.0");
    writeChangeset("a.md", "'@typren/core': minor", "BREAKING: x");
    writeChangeset("b.md", "@typren/cli: patch", "BREAKING: y");
    writePackage("cli", "@typren/cli", "1.0.0");
    writeMigrationNote("core-0.6.0.md");
    const result = checkMigrations(repoRoot);
    // cli isn't a packed package, so its missing note is reported separately
    // (unpacked), never as a hard failure.
    expect(result.ok).toBe(true);
    expect(result.unpacked[0]).toContain("@typren/cli");
  });

  it("normalizes CRLF line endings before matching frontmatter/body", () => {
    writePackage("core", "@typren/core", "0.5.0");
    mkdirSync(path.join(repoRoot, ".changeset"), { recursive: true });
    writeFileSync(path.join(repoRoot, ".changeset", "a.md"), '---\r\n"@typren/core": minor\r\n---\r\nBREAKING: x\r\n');
    const result = checkMigrations(repoRoot);
    expect(result.ok).toBe(false);
    expect(result.missing).toHaveLength(1);
  });

  it("detects a breaking marker on any body line, not just the first", () => {
    writePackage("core", "@typren/core", "0.5.0");
    writeChangeset("a.md", '"@typren/core": minor', "Some intro text.\n\n**BREAKING**: dropped sync reads\n");
    const result = checkMigrations(repoRoot);
    expect(result.ok).toBe(false);
  });

  it("skips an unknown/removed package rather than crashing", () => {
    writeChangeset("a.md", '"@typren/ghost": minor', "BREAKING: x");
    const result = checkMigrations(repoRoot);
    expect(result.ok).toBe(true);
  });
});
