import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseSigningKey } from "../sign";
import { KEYS_HELP, printKeysResult, runKeys } from "./keys";

describe("runKeys", () => {
  let base: string;
  let repo: string;
  let outside: string;
  let configPath: string;
  const config = { app: "demo", source: { type: "export-api", token: "${TOKEN}" } };

  beforeEach(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), "typren-keys-")));
    repo = join(base, "repo");
    outside = join(base, "outside");
    mkdirSync(join(repo, ".git"), { recursive: true });
    mkdirSync(outside);
    configPath = join(repo, "typren.json");
    writeFileSync(configPath, JSON.stringify(config));
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  const read = () => readFileSync(configPath, "utf8");

  it("init adds a key, keeps the ${TOKEN} placeholder, and returns a usable secret", async () => {
    const result = await runKeys({ action: "init", configPath });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(read()).toContain('"token": "${TOKEN}"');
    expect(parseSigningKey(result.secret!).kid).toBe(result.kid);
    expect(JSON.parse(read()).publicKeys).toEqual([{ kid: result.kid, jwk: expect.objectContaining({ kty: "EC", crv: "P-256" }) }]);
    expect(JSON.parse(read()).publicKeys[0].jwk.d).toBeUndefined();
  });

  it("init twice and rotate-before-init exit 2", async () => {
    expect((await runKeys({ action: "rotate", configPath })).ok).toBe(false);
    await runKeys({ action: "init", configPath });
    expect(await runKeys({ action: "init", configPath })).toMatchObject({ ok: false, exitCode: 2 });
  });

  it("rotate keeps the old key and adds a distinct kid", async () => {
    const first = await runKeys({ action: "init", configPath });
    const second = await runKeys({ action: "rotate", configPath });
    if (!first.ok || !second.ok) throw new Error("expected ok");
    expect(second.publicKeys.map((k) => k.kid)).toEqual([first.kid, second.kid]);
    expect(first.kid).not.toBe(second.kid);
  });

  it("rotate rejects invalid existing publicKeys", async () => {
    writeFileSync(configPath, JSON.stringify({ ...config, publicKeys: [{ kid: "x" }] }));
    expect(await runKeys({ action: "rotate", configPath })).toMatchObject({ ok: false, exitCode: 2 });
  });

  it("refuses --out inside the repository and leaves the config alone", async () => {
    const before = read();
    const result = await runKeys({ action: "init", configPath, out: join(repo, "key.txt") });
    expect(result).toMatchObject({ ok: false, exitCode: 2 });
    expect(read()).toBe(before);
  });

  it("refuses --out via a symlinked dir pointing into the repo", async () => {
    symlinkSync(repo, join(outside, "link"));
    const before = read();
    const result = await runKeys({ action: "init", configPath, out: join(outside, "link", "key.txt") });
    expect(result).toMatchObject({ ok: false, exitCode: 2 });
    expect(read()).toBe(before);
  });

  it("refuses --out inside any git repo, even one unrelated to the config", async () => {
    const other = join(outside, "other");
    mkdirSync(join(other, ".git"), { recursive: true });
    const result = await runKeys({ action: "init", configPath, out: join(other, "key.txt") });
    expect(result).toMatchObject({ ok: false, exitCode: 2 });
  });

  it("writes the key outside the repo with mode 0600 and no secret in the result", async () => {
    const out = join(outside, "key.txt");
    const result = await runKeys({ action: "init", configPath, out });
    if (!result.ok) throw new Error(result.error);
    expect(result.secret).toBeUndefined();
    expect(result.secretPath).toBe(out);
    if (process.platform !== "win32") expect(statSync(out).mode & 0o777).toBe(0o600);
    expect(parseSigningKey(readFileSync(out, "utf8")).kid).toBe(result.kid);
    expect(JSON.parse(read()).publicKeys).toHaveLength(1);
  });

  it("refuses to overwrite an existing --out file and a missing parent", async () => {
    const out = join(outside, "key.txt");
    writeFileSync(out, "x");
    expect(await runKeys({ action: "init", configPath, out })).toMatchObject({ ok: false, error: expect.stringContaining("already exists") });
    expect(await runKeys({ action: "init", configPath, out: join(outside, "nope", "k") })).toMatchObject({ ok: false, exitCode: 2 });
    expect(JSON.parse(read()).publicKeys).toBeUndefined();
  });

  it("uses the config dir as the root when there is no .git", async () => {
    const lone = join(base, "lone");
    mkdirSync(lone);
    const p = join(lone, "c.json");
    writeFileSync(p, JSON.stringify(config));
    expect(await runKeys({ action: "init", configPath: p, out: join(lone, "k") })).toMatchObject({ ok: false });
  });

  it("fails on an invalid config", async () => {
    expect(await runKeys({ action: "init", configPath: join(repo, "missing.json") })).toMatchObject({ ok: false, exitCode: 2 });
  });
});

describe("printKeysResult", () => {
  let log: ReturnType<typeof vi.spyOn>;
  let err: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    log = vi.spyOn(console, "log").mockImplementation(() => {});
    err = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = undefined;
  });
  afterEach(() => {
    log.mockRestore();
    err.mockRestore();
    process.exitCode = undefined;
  });

  const ok = { ok: true as const, action: "rotate" as const, kid: "k1", configPath: "c.json", publicKeys: [] };

  it("json mode emits exactly one parseable stdout line", () => {
    printKeysResult({ ...ok, secret: "S" }, true);
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls[0][0]).kid).toBe("k1");
    expect(process.exitCode).toBe(0);
    printKeysResult({ ok: false, error: "bad", exitCode: 2 }, true);
    expect(process.exitCode).toBe(2);
    expect(err).not.toHaveBeenCalled();
  });

  it("human mode prints the secret only to stdout", () => {
    printKeysResult({ ...ok, secret: "SECRET" }, false);
    const out = log.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(out).toContain("TYPREN_SIGNING_KEY=SECRET");
    expect(out).toContain("Old keys stay trusted");
    expect(err).not.toHaveBeenCalled();
  });

  it("human mode reports a key file, init omits the rotate note, failures go to stderr", () => {
    printKeysResult({ ...ok, action: "init", secretPath: "/k" }, false);
    const out = log.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(out).toContain("Private key written to /k (mode 600)");
    expect(out).not.toContain("Old keys");
    printKeysResult({ ok: false, error: "bad", exitCode: 2 }, false);
    expect(err).toHaveBeenCalledWith("typren-locale keys: bad");
    expect(process.exitCode).toBe(2);
    expect(KEYS_HELP).toContain("keys init|rotate");
  });
});
