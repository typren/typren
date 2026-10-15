#!/usr/bin/env node
/**
 * Publish step of the release workflow (.github/workflows/release.yml), in place of `changeset publish`.
 *
 * The publish job holds `id-token: write` for its whole run, so it must not resolve or install any
 * dependency tree: a payload in any transitive dependency of @changesets/cli would run with the OIDC
 * token in reach. This script is Node stdlib plus the npm the job pins, nothing else.
 *
 * For every non-private workspace package whose exact version is not yet on npm, run `npm publish` in
 * its directory. Already-published versions are skipped, so a push to main that carries no version
 * bump publishes nothing, and a retry after a partial failure only publishes what is still missing.
 * Every package is attempted even when an earlier one fails; the exit code is non-zero if any failed.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isOnNpmReal, loadPublishablePackages } from "./tag-published.mjs";

/** Decision and loop over injected npm access, so it is testable without a registry. */
function publishUnpublished(packages, { isOnNpm, publish }) {
  const result = { published: [], skipped: [], failed: [] };
  for (const pkg of packages) {
    const id = `${pkg.name}@${pkg.version}`;
    if (isOnNpm(pkg.name, pkg.version)) {
      result.skipped.push(id);
      continue;
    }
    try {
      // Every publishable package ships dist/; without it npm would happily publish a tarball of
      // nothing but package.json and README.
      if (!existsSync(path.join(pkg.dir, "dist"))) throw new Error(`${pkg.dir}/dist is missing`);
      publish(pkg);
      result.published.push(id);
    } catch (err) {
      console.error(`publish failed for ${id}: ${err.message}`);
      result.failed.push(id);
    }
  }
  return result;
}

// No NODE_AUTH_TOKEN: under trusted publishing npm exchanges the job's OIDC token for a short-lived
// credential and attaches provenance itself. `--access public` is what .changeset/config.json's
// `access` used to pass. No shell, so nothing in a package name or path is ever interpreted.
function publishReal(pkg) {
  execFileSync("npm", ["publish", "--access", "public"], { cwd: pkg.dir, stdio: "inherit" });
}

function run(repoRoot) {
  const result = publishUnpublished(loadPublishablePackages(repoRoot), { isOnNpm: isOnNpmReal, publish: publishReal });
  for (const id of result.published) console.log(`published ${id}`);
  for (const id of result.skipped) console.log(`already on npm: ${id}`);
  return result;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain && run(process.cwd()).failed.length > 0) process.exit(1);

export { publishUnpublished, run };
