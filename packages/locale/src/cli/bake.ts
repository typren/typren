import { buildCatalogs } from "../build";
import { jwkThumbprint, parseSigningKey, parseTrustedKeys, SIGNING_KEY_ENV, type SigningKey } from "../sign";
import { readConfigFile } from "./config-file";
import { EXIT_FAILURE, printJson } from "./output";

export interface BakeOptions {
  configPath: string;
  outDir: string;
  /**
   * ponytail: not one of the spec'd flags (`bake --config <path> --out
   * <dir>` only). `buildCatalogs` requires a `buildVersion` string to stamp
   * the manifest and key the delta-history window, so this defaults to an
   * ISO timestamp when omitted. Escape hatch here (`--build-version`) for a
   * caller with a real release id (git sha, package version); wire one up
   * for real once the publish pipeline picks a convention.
   */
  buildVersion?: string;
  /** Manifest lifetime; passed to buildCatalogs. */
  expiresInDays?: number;
  /** Defaults to process.env; injected by tests. */
  env?: Record<string, string | undefined>;
}

export type BakeResult =
  | {
      ok: true;
      app: string;
      locales: string[];
      hashes: Record<string, string>;
      deltaCount: number;
      signedKid: string | null;
      sequence: number;
      expiresAt: string;
    }
  | { ok: false; error: string; exitCode?: 2 };

const fail = (error: string): BakeResult => ({ ok: false, error, exitCode: 2 });

/**
 * Core of `bake`: resolve `--config`, then run the full gated publish
 * (`buildCatalogs`: no-dotted-keys + no-HTML gates, content hashing, manifest
 * + precomputed deltas) into `--out`.
 */
export async function runBake(opts: BakeOptions): Promise<BakeResult> {
  const loaded = readConfigFile(opts.configPath);
  if (!loaded.ok) return { ok: false, error: loaded.error };

  let config;
  try {
    config = loaded.resolve();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  const env = opts.env ?? process.env;
  const secret = env[SIGNING_KEY_ENV]?.trim();
  let signingKey: SigningKey | undefined;
  if (!secret) {
    if (env.CI === "true" || env.CI === "1") {
      return fail(
        `${SIGNING_KEY_ENV} is not set and CI is true: refusing to publish an unsigned manifest that apps would reject. Fix: run \`typren-locale keys init --config ${opts.configPath}\` once locally, commit the config, and store the printed value as the ${SIGNING_KEY_ENV} secret in your CI.`,
      );
    }
  } else {
    try {
      signingKey = await parseSigningKey(secret);
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
    try {
      await parseTrustedKeys(config.publicKeys);
    } catch (e) {
      return fail(
        `${e instanceof Error ? e.message : String(e)}. Fix: run \`typren-locale keys init --config ${opts.configPath}\`.`,
      );
    }
    const priv = signingKey.privateJwk;
    const mismatch = (why: string) =>
      fail(`${SIGNING_KEY_ENV} ${why}. Fix: restore the matching secret, or run \`typren-locale keys rotate\` and redeploy apps with the new key.`);
    if ((await jwkThumbprint(priv)) !== signingKey.kid) return mismatch("declares a kid that is not the thumbprint of its own public key");
    const entry = (config.publicKeys ?? []).find((k) => k.kid === signingKey!.kid);
    if (entry) {
      let x: string | undefined;
      let y: string | undefined;
      if ("jwk" in entry) ({ x, y } = entry.jwk);
      else {
        try {
          const pub = await globalThis.crypto.subtle.importKey("spki", Buffer.from(entry.spki, "base64url"), { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"]);
          ({ x, y } = await globalThis.crypto.subtle.exportKey("jwk", pub));
        } catch {
          return mismatch(`matches a publicKeys entry (kid ${signingKey.kid}) whose spki cannot be imported`);
        }
      }
      if (x !== priv.x || y !== priv.y) return mismatch(`matches publicKeys entry kid ${signingKey.kid} by name but not by public key`);
    }
    const trusted = entry !== undefined;
    if (!trusted) {
      return fail(
        `${SIGNING_KEY_ENV} (kid ${signingKey.kid}) is not among publicKeys in ${opts.configPath}, so apps would reject the manifest. Fix: restore the matching secret, or run \`typren-locale keys rotate\` and redeploy apps with the new key.`,
      );
    }
  }

  const buildVersion = opts.buildVersion ?? new Date().toISOString();
  try {
    const result = await buildCatalogs(config.source, { app: config.app, buildVersion, outDir: opts.outDir,
      signingKey,
      expiresInDays: opts.expiresInDays,
    });
    const hashes = Object.fromEntries(
      Object.entries(result.manifest.apps[config.app] ?? {}).map(([lang, entry]) => [lang, entry.hash]),
    );
    return {
      ok: true,
      app: config.app,
      locales: Object.keys(hashes),
      hashes,
      deltaCount: result.deltaPaths.length,
      signedKid: result.manifest.signature?.kid ?? null,
      sequence: result.manifest.sequence ?? 0,
      expiresAt: result.manifest.expiresAt ?? "",
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function printBakeResult(result: BakeResult, opts: { json?: boolean } = {}): void {
  if (!result.ok) process.exitCode = EXIT_FAILURE;
  if (opts.json) return printJson(result);
  if (!result.ok) {
    console.error(`typren-locale bake: ${result.error}`);
    return;
  }
  console.log(`typren-locale bake: app "${result.app}", ${result.locales.length} locale(s), ${result.deltaCount} delta(s) written.`);
  for (const locale of result.locales) console.log(`  ${locale}: ${result.hashes[locale]}`);
  console.log(
    result.signedKid
      ? `  signed: kid ${result.signedKid}, sequence ${result.sequence}, expires ${result.expiresAt}`
      : `  UNSIGNED: loadMessages will refuse this manifest outside insecureDevMode (set ${SIGNING_KEY_ENV})`,
  );
}

export const BAKE_HELP = `usage: typren-locale bake --config <path> --out <dir> [--build-version <v>] [--expires-in-days <n>]

  Resolves --config's { app, source } build config and runs the full gated
  publish (buildCatalogs): no-dotted-keys + no-HTML gates, content hashing,
  manifest, and precomputed deltas against prior releases under --out.

  The manifest is signed with the ES256 key in the TYPREN_SIGNING_KEY env var
  (create one with \`typren-locale keys init\`); its kid must be in the config's
  publicKeys. With CI=true and no key, bake exits 2. Locally it writes an
  unsigned manifest with a warning.

  --config <path>          Build config file (required).
  --out <dir>               Output directory (required).
  --build-version <v>       Release id stamped into the manifest (default: an ISO timestamp).
  --expires-in-days <n>     Manifest lifetime in days (default: 30).
  --help                    Show this help.
`;
