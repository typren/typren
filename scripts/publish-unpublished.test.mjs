// Run with `bun test scripts/publish-unpublished.test.mjs`. Standalone Bun test, same reason as
// tag-published.test.mjs: scripts/ sits outside vitest.config.ts's include.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { npmPublishArgs, publishUnpublished } from "./publish-unpublished.mjs";

let root;

function pkg(shortName, version, { dist = true } = {}) {
  const dir = path.join(root, shortName);
  mkdirSync(dir, { recursive: true });
  if (dist) mkdirSync(path.join(dir, "dist"));
  return { name: `@typren/${shortName}`, version, dir };
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "typren-publish-unpublished-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("publishUnpublished", () => {
  it("publishes only versions npm does not have", () => {
    const calls = [];
    const result = publishUnpublished([pkg("core", "1.0.0"), pkg("forms", "2.0.0")], {
      isOnNpm: (name) => name === "@typren/core",
      publish: (p) => calls.push(p.name),
    });
    expect(calls).toEqual(["@typren/forms"]);
    expect(result).toEqual({ published: ["@typren/forms@2.0.0"], skipped: ["@typren/core@1.0.0"], failed: [] });
  });

  it("publishes nothing when every version is already on npm", () => {
    const calls = [];
    const result = publishUnpublished([pkg("core", "1.0.0")], { isOnNpm: () => true, publish: (p) => calls.push(p) });
    expect(calls).toEqual([]);
    expect(result.failed).toEqual([]);
  });

  it("keeps going after a failure and reports it", () => {
    const calls = [];
    const result = publishUnpublished([pkg("core", "1.0.0"), pkg("forms", "2.0.0")], {
      isOnNpm: () => false,
      publish: (p) => {
        calls.push(p.name);
        if (p.name === "@typren/core") throw new Error("E403");
      },
    });
    expect(calls).toEqual(["@typren/core", "@typren/forms"]);
    expect(result.failed).toEqual(["@typren/core@1.0.0"]);
    expect(result.published).toEqual(["@typren/forms@2.0.0"]);
  });

  it("refuses to publish a package without dist/", () => {
    const calls = [];
    const result = publishUnpublished([pkg("core", "1.0.0", { dist: false })], {
      isOnNpm: () => false,
      publish: (p) => calls.push(p),
    });
    expect(calls).toEqual([]);
    expect(result.failed).toEqual(["@typren/core@1.0.0"]);
  });
});

describe("npmPublishArgs", () => {
  it("publishes a stable version with no tag override", () => {
    expect(npmPublishArgs("1.0.0")).toEqual(["publish", "--access", "public"]);
  });

  it("tags a prerelease version with its first prerelease identifier", () => {
    expect(npmPublishArgs("1.0.0-beta.1")).toEqual(["publish", "--access", "public", "--tag", "beta"]);
    expect(npmPublishArgs("2.3.0-rc.0")).toEqual(["publish", "--access", "public", "--tag", "rc"]);
  });

  it("tags a single-identifier prerelease with the whole identifier", () => {
    expect(npmPublishArgs("1.0.0-next")).toEqual(["publish", "--access", "public", "--tag", "next"]);
  });
});
