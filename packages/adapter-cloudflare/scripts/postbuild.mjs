#!/usr/bin/env node
/**
 * Post-build steps for `dist`.
 *
 * tsdown already writes `.js` on relative specifiers (wrangler also bundles
 * `dist/worker.js` itself at deploy). This script marks the bin executable,
 * then smokes the bin and the library entry under raw Node.
 */
import { chmodSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const DIST = "dist";

chmodSync(path.join(DIST, "cli.js"), 0o755);

// Smoke: raw Node ESM must load the bin and the library entry. `dist/worker.js`
// is deliberately NOT executed here: it's a Workers-runtime module (expects
// `env.ASSETS`/`env.REDIRECTS`, not a Node global), wrangler bundles and runs
// it at deploy/dev time, not this build; worker.test.ts exercises its logic
// directly under vitest instead.
execFileSync(process.execPath, [path.join(DIST, "cli.js"), "--help"], { stdio: "ignore" });
execFileSync(process.execPath, ["--input-type=module", "-e", `await import("./${DIST}/index.js");`], { stdio: "inherit" });

console.log("postbuild: cli + index load under node");
