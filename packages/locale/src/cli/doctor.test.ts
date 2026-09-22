import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runDoctor } from "./doctor";

function withTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "typren-locale-cli-doctor-"));
}

describe("runDoctor", () => {
  let sourceDir: string;
  let configDir: string;
  let configPath: string;

  beforeEach(() => {
    sourceDir = withTmpDir();
    configDir = withTmpDir();
    configPath = join(configDir, "config.json");
  });

  afterEach(() => {
    rmSync(sourceDir, { recursive: true, force: true });
    rmSync(configDir, { recursive: true, force: true });
    delete process.env.TYPREN_LOCALE_CLI_DOCTOR_TEST_VAR;
  });

  it("fails config.shape and stops there when the file is missing", async () => {
    const result = await runDoctor(join(configDir, "missing.json"));
    expect(result.ok).toBe(false);
    expect(result.checks).toEqual([{ id: "config.shape", status: "fail", message: expect.stringContaining("not found") }]);
  });

  it("reports each ${VAR} as set/unset by name only, never its value, even when the reachability check runs clean", async () => {
    // The env var drives `app`, a plain label doctor never echoes back, so a
    // reachable/clean run proves the leak-check means something (nothing
    // downstream has a reason to mention the var's value either).
    writeFileSync(join(sourceDir, "en.json"), JSON.stringify({ Greeting: "Hi" }));
    writeFileSync(
      configPath,
      JSON.stringify({ app: "${TYPREN_LOCALE_CLI_DOCTOR_TEST_VAR}", source: { type: "files", dir: sourceDir } }),
    );
    process.env.TYPREN_LOCALE_CLI_DOCTOR_TEST_VAR = "super-secret-value";

    const result = await runDoctor(configPath);
    const envCheck = result.checks.find((c) => c.id.includes("TYPREN_LOCALE_CLI_DOCTOR_TEST_VAR"));
    expect(envCheck).toEqual({ id: "env.${TYPREN_LOCALE_CLI_DOCTOR_TEST_VAR}", status: "pass", message: "set" });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result.checks)).not.toContain("super-secret-value");
  });

  it("marks an unset env var as failing and skips the reachability check", async () => {
    writeFileSync(configPath, JSON.stringify({ app: "demo", source: { type: "files", dir: "${TYPREN_LOCALE_CLI_DOCTOR_TEST_VAR}" } }));

    const result = await runDoctor(configPath);
    expect(result.ok).toBe(false);
    expect(result.checks).toContainEqual({ id: "env.${TYPREN_LOCALE_CLI_DOCTOR_TEST_VAR}", status: "fail", message: "unset" });
    expect(result.checks).toContainEqual(expect.objectContaining({ id: "source.reachable", status: "skip" }));
  });

  it("dry-runs the publish gates against a reachable source and passes clean content", async () => {
    writeFileSync(join(sourceDir, "en.json"), JSON.stringify({ Greeting: "Hi" }));
    writeFileSync(configPath, JSON.stringify({ app: "demo", source: { type: "files", dir: sourceDir } }));

    const result = await runDoctor(configPath);
    expect(result.ok).toBe(true);
    expect(result.checks).toContainEqual({ id: "source.reachable", status: "pass", message: "1 locale(s)" });
    expect(result.checks).toContainEqual({ id: "gate.publish-checks", status: "pass" });
  });

  it("fails the no-html gate for dangerous content without writing anything to disk", async () => {
    writeFileSync(join(sourceDir, "en.json"), JSON.stringify({ Greeting: "<script>alert(1)</script>" }));
    writeFileSync(configPath, JSON.stringify({ app: "demo", source: { type: "files", dir: sourceDir } }));

    const result = await runDoctor(configPath);
    expect(result.ok).toBe(false);
    expect(result.checks.some((c) => c.id === "gate.no-html.en" && c.status === "fail")).toBe(true);
  });

  it("fails the dotted-key gate", async () => {
    writeFileSync(join(sourceDir, "en.json"), JSON.stringify({ "a.b": "oops" }));
    writeFileSync(configPath, JSON.stringify({ app: "demo", source: { type: "files", dir: sourceDir } }));

    const result = await runDoctor(configPath);
    expect(result.ok).toBe(false);
    expect(result.checks.some((c) => c.id === "gate.no-dotted-keys.en" && c.status === "fail")).toBe(true);
  });
});
