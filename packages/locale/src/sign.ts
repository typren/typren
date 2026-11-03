import type { Manifest, TrustedKey } from "./types";

export const SIGNING_KEY_ENV = "TYPREN_SIGNING_KEY";

export interface SigningKey {
  kid: string;
  privateJwk: JsonWebKey;
}
export type VerifyManifestResult = { ok: true } | { ok: false; reason: string };

const EC = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGN = { name: "ECDSA", hash: "SHA-256" } as const;

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(str: string): Uint8Array<ArrayBuffer> {
  const std = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(std.padEnd(Math.ceil(std.length / 4) * 4, "="));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function canonical(value: unknown, top: boolean): string {
  if (Array.isArray(value)) return `[${value.map((v) => canonical(v, false)).join(",")}]`;
  if (value && typeof value === "object") {
    const parts: string[] = [];
    for (const key of Object.keys(value).sort()) {
      if (top && key === "signature") continue;
      if ((value as Record<string, unknown>)[key] === undefined) continue;
      parts.push(`${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key], false)}`);
    }
    return `{${parts.join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The exact bytes signed and verified: sorted-key JSON of every own field except `signature` and undefined-valued members (as JSON.stringify drops them). Built by concatenation so a `__proto__` key cannot drop out. */
export function manifestSigningInput(manifest: Manifest): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(canonical(manifest, true));
}

/** RFC 7638 thumbprint (sha256 of {"crv","kty","x","y"} in that order, no whitespace), base64url. */
export async function jwkThumbprint(jwk: JsonWebKey): Promise<string> {
  const json = `{"crv":${JSON.stringify(jwk.crv)},"kty":${JSON.stringify(jwk.kty)},"x":${JSON.stringify(jwk.x)},"y":${JSON.stringify(jwk.y)}}`;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(json));
  return toBase64Url(new Uint8Array(digest));
}

/** New extractable P-256 pair. publicJwk is trimmed to {kty,crv,x,y}; secret = base64url(JSON.stringify({...privateJwk, kid})). */
export async function generateSigningKey(): Promise<{ kid: string; publicJwk: JsonWebKey; secret: string }> {
  const { subtle } = globalThis.crypto;
  const pair = await subtle.generateKey(EC, true, ["sign", "verify"]);
  const privateJwk = await subtle.exportKey("jwk", pair.privateKey);
  const { kty, crv, x, y } = privateJwk;
  const publicJwk: JsonWebKey = { kty, crv, x, y };
  const kid = await jwkThumbprint(publicJwk);
  const secret = toBase64Url(new TextEncoder().encode(JSON.stringify({ ...privateJwk, kid })));
  return { kid, publicJwk, secret };
}

const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/** Decodes a TYPREN_SIGNING_KEY value (a pasted `TYPREN_SIGNING_KEY=` prefix and surrounding quotes are stripped). Throws Error naming the problem, never including the input. */
export function parseSigningKey(secret: string): SigningKey {
  const bad = new Error(`${SIGNING_KEY_ENV} is not a valid signing key (expected the value printed by \`typren-locale keys init\`)`);
  let jwk: Record<string, unknown>;
  try {
    jwk = JSON.parse(new TextDecoder().decode(fromBase64Url(secret.trim().replace(new RegExp(`^${SIGNING_KEY_ENV}\\s*=\\s*`), "").replace(/^(["'])(.*)\1$/s, "$2").trim())));
  } catch {
    throw bad;
  }
  if (!jwk || jwk.kty !== "EC" || jwk.crv !== "P-256" || !isStr(jwk.kid) || !isStr(jwk.d) || !isStr(jwk.x) || !isStr(jwk.y)) {
    throw bad;
  }
  const { kid, ...privateJwk } = jwk;
  return { kid: kid as string, privateJwk: privateJwk as JsonWebKey };
}

/** Validates an untrusted `publicKeys` value; returns a fresh array. */
export function parseTrustedKeys(value: unknown): TrustedKey[] {
  const err = new Error("publicKeys must be a non-empty array of { kid, jwk } or { kid, spki } entries (unique kids; jwk is an EC P-256 public key)");
  if (!Array.isArray(value) || value.length === 0) throw err;
  const seen = new Set<string>();
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || !isStr(entry.kid) || seen.has(entry.kid)) throw err;
    seen.add(entry.kid);
    const { kid, jwk, spki } = entry as { kid: string; jwk?: JsonWebKey; spki?: unknown };
    if (isStr(spki)) return { kid, spki };
    if (jwk && typeof jwk === "object" && "d" in jwk) {
      throw new Error(`publicKeys entry "${kid}" contains a PRIVATE key; remove it from the config and rotate`);
    }
    if (jwk && typeof jwk === "object" && jwk.kty === "EC" && jwk.crv === "P-256" && isStr(jwk.x) && isStr(jwk.y)) {
      return { kid, jwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y } };
    }
    throw err;
  });
}

/** Returns a NEW manifest: input minus any old signature, plus { signature: { kid, alg: "ES256", sig } }. */
export async function signManifest(manifest: Manifest, key: SigningKey): Promise<Manifest> {
  const { subtle } = globalThis.crypto;
  const { kty, crv, x, y, d } = key.privateJwk;
  const priv = await subtle.importKey("jwk", { kty, crv, x, y, d }, EC, false, ["sign"]);
  const rest = { ...manifest };
  delete rest.signature;
  const sig = await subtle.sign(SIGN, priv, manifestSigningInput(rest));
  return { ...rest, signature: { kid: key.kid, alg: "ES256", sig: toBase64Url(new Uint8Array(sig)) } };
}

/** Never throws. */
export async function verifyManifestSignature(manifest: Manifest, trusted: readonly TrustedKey[]): Promise<VerifyManifestResult> {
  try {
    const signature = manifest.signature;
    if (!signature) return { ok: false, reason: "unsigned" };
    if (signature.alg !== "ES256") return { ok: false, reason: "unsupported alg" };
    const { sequence, issuedAt, expiresAt } = manifest;
    if (
      !Number.isSafeInteger(sequence) ||
      (sequence as number) < 0 ||
      typeof issuedAt !== "string" ||
      Number.isNaN(Date.parse(issuedAt)) ||
      typeof expiresAt !== "string" ||
      Number.isNaN(Date.parse(expiresAt))
    ) {
      return { ok: false, reason: "missing signed fields" };
    }
    const key = trusted.find((k) => k.kid === signature.kid);
    if (!key) return { ok: false, reason: `unknown kid ${signature.kid}` };
    let raw: Uint8Array<ArrayBuffer> = new Uint8Array(0);
    try {
      raw = fromBase64Url(signature.sig);
    } catch {
      // length check below reports it
    }
    if (raw.length !== 64) return { ok: false, reason: "malformed signature" };
    const { subtle } = globalThis.crypto;
    let pub: CryptoKey;
    try {
      pub =
        "jwk" in key
          ? await subtle.importKey("jwk", { kty: key.jwk.kty, crv: key.jwk.crv, x: key.jwk.x, y: key.jwk.y }, EC, false, ["verify"])
          : await subtle.importKey("spki", fromBase64Url(key.spki), EC, false, ["verify"]);
    } catch {
      return { ok: false, reason: "key import failed" };
    }
    const ok = await subtle.verify(SIGN, pub, raw, manifestSigningInput(manifest));
    return ok ? { ok: true } : { ok: false, reason: "bad signature" };
  } catch (error) {
    return { ok: false, reason: `verify error: ${(error as Error).message}` };
  }
}
