import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, basename, isAbsolute, join, relative, resolve } from "node:path";
import { generateSigningKey, parseTrustedKeys } from "../sign";
import type { TrustedKey } from "../types";
import { readConfigFile } from "./config-file";

export interface KeysOptions {
  action: "init" | "rotate";
  configPath: string;
  /** Private-key file; must resolve outside the repository root. Omitted: the secret is returned for printing and written nowhere. */
  out?: string;
}

export type KeysResult =
  | {
      ok: true;
      action: "init" | "rotate";
      kid: string;
      configPath: string;
      publicKeys: TrustedKey[];
      secret?: string;
      secretPath?: string;
    }
  | { ok: false; error: string; exitCode: 2 };

const fail = (error: string): KeysResult => ({ ok: false, error, exitCode: 2 });

function findRepoRoot(configPath: string): string {
  const start = dirname(realpathSync(configPath));
  for (let dir = start; ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) return dir;
    if (dirname(dir) === dir) return start;
  }
}

function insideGitRepo(dir: string): boolean {
  for (let d = dir; ; d = dirname(d)) {
    if (existsSync(join(d, ".git"))) return true;
    if (dirname(d) === d) return false;
  }
}

export async function runKeys(opts: KeysOptions): Promise<KeysResult> {
  const { action, configPath, out } = opts;
  const loaded = readConfigFile(configPath);
  if (!loaded.ok) return fail(loaded.error);
  const raw = loaded.raw;

  const existing = raw.publicKeys;
  const hasKeys = Array.isArray(existing) && existing.length > 0;
  if (action === "init" && hasKeys) {
    return fail(`${configPath} already has publicKeys; use \`typren-locale keys rotate\` to add a key`);
  }
  if (action === "rotate") {
    if (!hasKeys) return fail(`${configPath} has no publicKeys; run \`typren-locale keys init\` first`);
    try {
      await parseTrustedKeys(existing);
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  }

  const { kid, publicJwk, secret } = await generateSigningKey();

  let secretPath: string | undefined;
  if (out) {
    const root = realpathSync(findRepoRoot(configPath));
    const abs = resolve(process.cwd(), out);
    if (!existsSync(dirname(abs))) return fail(`directory does not exist: ${dirname(abs)}`);
    const target = join(realpathSync(dirname(abs)), basename(abs));
    const rel = relative(root, target);
    if (!rel.startsWith("..") && !isAbsolute(rel)) {
      return fail(
        `refusing to write the private key inside the repository (${root}). Pass --out with a path outside it, or omit --out to print the key once.`,
      );
    }
    if (insideGitRepo(dirname(target))) {
      return fail("refusing to write the private key inside a git repository. Pass --out with a path outside any repository, or omit --out to print the key once.");
    }
    try {
      writeFileSync(target, `${secret}\n`, { mode: 0o600, flag: "wx" });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") return fail(`${target} already exists`);
      return fail(e instanceof Error ? e.message : String(e));
    }
    secretPath = target;
  }

  const publicKeys: TrustedKey[] = [...(hasKeys ? existing : []), { kid, jwk: publicJwk }];
  raw.publicKeys = publicKeys;
  try {
    writeFileSync(configPath, `${JSON.stringify(raw, null, 2)}\n`);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }

  return { ok: true, action, kid, configPath, publicKeys, ...(secretPath ? { secretPath } : { secret }) };
}

export function printKeysResult(result: KeysResult, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(result));
    process.exitCode = result.ok ? 0 : 2;
    return;
  }
  if (!result.ok) {
    console.error(`typren-locale keys: ${result.error}`);
    process.exitCode = 2;
    return;
  }
  const lines = [`typren-locale keys ${result.action}: added public key ${result.kid} to ${result.configPath}.`];
  if (result.secret) {
    lines.push(
      "",
      "Store only the value after the `=` as the TYPREN_SIGNING_KEY secret in your CI provider. It is shown once and written nowhere:",
      "",
      `TYPREN_SIGNING_KEY=${result.secret}`,
    );
  } else {
    lines.push(
      `Private key written to ${result.secretPath} (mode 600). Store its contents as the TYPREN_SIGNING_KEY CI secret, then keep it out of the repository.`,
    );
  }
  lines.push(
    `Next: commit ${result.configPath}; embed its keys in your app with readPublicKeys() from @typren/locale/build and pass them to loadMessages({ publicKeys }).`,
  );
  if (result.action === "rotate") {
    lines.push(
      "Old keys stay trusted. Rebuild and deploy apps before switching the CI secret, and remove an old kid from publicKeys only after no deployed build needs it.",
    );
  }
  console.log(lines.join("\n"));
}

export const KEYS_HELP = `usage: typren-locale keys init|rotate --config <path> [--out <file>] [--json]

  init      Generate a signing key pair and add its public key to the config's publicKeys.
  rotate    Add a new key pair; existing public keys stay trusted.
  --out     Write the private key to <file> (mode 600, no overwrite, outside the repository) instead of printing it.

Use a separate key and config per publish channel (production, staging): signatures do not bind a manifest to its channel.
`;
