#!/usr/bin/env node
// Security-review gate for promotions to main (docs/security-review.md).
//
// Passes when some record in security-reviews/*.md says `outcome: pass` with no open critical or high
// findings, its `reviewedHead` is an ancestor of (or equal to) the commit being checked, and nothing
// security-sensitive changed between the reviewed commit and that commit. Docs, changeset notes and the
// records themselves may change after a review; code, tests, config, workflows and manifests may not.
//
// The record is an attestation, not proof: the gate only checks that one exists and is current. Who may
// write records is governed by review on the PR that adds them (CODEOWNERS), not by this script.
//
// Usage: node scripts/check-security-review.mjs [--head <ref>]   (default HEAD)

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RECORD_DIR = "security-reviews";

// Changes to these after a review invalidate it: anything the release build executes or the tarballs ship.
// Root files are matched wholesale (manifests, lockfile, tsconfig/vitest/eslint/commitlint config, .npmrc) so a new
// root config is covered without editing this list. Tests count: the release job runs them before staging dist/.
const SENSITIVE = [/^[^/]+$/, /^packages\//, /^apps\//, /^scripts\//, /^\.husky\//, /^\.github\//, /^\.changeset\//,
  /^\.claude\/workflows\//,
  // Core's postbuild packs these notes into the tarball, and `typren migrate` runs their `detect` regexes.
  /^docs\/migrations\//];
// Prose that neither runs nor ships. Not under docs/migrations/ or a package's src/, which ship.
const EXEMPT = [/^(?!docs\/migrations\/|packages\/[^/]+\/src\/).*\.md$/];

export function isSensitive(file) {
  if (EXEMPT.some((r) => r.test(file))) return false;
  return SENSITIVE.some((r) => r.test(file));
}

/** Minimal front-matter reader for the record shape the workflow and runbook both write. */
export function parseRecord(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  const out = { open: {} };
  let inOpen = false;
  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, "");
    if (/^open:\s*$/.test(line)) { inOpen = true; continue; }
    const kv = /^(\s*)([A-Za-z]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, indent, k, v] = kv;
    if (inOpen && indent.length > 0) { out.open[k] = Number(v); continue; }
    inOpen = false;
    out[k] = v.trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

export const MAX_WAIVER_DAYS = 14;
const DAY_MS = 86_400_000;
const isoDay = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s ?? "") ? Date.parse(`${s}T00:00:00Z`) : NaN);

/**
 * A waiver is the one sanctioned way to promote without a review: named owner, written reason, and an expiry at most
 * MAX_WAIVER_DAYS after its date. Past expiry it stops counting. `today` is injected for tests.
 */
export function waiverValid(rec, today) {
  if (!rec || rec.outcome !== "waived" || !/^[0-9a-f]{7,40}$/.test(rec.reviewedHead ?? "")) return false;
  if (!/^@?[A-Za-z0-9-]+$/.test(rec.waivedBy ?? "") || (rec.reason ?? "").trim().length < 10) return false;
  const start = isoDay(rec.date), end = isoDay(rec.expires), now = isoDay(today);
  if ([start, end, now].some(Number.isNaN)) return false;
  return end >= start && end - start <= MAX_WAIVER_DAYS * DAY_MS && now <= end;
}

/** A record clears the gate only if it is a clean pass. Unknown or missing counts fail closed. */
export function recordPasses(rec) {
  if (!rec || rec.outcome !== "pass" || !/^[0-9a-f]{7,40}$/.test(rec.reviewedHead ?? "")) return false;
  const n = (k) => (Number.isInteger(rec.open?.[k]) ? rec.open[k] : Infinity);
  if (n("critical") !== 0 || n("high") !== 0) return false;
  return !rec.incomplete || /^\[\s*\]$/.test(rec.incomplete);
}

/**
 * Pure decision over injected git facts so it is testable without a repository.
 * git: { isAncestor(a, b): boolean, changedFiles(a, b): string[] }
 */
export function evaluate(records, head, git, today = new Date().toISOString().slice(0, 10)) {
  const reasons = [];
  for (const { file, rec } of records) {
    const waived = waiverValid(rec, today);
    if (!waived && !recordPasses(rec)) {
      reasons.push(`${file}: ${rec?.outcome === "waived" ? "waiver invalid or expired" : "not a clean pass"}`);
      continue;
    }
    if (!git.isAncestor(rec.reviewedHead, head)) { reasons.push(`${file}: reviewed commit is not in this history`); continue; }
    const drift = git.changedFiles(rec.reviewedHead, head).filter(isSensitive);
    if (drift.length) { reasons.push(`${file}: sensitive files changed since review: ${drift.slice(0, 5).join(", ")}`); continue; }
    return { ok: true, record: file, waived, waiver: waived ? { by: rec.waivedBy, reason: rec.reason, expires: rec.expires } : null, reasons };
  }
  return { ok: false, record: null, reasons };
}

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

export function run(argv = process.argv.slice(2), cwd = process.cwd()) {
  const i = argv.indexOf("--head");
  const headRef = i >= 0 ? argv[i + 1] : "HEAD";
  if (!headRef || headRef.startsWith("-")) throw new Error("check-security-review: --head needs a ref");
  const head = git(["rev-parse", "--verify", "--end-of-options", `${headRef}^{commit}`], cwd).trim();
  const dir = path.join(cwd, RECORD_DIR);
  const records = (fs.existsSync(dir) ? fs.readdirSync(dir) : [])
    // README and the _TEMPLATE-* files are guidance, not records.
    .filter((f) => f.endsWith(".md") && f !== "README.md" && !f.startsWith("_"))
    .sort()
    .reverse()
    .map((f) => ({ file: `${RECORD_DIR}/${f}`, rec: parseRecord(fs.readFileSync(path.join(dir, f), "utf8")) }));
  const result = evaluate(records, head, {
    isAncestor: (a, b) => {
      try { git(["merge-base", "--is-ancestor", "--end-of-options", a, b], cwd); return true; } catch { return false; }
    },
    changedFiles: (a, b) => git(["diff", "--name-only", "--no-renames", `${a}..${b}`], cwd).split("\n").filter(Boolean),
  });
  return { head, ...result };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const r = run();
  if (r.ok) {
    if (r.waived) {
      const msg = `security review WAIVED for ${r.head.slice(0, 12)} by ${r.waiver.by} until ${r.waiver.expires}: ${r.waiver.reason}`;
      console.log(process.env.GITHUB_ACTIONS ? `::warning title=Security review waived::${msg}` : `check-security-review: ${msg}`);
    } else {
      console.log(`check-security-review: ok (${r.record} covers ${r.head.slice(0, 12)})`);
    }
  } else {
    console.error(`check-security-review: no passing security review covers ${r.head.slice(0, 12)}.`);
    for (const reason of r.reasons) console.error(`  - ${reason}`);
    if (!r.reasons.length) console.error(`  - no records in ${RECORD_DIR}/`);
    console.error("  Run the review (docs/security-review.md) and commit its record to this PR.");
    process.exit(1);
  }
}
