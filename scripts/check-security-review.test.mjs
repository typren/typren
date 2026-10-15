import { describe, expect, it } from "bun:test";
import { evaluate, isSensitive, parseRecord, recordPasses, waiverValid } from "./check-security-review.mjs";

const rec = (over = "") => `---
reviewedHead: abc1234
date: 2026-10-15
method: workflow
outcome: pass
open:
  critical: 0
  high: 0
  medium: 2
  low: 3
incomplete: []
${over}---
body`;

const git = (ancestor = true, changed = []) => ({ isAncestor: () => ancestor, changedFiles: () => changed });

describe("parseRecord / recordPasses", () => {
  it("accepts a clean pass", () => {
    expect(recordPasses(parseRecord(rec()))).toBe(true);
  });
  it("rejects open high or critical findings", () => {
    expect(recordPasses(parseRecord(rec().replace("high: 0", "high: 1")))).toBe(false);
    expect(recordPasses(parseRecord(rec().replace("critical: 0", "critical: 2")))).toBe(false);
  });
  it("rejects outcome fail, missing counts, bad sha, incomplete reviews", () => {
    expect(recordPasses(parseRecord(rec().replace("outcome: pass", "outcome: fail")))).toBe(false);
    expect(recordPasses(parseRecord(rec().replace("  high: 0\n", "")))).toBe(false);
    expect(recordPasses(parseRecord(rec().replace("abc1234", "HEAD")))).toBe(false);
    expect(recordPasses(parseRecord(rec().replace("incomplete: []", "incomplete: [red-team]")))).toBe(false);
  });
  it("handles CRLF and rejects a file without front matter", () => {
    expect(recordPasses(parseRecord(rec().replace(/\n/g, "\r\n")))).toBe(true);
    expect(parseRecord("no front matter")).toBe(null);
  });
});

describe("isSensitive", () => {
  it("flags source, workflows, hooks, scripts and manifests", () => {
    for (const f of ["packages/core/src/store.ts", ".github/workflows/release.yml", ".husky/pre-push", "scripts/x.mjs",
      "package.json", "bun.lock", "packages/forms/package.json", ".claude/workflows/security-review.mjs"]) {
      expect(isSensitive(f)).toBe(true);
    }
  });
  it("flags config the release build runs and files the tarballs ship", () => {
    for (const f of ["vitest.config.ts", "eslint.config.mjs", "commitlint.config.js", "tsconfig.base.json", ".npmrc",
      "bunfig.toml", "new-root-config.mjs", "packages/core/tsconfig.build.json", "packages/cli/LICENSE",
      ".changeset/config.json", "apps/studio/package.json", ".github/CODEOWNERS", ".github/dependabot.yml",
      "docs/migrations/core-0.5.0.md", "packages/editor/src/notes.md"]) {
      expect(isSensitive(f)).toBe(true);
    }
  });
  it("flags tests and fixtures, which run in the release build before dist/ is staged", () => {
    for (const f of ["packages/core/src/store.test.ts", "packages/cli/test-fixtures/x/a.json"]) {
      expect(isSensitive(f)).toBe(true);
    }
  });
  it("lets docs, changeset notes and records through", () => {
    for (const f of ["docs/site/quickstart.md", "docs/security-review.md", "README.md", ".changeset/foo.md",
      "security-reviews/2026-10-15-x.md", "packages/core/README.md", "etc/api-surface/core.d.ts"]) {
      expect(isSensitive(f)).toBe(false);
    }
  });
});

describe("evaluate", () => {
  const records = [{ file: "security-reviews/a.md", rec: parseRecord(rec()) }];
  it("passes when a clean record covers HEAD with no sensitive drift", () => {
    expect(evaluate(records, "def", git(true, ["docs/site/x.md"])).ok).toBe(true);
  });
  it("fails when sensitive files changed after the review", () => {
    const r = evaluate(records, "def", git(true, ["packages/core/src/store.ts"]));
    expect(r.ok).toBe(false);
    expect(r.reasons[0]).toContain("packages/core/src/store.ts");
  });
  it("fails when the reviewed commit is not in this history", () => {
    expect(evaluate(records, "def", git(false)).ok).toBe(false);
  });
  it("fails closed with no records", () => {
    expect(evaluate([], "def", git()).ok).toBe(false);
  });
});

const waiver = (over = {}) => {
  const f = { reviewedHead: "abc1234", date: "2026-10-15", outcome: "waived", waivedBy: '"@mataleogml"',
    reason: '"Hotfix for a broken publish; full review tracked in #123"', expires: "2026-10-22", ...over };
  return `---\n${Object.entries(f).filter(([, v]) => v !== null).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n`;
};

describe("waivers", () => {
  it("accepts a named, reasoned, unexpired waiver and reports it", () => {
    expect(waiverValid(parseRecord(waiver()), "2026-10-20")).toBe(true);
    const r = evaluate([{ file: "w.md", rec: parseRecord(waiver()) }], "def", git(), "2026-10-20");
    expect(r.ok).toBe(true);
    expect(r.waived).toBe(true);
    expect(r.waiver.by).toBe("@mataleogml");
  });
  it("stops counting after expiry", () => {
    expect(waiverValid(parseRecord(waiver()), "2026-10-23")).toBe(false);
    expect(evaluate([{ file: "w.md", rec: parseRecord(waiver()) }], "def", git(), "2026-10-23").reasons[0]).toContain("expired");
  });
  it("rejects waivers longer than 14 days, without an owner, or without a real reason", () => {
    expect(waiverValid(parseRecord(waiver({ expires: "2026-11-15" })), "2026-10-16")).toBe(false);
    expect(waiverValid(parseRecord(waiver({ waivedBy: null })), "2026-10-16")).toBe(false);
    expect(waiverValid(parseRecord(waiver({ reason: '"because"' })), "2026-10-16")).toBe(false);
  });
  it("is voided by sensitive changes after the waived commit, like a review", () => {
    expect(evaluate([{ file: "w.md", rec: parseRecord(waiver()) }], "def", git(true, ["scripts/x.mjs"]), "2026-10-16").ok).toBe(false);
  });
});
