#!/usr/bin/env node
/**
 * Breaking-change migration gate.
 *
 * `bun changeset` lets a contributor describe a breaking change in prose
 * and nothing enforces that `docs/migrations/<pkg>-<version>.md` (the file
 * `typren migrate` actually reads, see packages/cli/src/migrate.ts) exists
 * to go with it. This closes that gap: any pending changeset whose body
 * has a line starting with "breaking" must have a migration note for each
 * package it bumps, versioned at exactly that package's next version.
 *
 * Prerelease versions aren't handled, same simplification as the postbuild
 * packer (packages/core/scripts/postbuild.mjs): no package here cuts one.
 *
 * The pure logic (`checkMigrations`) takes plain directories in, so it's
 * testable against tmp-dir fixtures with no real git or changeset state
 * (see check-migrations.test.mjs). The bottom of this file is just the CLI
 * wrapper: read the real repo, call it, print, exit.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `typren/core`'s postbuild only packs notes named `core-*.md` (see
// packages/core/scripts/postbuild.mjs's packMigrationNotes), so `typren
// migrate` can only ever surface a note for that package. Gating other
// packages on a note that nothing would ever read would just block
// legitimate releases. ponytail: core-only; extend this set (and the
// postbuild packer) when another package starts shipping its own notes.
const PACKED_PACKAGES = new Set(["core"]);

function parseSemver(version) {
  const m = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Pre-1.0 (major === 0): this repo's own convention is "breaking changes
 *  bump minor" (see AGENTS.md), so a "major" changeset bump pre-1.0 lands
 *  the same place a "minor" one does. Post-1.0 this is a plain semver bump. */
function nextVersion([major, minor, patch], bumpType) {
  if (bumpType === "patch") return [major, minor, patch + 1];
  if (major === 0) return [major, minor + 1, 0];
  return bumpType === "minor" ? [major, minor + 1, 0] : [major + 1, 0, 0];
}

/** package name -> { shortName: dir name used in migration filenames, version } */
function loadPackages(repoRoot) {
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

/** A changeset file's frontmatter lines look like `"@typren/core": minor`,
 *  but contributors (and changesets itself in some paths) also write the
 *  key unquoted or single-quoted; all three are valid YAML here. CRLF
 *  line endings (a Windows checkout, or a file touched by a tool that
 *  rewrites them) would otherwise break the `$` anchors below. */
function parseChangeset(raw) {
  const normalized = raw.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { packages: [], body: "" };
  const [, frontmatter, body] = match;
  const packages = [
    ...frontmatter.matchAll(/^(?:"([^"]+)"|'([^']+)'|(\S+))\s*:\s*(patch|minor|major)\s*$/gm),
  ].map((m) => ({ name: m[1] ?? m[2] ?? m[3], bump: m[4] }));
  return { packages, body: body.trim() };
}

/** "BREAKING:", "**Breaking**", "breaking change:", etc.: any body line
 *  (not just the first) that opens with the word, optionally wrapped in
 *  markdown emphasis markers and/or followed by a colon. */
const BREAKING_LINE = /^\**\s*breaking\s*:?/im;

function isBreaking(body) {
  return body.split("\n").some((line) => BREAKING_LINE.test(line));
}

/**
 * Checks every pending changeset in `changesetDir` against the migration
 * notes in `migrationsDir`, using the installed package versions under
 * `repoRoot/packages/*`.
 */
export function checkMigrations(repoRoot) {
  const changesetDir = path.join(repoRoot, ".changeset");
  const migrationsDir = path.join(repoRoot, "docs", "migrations");

  const packages = loadPackages(repoRoot);
  const migrationFiles = existsSync(migrationsDir) ? readdirSync(migrationsDir).filter((f) => f.endsWith(".md")) : [];
  const changesetFiles = existsSync(changesetDir)
    ? readdirSync(changesetDir).filter((f) => f.endsWith(".md") && f !== "README.md")
    : [];

  const missing = [];
  const unpacked = [];
  for (const file of changesetFiles) {
    const { packages: bumped, body } = parseChangeset(readFileSync(path.join(changesetDir, file), "utf8"));
    if (!isBreaking(body)) continue;

    for (const { name, bump } of bumped) {
      const pkg = packages.get(name);
      if (!pkg) continue; // unknown/removed package, nothing to check it against

      if (!PACKED_PACKAGES.has(pkg.shortName)) {
        unpacked.push(
          `.changeset/${file} marks "${name}" BREAKING, but only ${[...PACKED_PACKAGES].join(", ")} packages' notes are ` +
            `packed into the published CLI (see postbuild's packMigrationNotes), so this gate can't verify one exists for it.`
        );
        continue;
      }

      const current = parseSemver(pkg.version);
      const want = nextVersion(current, bump).join(".");
      const hasNote = migrationFiles.some((f) => f === `${pkg.shortName}-${want}.md`);
      if (!hasNote) {
        missing.push(
          `.changeset/${file} marks "${name}" BREAKING but docs/migrations/${pkg.shortName}-${want}.md ` +
            `(the version this changeset's "${bump}" bump produces) is missing.`
        );
      }
    }
  }

  return { ok: missing.length === 0, missing, unpacked, changesetsChecked: changesetFiles.length };
}

function isDirectRun() {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === new URL(`file://${path.resolve(entry)}`).href;
}

if (isDirectRun()) {
  const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const result = checkMigrations(repoRoot);

  if (result.unpacked.length) {
    console.warn("check-migrations: breaking changesets this gate can't verify (not a packed package):\n");
    for (const m of result.unpacked) console.warn(`  - ${m}`);
    console.warn("");
  }

  if (!result.ok) {
    console.error("check-migrations: breaking changesets without a matching migration note:\n");
    for (const m of result.missing) console.error(`  - ${m}`);
    console.error(
      "\nAdd docs/migrations/<package>-<version>.md: frontmatter {package, version, title, detect: [{pattern, glob, hint}]}, " +
        "then '## What changed' / '## Fix' / '## Verify' sections. `typren migrate` reads it via @typren/core/migrations. " +
        "The note's version must be exactly the version this changeset's bump produces."
    );
    process.exit(1);
  }

  console.log(`check-migrations: ok (${result.changesetsChecked} changeset(s) checked).`);
}
