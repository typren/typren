#!/usr/bin/env node
/**
 * Breaking-change migration gate.
 *
 * `bun changeset` lets a contributor describe a breaking change in prose
 * and nothing enforces that `docs/migrations/<pkg>-<version>.md` (the file
 * `typren migrate` actually reads, see packages/cli/src/migrate.ts) exists
 * to go with it. This closes that gap: any pending changeset whose body
 * opens with `BREAKING:` must have a migration note for each package it
 * bumps, versioned ahead of that package's current package.json.
 *
 * Prerelease versions aren't handled, same simplification as the postbuild
 * packer (packages/core/scripts/postbuild.mjs): no package here cuts one.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const changesetDir = path.join(repoRoot, ".changeset");
const migrationsDir = path.join(repoRoot, "docs", "migrations");

function parseSemver(version) {
  const m = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function isGreater(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/** package name -> { dir: short name used in migration filenames, version } */
function loadPackages() {
  const map = new Map();
  for (const entry of readdirSync(path.join(repoRoot, "packages"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgJsonPath = path.join(repoRoot, "packages", entry.name, "package.json");
    if (!existsSync(pkgJsonPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
    map.set(pkg.name, { shortName: entry.name, version: pkg.version });
  }
  return map;
}

/** A changeset file's frontmatter lines look like `"@typren/core": minor`.
 *  No YAML dependency for two lines of a known shape. */
function parseChangeset(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { packages: [], body: "" };
  const [, frontmatter, body] = match;
  const packages = [...frontmatter.matchAll(/^"([^"]+)":\s*(patch|minor|major)\s*$/gm)].map((m) => m[1]);
  return { packages, body: body.trim() };
}

const packages = loadPackages();
const migrationFiles = existsSync(migrationsDir) ? readdirSync(migrationsDir).filter((f) => f.endsWith(".md")) : [];
const changesetFiles = existsSync(changesetDir) ? readdirSync(changesetDir).filter((f) => f.endsWith(".md") && f !== "README.md") : [];

const missing = [];
for (const file of changesetFiles) {
  const { packages: bumped, body } = parseChangeset(readFileSync(path.join(changesetDir, file), "utf8"));
  if (!body.startsWith("BREAKING:")) continue;

  for (const name of bumped) {
    const pkg = packages.get(name);
    if (!pkg) continue; // unknown/removed package, nothing to check it against
    const noteVersions = migrationFiles
      .map((f) => f.match(new RegExp(`^${pkg.shortName}-(\\d+\\.\\d+\\.\\d+)\\.md$`)))
      .filter(Boolean)
      .map((m) => parseSemver(m[1]));
    const currentVersion = parseSemver(pkg.version);
    const hasNote = noteVersions.some((v) => isGreater(v, currentVersion));
    if (!hasNote) {
      missing.push(`.changeset/${file} marks "${name}" BREAKING but docs/migrations/${pkg.shortName}-<version>.md ` + `(version > ${pkg.version}) is missing.`);
    }
  }
}

if (missing.length) {
  console.error("check-migrations: breaking changesets without a migration note:\n");
  for (const m of missing) console.error(`  - ${m}`);
  console.error(
    "\nAdd docs/migrations/<package>-<version>.md: frontmatter {package, version, title, detect: [{pattern, glob, hint}]}, " +
      "then '## What changed' / '## Fix' / '## Verify' sections. `typren migrate` reads it via @typren/core/migrations."
  );
  process.exit(1);
}

console.log(`check-migrations: ok (${changesetFiles.length} changeset(s) checked).`);
