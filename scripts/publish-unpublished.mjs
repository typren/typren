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
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isOnNpmReal, loadPublishablePackages } from "./tag-published.mjs";

/** Decision and loop over injected npm access, so it is testable without a registry. Publishes run
 *  concurrently (each `npm publish` is mostly waiting on the registry); results keep input order. */
async function publishUnpublished(packages, { isOnNpm, publish }) {
  const outcomes = await Promise.all(
    packages.map(async (pkg) => {
      const id = `${pkg.name}@${pkg.version}`;
      if (isOnNpm(pkg.name, pkg.version)) return { id, kind: "skipped" };
      try {
        // Every publishable package ships dist/; without it npm would happily publish a tarball of
        // nothing but package.json and README.
        if (!existsSync(path.join(pkg.dir, "dist"))) throw new Error(`${pkg.dir}/dist is missing`);
        await publish(pkg);
        return { id, kind: "published" };
      } catch (err) {
        console.error(`publish failed for ${id}: ${err.message}`);
        return { id, kind: "failed" };
      }
    })
  );
  const ids = (kind) => outcomes.filter((o) => o.kind === kind).map((o) => o.id);
  return { published: ids("published"), skipped: ids("skipped"), failed: ids("failed") };
}

// npm 11 refuses to publish a prerelease version (e.g. "1.0.0-beta.1") without an explicit --tag,
// since it would otherwise move the registry's "latest" tag onto a prerelease. The first dot-separated
// identifier after the "-" is the conventional npm dist-tag (semver's own meaning for it: "beta.1"
// sorts under the "beta" prerelease line). Stable versions are unaffected.
function prereleaseTag(version) {
  const match = /^\d+\.\d+\.\d+-([0-9A-Za-z-]+)/.exec(version);
  return match ? match[1] : null;
}

function npmPublishArgs(version) {
  const tag = prereleaseTag(version);
  return tag ? ["publish", "--access", "public", "--tag", tag] : ["publish", "--access", "public"];
}

// No NODE_AUTH_TOKEN: under trusted publishing npm exchanges the job's OIDC token for a short-lived
// credential and attaches provenance itself. `--access public` is what .changeset/config.json's
// `access` used to pass. No shell, so nothing in a package name or path is ever interpreted.
// Output is buffered per package rather than inherited, so concurrent publishes don't interleave.
async function publishReal(pkg) {
  const { stdout, stderr } = await promisify(execFile)("npm", npmPublishArgs(pkg.version), { cwd: pkg.dir });
  process.stderr.write(stderr);
  process.stdout.write(stdout);
}

async function run(repoRoot) {
  const result = await publishUnpublished(loadPublishablePackages(repoRoot), { isOnNpm: isOnNpmReal, publish: publishReal });
  for (const id of result.published) console.log(`published ${id}`);
  for (const id of result.skipped) console.log(`already on npm: ${id}`);
  return result;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain && (await run(process.cwd())).failed.length > 0) process.exit(1);

export { publishUnpublished, run, npmPublishArgs };
