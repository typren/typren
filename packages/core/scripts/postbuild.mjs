#!/usr/bin/env node
/**
 * Post-build steps for `dist`.
 *
 * tsdown already writes `.js` on relative specifiers, so raw Node ESM can load
 * the output. This script packs the migration notes into the published
 * package, then smokes it: every server-safe entry must actually load under
 * `node`. The `typren` CLI package runs under raw Node and imports this package
 * by its published specifiers, so these entries must load standalone.
 */
import { readdirSync, copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const DIST = "dist";
const MIGRATIONS_SRC = path.join("..", "..", "docs", "migrations");
const MIGRATIONS_OUT = "migrations";
const MIGRATIONS_KEEP = 5;

// `typren migrate` (the CLI) reads notes from the INSTALLED @typren/core,
// not from this repo's docs/, so each release packs the notes relevant to
// it into the published package here. Keep only the newest few: old notes
// for versions nobody's still upgrading from just bloat the tarball.
// Prerelease versions aren't handled (no project here cuts one yet).
function packMigrationNotes() {
  rmSync(MIGRATIONS_OUT, { recursive: true, force: true });
  if (!existsSync(MIGRATIONS_SRC)) return 0;
  const parsed = readdirSync(MIGRATIONS_SRC)
    .filter((f) => f.startsWith("core-") && f.endsWith(".md"))
    .map((file) => {
      const m = file.match(/^core-(\d+)\.(\d+)\.(\d+)\.md$/);
      return m ? { file, version: [Number(m[1]), Number(m[2]), Number(m[3])] } : null;
    })
    .filter((x) => x !== null)
    .sort((a, b) => b.version[0] - a.version[0] || b.version[1] - a.version[1] || b.version[2] - a.version[2])
    .slice(0, MIGRATIONS_KEEP);
  if (parsed.length === 0) return 0;
  mkdirSync(MIGRATIONS_OUT, { recursive: true });
  for (const { file } of parsed) copyFileSync(path.join(MIGRATIONS_SRC, file), path.join(MIGRATIONS_OUT, file));
  // `typren migrate` (packages/cli/src/migrate.ts) reads this to warn a
  // project upgrading from before this cutoff that older notes it might
  // have needed were dropped by the slice above, not just "none applied".
  const oldest = parsed[parsed.length - 1].version.join(".");
  writeFileSync(path.join(MIGRATIONS_OUT, ".min-version"), oldest);
  return parsed.length;
}
const migrationsPacked = packMigrationNotes();

// Smoke: raw Node ESM must load every server-safe entry, including `seo`
// (it imports `next/server.js`; next ships no exports map, so the subpath
// resolves as a file path and Node ESM needs the extension; see changeset).
const SERVER_ENTRIES = ["index.js", "proxy.js", "i18n.js", "auth/local.js", "seo/index.js", "static-host.js", "tags/index.js"];
execFileSync(
  process.execPath,
  ["--input-type=module", "-e", SERVER_ENTRIES.map((e) => `await import("./${DIST}/${e}");`).join("\n")],
  { stdio: "inherit" },
);

console.log(`postbuild: ${SERVER_ENTRIES.length} entries load under node`);
console.log(`postbuild: ${migrationsPacked} migration note(s) packed into ${MIGRATIONS_OUT}/`);
