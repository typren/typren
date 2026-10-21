#!/usr/bin/env node
/**
 * Lints .github/workflows with actionlint, the check that catches invalid
 * workflow YAML (an unquoted `Canary: x` plain scalar once broke two
 * workflows) before a push does.
 *
 * actionlint is a Go binary, not an npm package, so it is not a devDependency:
 * locally install it with `brew install actionlint`; CI downloads a pinned,
 * checksummed release (ci.yml). Missing locally is a warning, so a contributor
 * without it can still push; missing in CI (CI=true) fails, so the gate can't
 * silently pass there.
 */
import { spawnSync } from "node:child_process";

const result = spawnSync("actionlint", { stdio: "inherit" });

if (result.error?.code === "ENOENT") {
  const inCi = process.env.CI === "true";
  console.error(
    `check:workflows: actionlint not installed${inCi ? "" : ", skipping. Run: brew install actionlint"}`,
  );
  process.exit(inCi ? 1 : 0);
}
process.exit(result.status ?? 1);
