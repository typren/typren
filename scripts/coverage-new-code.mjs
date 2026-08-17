#!/usr/bin/env node
/**
 * Coverage gate for NEW CODE ONLY.
 *
 * Vitest's own thresholds are whole-project: they can tell you the repo sits at
 * 82%, but not that the twelve lines you just wrote are untested. That second
 * number is the one that actually keeps a codebase honest, which is why Sonar
 * splits "Coverage" from "Coverage on New Code". This is that split, computed
 * locally so it works with no CI service and no cloud minutes.
 *
 * Measures CHANGED LINES, not changed files. A two-line edit to a 500-line file
 * should have to cover those two lines, not drag the whole file to 90%.
 *
 * Reads:  coverage/lcov.info  (written by `vitest run --coverage`)
 *         git diff vs the merge-base with the base branch
 * Fails:  non-zero exit when covered/instrumented changed lines < threshold
 */
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const THRESHOLD = Number(process.env.NEW_CODE_COVERAGE_MIN ?? 90);
const BASE_REF = process.env.COVERAGE_BASE_REF ?? "origin/main";
const LCOV = "coverage/lcov.info";

const git = (args) => execFileSync("git", args, { encoding: "utf8" });
const ok = (msg) => { console.log(`new-code coverage: ${msg}`); process.exit(0); };

if (!existsSync(LCOV)) {
  console.error(`new-code coverage: ${LCOV} missing. Run \`bun run test:coverage\` first.`);
  process.exit(1);
}

/** Merge-base against the base branch, or null when there's no baseline yet
 *  (fresh repo, or the base ref doesn't exist locally). No baseline is not a
 *  failure. It is the first commit, and wedging that helps nobody. */
function mergeBase() {
  for (const ref of [BASE_REF, "main"]) {
    try {
      return git(["merge-base", ref, "HEAD"]).trim();
    } catch {
      /* try next */
    }
  }
  return null;
}

const base = mergeBase();
if (!base) ok(`no baseline (${BASE_REF} not found), skipping. Nothing to compare against.`);

/** file -> Set(added/modified line numbers on the HEAD side) */
function changedLines(baseSha) {
  const diff = git(["diff", "-U0", `${baseSha}...HEAD`]);
  const files = new Map();
  let current = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      const p = line.slice(4).trim();
      current = p === "/dev/null" ? null : p.replace(/^b\//, "");
      if (current) files.set(current, new Set());
      continue;
    }
    if (current && line.startsWith("@@")) {
      // @@ -old,len +new,len @@ where len defaults to 1 when omitted
      const m = /\+(\d+)(?:,(\d+))?/.exec(line);
      if (!m) continue;
      const start = Number(m[1]);
      const len = m[2] === undefined ? 1 : Number(m[2]);
      for (let i = 0; i < len; i++) files.get(current).add(start + i);
    }
  }
  return files;
}

/** file -> Map(line -> hits), from lcov DA records. */
function parseLcov(text) {
  const files = new Map();
  let sf = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("SF:")) {
      sf = path.relative(process.cwd(), path.resolve(line.slice(3).trim()));
      files.set(sf, new Map());
    } else if (sf && line.startsWith("DA:")) {
      const [ln, hits] = line.slice(3).split(",").map(Number);
      files.get(sf).set(ln, hits);
    } else if (line.startsWith("end_of_record")) {
      sf = null;
    }
  }
  return files;
}

const changed = changedLines(base);
const cov = parseLcov(readFileSync(LCOV, "utf8"));

let instrumented = 0;
let covered = 0;
const offenders = [];

for (const [file, lines] of changed) {
  const fileCov = cov.get(file);
  if (!fileCov) continue; // not instrumented (config, docs, excluded path)
  let fileInstrumented = 0;
  const missed = [];
  for (const ln of lines) {
    if (!fileCov.has(ln)) continue; // changed line isn't executable (blank, comment, type)
    fileInstrumented++;
    instrumented++;
    if (fileCov.get(ln) > 0) covered++;
    else missed.push(ln);
  }
  if (missed.length) offenders.push({ file, missed, fileInstrumented });
}

if (instrumented === 0) ok("no instrumented lines changed, nothing to gate.");

const pct = (covered / instrumented) * 100;
const rounded = Math.round(pct * 10) / 10;

if (pct + 1e-9 < THRESHOLD) {
  console.error(`\nnew-code coverage: ${rounded}% of changed lines covered (need ${THRESHOLD}%)`);
  console.error(`  ${covered}/${instrumented} changed executable lines hit by tests\n`);
  for (const o of offenders.sort((a, b) => b.missed.length - a.missed.length).slice(0, 15)) {
    const shown = o.missed.slice(0, 12).join(", ");
    const more = o.missed.length > 12 ? ` … +${o.missed.length - 12} more` : "";
    console.error(`  ${o.file}: uncovered lines ${shown}${more}`);
  }
  console.error("\nCover the new lines, or set NEW_CODE_COVERAGE_MIN to override for a one-off.\n");
  process.exit(1);
}

ok(`${rounded}% of changed lines covered (${covered}/${instrumented}, need ${THRESHOLD}%) ✓`);
