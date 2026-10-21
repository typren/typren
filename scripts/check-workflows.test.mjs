import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

// An empty PATH makes `actionlint` unresolvable, whatever the host has installed.
const run = (env) =>
  spawnSync(process.execPath, ["scripts/check-workflows.mjs"], {
    env: { PATH: "", ...env },
    encoding: "utf8",
  });

test("missing actionlint warns and passes locally", () => {
  const r = run({});
  expect(r.status).toBe(0);
  expect(r.stderr).toContain("brew install actionlint");
});

test("missing actionlint fails in CI", () => {
  const r = run({ CI: "true" });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("actionlint not installed");
});
