// Run with `bun test scripts/tag-published.test.mjs`. Standalone Bun test,
// same reason as check-migrations.test.mjs: scripts/ sits outside
// vitest.config.ts's include, and this gate has no package of its own to
// live under.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadPublishablePackages, tagsToCreate } from "./tag-published.mjs";

let repoRoot;

function writePackage(shortName, name, version, { private: isPrivate = false } = {}) {
  const dir = path.join(repoRoot, "packages", shortName);
  mkdirSync(dir, { recursive: true });
  const pkg = { name, version };
  if (isPrivate) pkg.private = true;
  writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg));
}

beforeEach(() => {
  repoRoot = mkdtempSync(path.join(os.tmpdir(), "typren-tag-published-"));
  mkdirSync(path.join(repoRoot, "packages"), { recursive: true });
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

describe("loadPublishablePackages", () => {
  it("skips private packages", () => {
    writePackage("core", "@typren/core", "1.2.3");
    writePackage("editor", "@typren/editor", "0.1.0", { private: true });
    expect(loadPublishablePackages(repoRoot)).toEqual([{ name: "@typren/core", version: "1.2.3" }]);
  });

  it("returns empty for no packages", () => {
    expect(loadPublishablePackages(repoRoot)).toEqual([]);
  });
});

describe("tagsToCreate", () => {
  it("tags a package that npm has but no local tag exists for", () => {
    const tags = tagsToCreate([{ name: "@typren/core", version: "1.2.3" }], {
      isOnNpm: () => true,
      tagExists: () => false,
    });
    expect(tags).toEqual(["@typren/core@1.2.3"]);
  });

  it("skips a package npm does not have yet (publish failed for it)", () => {
    const tags = tagsToCreate([{ name: "@typren/core", version: "1.2.3" }], {
      isOnNpm: () => false,
      tagExists: () => false,
    });
    expect(tags).toEqual([]);
  });

  it("is idempotent: skips a tag that already exists", () => {
    const tags = tagsToCreate([{ name: "@typren/core", version: "1.2.3" }], {
      isOnNpm: () => true,
      tagExists: () => true,
    });
    expect(tags).toEqual([]);
  });

  it("handles a mixed batch independently per package", () => {
    const packages = [
      { name: "@typren/core", version: "1.0.0" }, // already tagged
      { name: "@typren/forms", version: "2.0.0" }, // newly on npm, needs a tag
      { name: "@typren/locale", version: "3.0.0" }, // publish failed, not on npm yet
    ];
    const tags = tagsToCreate(packages, {
      isOnNpm: (name) => name !== "@typren/locale",
      tagExists: (tag) => tag === "@typren/core@1.0.0",
    });
    expect(tags).toEqual(["@typren/forms@2.0.0"]);
  });
});
