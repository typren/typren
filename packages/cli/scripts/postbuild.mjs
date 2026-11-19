#!/usr/bin/env node
/**
 * Post-build steps for `dist`.
 *
 * tsdown already writes `.js` on relative specifiers. This script marks the
 * published `bin` executable, then smokes it: the bin must actually load under
 * raw `node`.
 */
import { chmodSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const DIST = "dist";

chmodSync(path.join(DIST, "cli.js"), 0o755);

// Smoke: raw Node ESM must load the bin.
execFileSync(process.execPath, [path.join(DIST, "cli.js"), "--help"], { stdio: "ignore" });

console.log("postbuild: cli loads under node");
