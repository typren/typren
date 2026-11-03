import { describe, expect, it } from "vitest";
import {
  generateSigningKey,
  jwkThumbprint,
  manifestSigningInput,
  parseSigningKey,
  parseTrustedKeys,
  signManifest,
  verifyManifestSignature,
} from "./sign";
import type { Manifest, TrustedKey } from "./types";

const base: Manifest = {
  v: 1,
  buildVersion: "v1",
  sequence: 5,
  issuedAt: "2030-01-01T00:00:00.000Z",
  expiresAt: "2030-02-01T00:00:00.000Z",
  apps: { demo: { en: { hash: "aaa", deltas: { old: "bbb" } } } },
};

async function setup() {
  const { kid, publicJwk, secret } = await generateSigningKey();
  const key = parseSigningKey(secret);
  const trusted: TrustedKey[] = [{ kid, jwk: publicJwk }];
  return { kid, publicJwk, secret, key, trusted, signed: await signManifest(base, key) };
}

const b64u = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

describe("signing keys", () => {
  it("round-trips the secret and the kid is the JWK thumbprint", async () => {
    const { kid, publicJwk, key } = await setup();
    expect(key.kid).toBe(kid);
    expect(await jwkThumbprint(publicJwk)).toBe(kid);
    expect(Object.keys(publicJwk).sort()).toEqual(["crv", "kty", "x", "y"]);
  });

  it("rejects garbage, wrong curve and missing d without echoing the input", async () => {
    const { key } = await setup();
    const jwk = (over: object) => b64u(JSON.stringify({ kty: "EC", crv: "P-256", kid: "k", d: "d", x: "x", y: "y", ...over }));
    const inputs = ["not-a-key-SECRET!!", b64u("not json SECRET"), jwk({ crv: "P-384" }), jwk({ d: undefined }), b64u("null")];
    for (const input of inputs) {
      expect(() => parseSigningKey(input)).toThrow(/not a valid signing key/);
      try {
        parseSigningKey(input);
      } catch (error) {
        expect((error as Error).message).not.toContain(input);
      }
    }
    expect(key.privateJwk.d).toBeTruthy();
  });
});

describe("parseSigningKey paste tolerance", () => {
  it("strips a TYPREN_SIGNING_KEY= prefix, whitespace and quotes", async () => {
    const { secret, kid } = await setup();
    for (const v of [`TYPREN_SIGNING_KEY=${secret}`, `  TYPREN_SIGNING_KEY = "${secret}"\n`, `'${secret}'`]) {
      expect(parseSigningKey(v).kid).toBe(kid);
    }
  });
});

describe("undefined members", () => {
  it("a signed manifest with an undefined field still verifies after a JSON round trip", async () => {
    const { key, trusted } = await setup();
    const signed = await signManifest({ ...base, buildVersion: undefined } as unknown as Manifest, key);
    expect(await verifyManifestSignature(JSON.parse(JSON.stringify(signed)), trusted)).toEqual({ ok: true });
  });
});

describe("parseTrustedKeys", () => {
  const jwk = { kty: "EC", crv: "P-256", x: "x", y: "y" };
  it("accepts jwk and spki entries and returns a fresh array", () => {
    const input = [{ kid: "a", jwk }, { kid: "b", spki: "AAAA" }];
    const out = parseTrustedKeys(input);
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
  });

  it("rejects a private jwk and strips extra members", () => {
    expect(() => parseTrustedKeys([{ kid: "a", jwk: { ...jwk, d: "secret" } }])).toThrow(/PRIVATE key/);
    expect(() => parseTrustedKeys([{ kid: "leaky-kid", jwk: { ...jwk, d: "secret" } }])).toThrow(/^(?!.*leaky-kid)/);
    expect(parseTrustedKeys([{ kid: "a", jwk: { ...jwk, ext: true } }])[0]).toEqual({ kid: "a", jwk });
  });

  it.each([
    ["non-array", {}],
    ["empty", []],
    ["duplicate kid", [{ kid: "a", spki: "x" }, { kid: "a", spki: "y" }]],
    ["no kid", [{ jwk }]],
    ["no key material", [{ kid: "a" }]],
    ["wrong curve", [{ kid: "a", jwk: { ...jwk, crv: "P-384" } }]],
    ["null entry", [null]],
  ])("rejects %s", (_name, value) => {
    expect(() => parseTrustedKeys(value)).toThrow(/publicKeys must be a non-empty array/);
  });
});

describe("manifestSigningInput", () => {
  it("is independent of key order and excludes the signature", () => {
    const shuffled = { apps: base.apps, expiresAt: base.expiresAt, issuedAt: base.issuedAt, sequence: base.sequence, buildVersion: "v1", v: 1 } as Manifest;
    const withSig = { ...base, signature: { kid: "k", alg: "ES256", sig: "s" } } as Manifest;
    expect(manifestSigningInput(shuffled)).toEqual(manifestSigningInput(base));
    expect(manifestSigningInput(withSig)).toEqual(manifestSigningInput(base));
  });

  it("covers an own __proto__ key and arrays", () => {
    const evil = JSON.parse('{"v":1,"buildVersion":"v1","apps":{"__proto__":{"x":1}}}') as Manifest;
    const plain = { v: 1, buildVersion: "v1", apps: {} } as Manifest;
    expect(manifestSigningInput(evil)).not.toEqual(manifestSigningInput(plain));
    const arr = { ...base, list: [1, "a"] } as unknown as Manifest;
    expect(new TextDecoder().decode(manifestSigningInput(arr))).toContain('"list":[1,"a"]');
  });
});

describe("signManifest / verifyManifestSignature", () => {
  it("verifies with a jwk key, does not mutate the input, and replaces an old signature", async () => {
    const { key, trusted, signed } = await setup();
    expect(base.signature).toBeUndefined();
    expect(signed.signature?.alg).toBe("ES256");
    expect(await verifyManifestSignature(signed, trusted)).toEqual({ ok: true });
    const resigned = await signManifest(signed, key);
    expect(await verifyManifestSignature(resigned, trusted)).toEqual({ ok: true });
  });

  it("verifies with the same key as spki (base64 and base64url)", async () => {
    const { publicJwk, kid, signed } = await setup();
    const pub = await crypto.subtle.importKey("jwk", publicJwk, { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"]);
    const der = new Uint8Array(await crypto.subtle.exportKey("spki", pub));
    const std = btoa(String.fromCharCode(...der));
    expect(await verifyManifestSignature(signed, [{ kid, spki: std }])).toEqual({ ok: true });
    expect(await verifyManifestSignature(signed, [{ kid, spki: std.replace(/\+/g, "-").replace(/\//g, "_") }])).toEqual({ ok: true });
  });

  it("reports each reason", async () => {
    const { kid, trusted, signed } = await setup();
    const reason = async (m: unknown, t: readonly TrustedKey[] = trusted) => {
      const r = await verifyManifestSignature(m as Manifest, t);
      return r.ok ? "ok" : r.reason;
    };
    const sig = signed.signature!;
    expect(await reason(base)).toBe("unsigned");
    expect(await reason({ ...signed, signature: { ...sig, alg: "none" } })).toBe("unsupported alg");
    for (const bad of [{ sequence: -1 }, { sequence: 1.5 }, { sequence: undefined }, { issuedAt: "nope" }, { expiresAt: undefined }]) {
      expect(await reason({ ...signed, ...bad })).toBe("missing signed fields");
    }
    expect(await reason(signed, [])).toBe(`unknown kid ${kid}`);
    expect(await reason({ ...signed, signature: { ...sig, sig: "AAAA" } })).toBe("malformed signature");
    expect(await reason({ ...signed, signature: { ...sig, sig: "***" } })).toBe("malformed signature");
    expect(await reason({ ...signed, signature: { ...sig, sig: 7 } })).toBe("malformed signature");
    expect(await reason(signed, [{ kid, spki: "AAAA" }])).toBe("key import failed");
    expect(await reason(signed, [{ kid, jwk: { kty: "EC", crv: "P-256", x: "bad", y: "bad" } }])).toBe("key import failed");
    expect(await reason({ ...signed, buildVersion: "evil" })).toBe("bad signature");
    expect(await reason({ ...signed, sequence: 6 })).toBe("bad signature");
    expect(await reason({ ...signed, expiresAt: "2099-01-01T00:00:00.000Z" })).toBe("bad signature");
    expect(await reason({ ...signed, apps: { demo: { en: { hash: "evil", deltas: { old: "bbb" } } } } })).toBe("bad signature");
    expect(await reason({ ...signed, apps: { demo: { en: { hash: "aaa", deltas: { old: "evil" } } } } })).toBe("bad signature");
  });

  it("never throws", async () => {
    const { trusted } = await setup();
    const r = await verifyManifestSignature({ signature: null, ...base, get sequence(): number { throw new Error("boom"); } } as unknown as Manifest, trusted);
    expect(r.ok).toBe(false);
    const r2 = await verifyManifestSignature({ ...base, signature: { kid: "k", alg: "ES256", sig: "x" }, get sequence(): number { throw new Error("boom"); } } as unknown as Manifest, trusted);
    expect(r2).toEqual({ ok: false, reason: "verify error: boom" });
  });
});
