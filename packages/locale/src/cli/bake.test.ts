import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateSigningKey, SIGNING_KEY_ENV, verifyManifestSignature } from "../sign";
import { printBakeResult, runBake } from "./bake";

function withTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "typren-locale-cli-bake-"));
}

describe("runBake", () => {
  let sourceDir: string;
  let configDir: string;
  let outDir: string;
  let configPath: string;

  beforeEach(() => {
    sourceDir = withTmpDir();
    configDir = withTmpDir();
    outDir = withTmpDir();
    writeFileSync(join(sourceDir, "en.json"), JSON.stringify({ Greeting: "Hi" }));
    configPath = join(configDir, "config.json");
    writeFileSync(configPath, JSON.stringify({ app: "demo", source: { type: "files", dir: sourceDir } }));
  });

  afterEach(() => {
    rmSync(sourceDir, { recursive: true, force: true });
    rmSync(configDir, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  });

  it("runs the gated publish and reports app/locales/hashes/delta count", async () => {
    const result = await runBake({ configPath, outDir, buildVersion: "v1", env: {} });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.app).toBe("demo");
    expect(result.locales).toEqual(["en"]);
    expect(result.hashes.en).toMatch(/^[0-9a-f]{64}$/);
    expect(result.deltaCount).toBe(0);
    expect(existsSync(join(outDir, "manifest", "demo.json"))).toBe(true);
  });

  it("defaults buildVersion to an ISO timestamp when not given", async () => {
    const result = await runBake({ configPath, outDir, env: {} });
    expect(result.ok).toBe(true);
  });

  it("surfaces a gate failure (dangerous HTML) as a clean error, not a throw", async () => {
    writeFileSync(join(sourceDir, "en.json"), JSON.stringify({ Greeting: "<script>alert(1)</script>" }));
    const result = await runBake({ configPath, outDir, env: {} });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("assertNoHtml");
  });

  it("fails cleanly on a missing config file", async () => {
    const result = await runBake({ configPath: join(sourceDir, "missing.json"), outDir, env: {} });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("not found") });
  });

  it("CI with no key exits 2 and names the fix", async () => {
    for (const env of [{ CI: "true" }, { CI: "1", [SIGNING_KEY_ENV]: "  " }]) {
      const result = await runBake({ configPath, outDir, env });
      expect(result).toMatchObject({ ok: false, exitCode: 2 });
      expect(!result.ok && result.error).toContain("keys init");
    }
  });

  it("local run with no key writes an unsigned manifest", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await runBake({ configPath, outDir, env: {} });
    expect(result).toMatchObject({ ok: true, signedKid: null });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  describe("with a signing key", () => {
    const withKeys = async (mutate?: (k: { kid: string; publicJwk: JsonWebKey }) => unknown[] | undefined) => {
      const key = await generateSigningKey();
      const publicKeys = mutate ? mutate(key) : [{ kid: key.kid, jwk: key.publicJwk }];
      writeFileSync(
        configPath,
        JSON.stringify({ app: "demo", source: { type: "files", dir: sourceDir }, ...(publicKeys && { publicKeys }) }),
      );
      return key;
    };

    it("signs, and the manifest verifies", async () => {
      const key = await withKeys();
      const result = await runBake({ configPath, outDir, env: { [SIGNING_KEY_ENV]: key.secret }, expiresInDays: 7 });
      expect(result).toMatchObject({ ok: true, signedKid: key.kid });
      if (!result.ok) return;
      const manifest = JSON.parse(readFileSync(join(outDir, "manifest", "demo.json"), "utf8"));
      expect(await verifyManifestSignature(manifest, [{ kid: key.kid, jwk: key.publicJwk }])).toEqual({ ok: true });
      const days = (Date.parse(manifest.expiresAt) - Date.parse(manifest.issuedAt)) / 86_400_000;
      expect(days).toBe(7);
      expect(result.expiresAt).toBe(manifest.expiresAt);
      expect(result.sequence).toBe(manifest.sequence);
    });

    it("rejects a kid that is not in publicKeys", async () => {
      const other = await generateSigningKey();
      const key = await withKeys(() => [{ kid: other.kid, jwk: other.publicJwk }]);
      const result = await runBake({ configPath, outDir, env: { [SIGNING_KEY_ENV]: key.secret } });
      expect(result).toMatchObject({ ok: false, exitCode: 2 });
      expect(!result.ok && result.error).toContain("not among publicKeys");
    });

    it("rejects the same kid with a different public key", async () => {
      const other = await generateSigningKey();
      const key = await withKeys((k) => [{ kid: k.kid, jwk: other.publicJwk }]);
      const result = await runBake({ configPath, outDir, env: { [SIGNING_KEY_ENV]: key.secret } });
      expect(result).toMatchObject({ ok: false, exitCode: 2 });
    });

    it("rejects a secret whose declared kid is not the thumbprint of its key, even if publicKeys lists that kid", async () => {
      const key = await generateSigningKey();
      const forged = JSON.parse(Buffer.from(key.secret, "base64url").toString());
      forged.kid = "forged-kid";
      const secret = Buffer.from(JSON.stringify(forged)).toString("base64url");
      writeFileSync(
        configPath,
        JSON.stringify({ app: "demo", source: { type: "files", dir: sourceDir }, publicKeys: [{ kid: "forged-kid", jwk: key.publicJwk }] }),
      );
      const result = await runBake({ configPath, outDir, env: { [SIGNING_KEY_ENV]: secret } });
      expect(result).toMatchObject({ ok: false, exitCode: 2 });
      expect(!result.ok && result.error).toContain("thumbprint");
    });

    it("compares spki entries by public key: same key passes, another key under the same kid fails", async () => {
      const spkiOf = async (jwk: JsonWebKey) =>
        Buffer.from(await crypto.subtle.exportKey("spki", await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"]))).toString("base64url");
      const other = await generateSigningKey();
      const good = await withKeys(() => undefined);
      writeFileSync(configPath, JSON.stringify({ app: "demo", source: { type: "files", dir: sourceDir }, publicKeys: [{ kid: good.kid, spki: await spkiOf(good.publicJwk) }] }));
      expect(await runBake({ configPath, outDir, env: { [SIGNING_KEY_ENV]: good.secret } })).toMatchObject({ ok: true });
      writeFileSync(configPath, JSON.stringify({ app: "demo", source: { type: "files", dir: sourceDir }, publicKeys: [{ kid: good.kid, spki: await spkiOf(other.publicJwk) }] }));
      expect(await runBake({ configPath, outDir, env: { [SIGNING_KEY_ENV]: good.secret } })).toMatchObject({ ok: false, exitCode: 2 });
    });

    it("rejects a config without publicKeys", async () => {
      const key = await withKeys(() => undefined);
      const result = await runBake({ configPath, outDir, env: { [SIGNING_KEY_ENV]: key.secret } });
      expect(result).toMatchObject({ ok: false, exitCode: 2 });
      expect(!result.ok && result.error).toContain("keys init");
    });

    it("rejects a garbage secret without echoing it", async () => {
      const result = await runBake({ configPath, outDir, env: { [SIGNING_KEY_ENV]: "garbage-secret-value" } });
      expect(result).toMatchObject({ ok: false, exitCode: 2 });
      expect(!result.ok && result.error).not.toContain("garbage-secret-value");
    });
  });

  it("printBakeResult sets exit code 2 on any failure and prints signed/unsigned lines", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = undefined;
    printBakeResult({ ok: false, error: "boom" });
    expect(process.exitCode).toBe(2);

    process.exitCode = 0;
    const base = { ok: true as const, app: "demo", locales: ["en"], hashes: { en: "abc" }, deltaCount: 0, sequence: 5, expiresAt: "2030-01-01T00:00:00.000Z" };
    printBakeResult({ ...base, signedKid: "k1" });
    printBakeResult({ ...base, signedKid: null });
    expect(process.exitCode).toBeFalsy();
    const out = log.mock.calls.map((c) => c[0]).join("\n");
    expect(out).toContain("signed: kid k1, sequence 5, expires 2030-01-01T00:00:00.000Z");
    expect(out).toContain("UNSIGNED:");
    log.mockRestore();
    err.mockRestore();
  });
});
