#!/usr/bin/env node
/**
 * Tag-from-npm-truth for the release workflow (.github/workflows/release.yml).
 *
 * `changeset tag` only tags versions created-this-run, and `changeset publish`
 * itself dies before that step runs if even one package fails to publish (see
 * the workflow's own history: 0.1.2 and 0.1.3 both shipped tagless). A retry
 * then only tags what the retry publishes, never what an earlier failed run
 * already got onto npm.
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

/** package name -> version, for every publishable (non-private) workspace package. */
function loadPublishablePackages(repoRoot) {
  const packagesDir = path.join(repoRoot, "packages");
  const packages = [];
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgJsonPath = path.join(packagesDir, entry.name, "package.json");
    if (!existsSync(pkgJsonPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
    if (pkg.private) continue;
    packages.push({ name: pkg.name, version: pkg.version });
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

function isOnNpmReal(name, version) {
  try {
    execFileSync("npm", ["view", `${name}@${version}`, "version"], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
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

export { loadPublishablePackages, tagsToCreate, run };
