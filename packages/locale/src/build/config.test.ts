import { describe, expect, it } from "vitest";
import { collectEnvVarNames, resolveConfigEnv } from "./config";
import type { BuildConfig } from "./config";

describe("resolveConfigEnv", () => {
  it("interpolates present vars across nested objects/arrays", () => {
    const config = {
      app: "demo-app",
      source: { type: "files", dir: "${LOCALE_SOURCE_DIR}" },
      tags: ["${TAG_A}", "static"],
    };
    const env = { LOCALE_SOURCE_DIR: "/srv/locales", TAG_A: "a" };

    expect(resolveConfigEnv(config, env)).toEqual({
      app: "demo-app",
      source: { type: "files", dir: "/srv/locales" },
      tags: ["a", "static"],
    });
  });

  it("throws naming the missing var and the dot-path it was referenced at", () => {
    const config = { source: { dir: "${LOCALE_SOURCE_DIR}" } };
    expect(() => resolveConfigEnv(config, {})).toThrow(/missing required env var "LOCALE_SOURCE_DIR" \(referenced at source\.dir\)/);
  });

  it("never sends an empty string for a missing var", () => {
    expect(() => resolveConfigEnv({ token: "${MISSING}" }, {})).toThrow();
  });

  it("resolves a full BuildConfig ({ app, source }) shape", () => {
    const config: BuildConfig = { app: "demo-app", source: { type: "files", dir: "${DIR}" } };
    expect(resolveConfigEnv(config, { DIR: "/tmp/locales" }).source).toEqual({ type: "files", dir: "/tmp/locales" });
  });
});

describe("collectEnvVarNames", () => {
  it("gathers every distinct ${VAR} referenced anywhere", () => {
    const config = { a: "${ONE}", b: { c: "${TWO}", d: "${ONE}" }, e: ["${THREE}"] };
    expect(collectEnvVarNames(config).sort()).toEqual(["ONE", "THREE", "TWO"]);
  });

  it("returns an empty list when nothing is referenced", () => {
    expect(collectEnvVarNames({ a: "plain", b: 1 })).toEqual([]);
  });
});
