#!/usr/bin/env node
/**
 * Tag-from-npm-truth for the release workflow (.github/workflows/release.yml).
 *
 * `changeset tag`, which this replaced, only tagged versions created-this-run,
 * and the publish step can fail partway (see the workflow's own history: 0.1.2
 * and 0.1.3 both shipped tagless). A retry then only tags what the retry
 * publishes, never what an earlier failed run already got onto npm.
 *
 * This derives tags from npm instead: for every non-private workspace
 * package, if npm already has that version and the matching tag doesn't
 * exist locally, create it. Re-running against an unchanged npm/tag state
 * creates nothing, so it stays correct across retries.
 *
 * Tag format matches changesets' own (`<name>@<version>`, see existing tags
 * via `git tag -l` and .changeset/config.json's privatePackages.tag: false,
 * mirrored here by skipping `private: true` packages).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** name, version and directory of every publishable (non-private) workspace package. */
function loadPublishablePackages(repoRoot) {
  const packagesDir = path.join(repoRoot, "packages");
  const packages = [];
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgJsonPath = path.join(packagesDir, entry.name, "package.json");
    if (!existsSync(pkgJsonPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
    if (pkg.private) continue;
    packages.push({ name: pkg.name, version: pkg.version, dir: path.join(packagesDir, entry.name) });
  }
  return packages;
}

/** Pure: no shelling out, so it's testable against plain fixtures. */
function tagsToCreate(packages, { isOnNpm, tagExists }) {
  const tags = [];
  for (const { name, version } of packages) {
    const tag = `${name}@${version}`;
    if (tagExists(tag)) continue;
    if (!isOnNpm(name, version)) continue;
    tags.push(tag);
  }
  return tags;
}

/** Exact-version `npm view` exits non-zero (E404) when that version is not on the registry. Any other
 *  failure (network, auth) also reads as "not published": the publish step then tries, and npm itself
 *  refuses to overwrite a version that does exist, so the error surfaces there instead of being skipped. */
function isOnNpmReal(name, version) {
  try {
    const out = execFileSync("npm", ["view", `${name}@${version}`, "version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim() === version;
  } catch {
    return false;
  }
}

function tagExistsReal(tag) {
  return execFileSync("git", ["tag", "-l", tag], { encoding: "utf8" }).trim().length > 0;
}

/** CLI entry point: tag and print what it did. Needs a committer identity on
 *  the runner (the workflow sets one before calling this) since these are
 *  annotated tags, same as changesets' own tagging did. */
function run(repoRoot) {
  const packages = loadPublishablePackages(repoRoot);
  const tags = tagsToCreate(packages, { isOnNpm: isOnNpmReal, tagExists: tagExistsReal });
  for (const tag of tags) {
    execFileSync("git", ["tag", "-a", tag, "-m", tag], { stdio: "inherit" });
    console.log(`tagged ${tag}`);
  }
  if (tags.length === 0) console.log("no new tags");
  return tags;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  run(process.cwd());
}

export { loadPublishablePackages, tagsToCreate, isOnNpmReal, run };
