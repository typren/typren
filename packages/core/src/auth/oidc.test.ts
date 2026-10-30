import { describe, expect, it, vi } from "vitest";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { cfAccessAuthAdapter, oidcAuthAdapter } from "./oidc";

const ISSUER = "https://idp.example.com";
const AUDIENCE = "typren-studio";
const DISCOVERY_URL = `${ISSUER}/.well-known/openid-configuration`;
const JWKS_URI = `${ISSUER}/oauth2/v1/keys`;

async function setup() {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test-key";
  jwk.alg = "ES256";
  jwk.use = "sig";

  const fetchMock = vi.fn(async (url: string | URL) => {
    if (String(url) === DISCOVERY_URL) {
      return { status: 200, ok: true, json: async () => ({ issuer: ISSUER, jwks_uri: JWKS_URI }) };
    }
    if (String(url) === JWKS_URI) {
      return { status: 200, json: async () => ({ keys: [jwk] }) };
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  const sign = (overrides: {
    issuer?: string;
    audience?: string;
    exp?: string;
    roles?: string[] | string;
    email?: string;
    emailVerified?: boolean;
    key?: CryptoKey;
    alg?: string;
    noExp?: boolean;
  } = {}) => {
    let jwt = new SignJWT({
      email: overrides.email ?? "user@example.com",
      email_verified: overrides.emailVerified ?? true,
      roles: overrides.roles ?? ["editor"],
    })
      .setProtectedHeader({ alg: overrides.alg ?? "ES256", kid: "test-key" })
      .setSubject("user-1")
      .setIssuer(overrides.issuer ?? ISSUER)
      .setAudience(overrides.audience ?? AUDIENCE);
    if (!overrides.noExp) jwt = jwt.setExpirationTime(overrides.exp ?? "1h");
    return jwt.sign(overrides.key ?? privateKey);
  };

  return { sign, fetchMock, otherKeyPair: await generateKeyPair("ES256", { extractable: true }) };
}

describe("oidcAuthAdapter", () => {
  it("throws at construction without an allowlist", () => {
    expect(() =>
      oidcAuthAdapter({ getToken: async () => null, issuer: ISSUER, audience: AUDIENCE })
    ).toThrow(/requires an allowlist/);
  });

  it("allows a verified token with an allowlisted role, discovering the JWKS URI", async () => {
    const { sign, fetchMock } = await setup();
    const token = await sign();
    const adapter = oidcAuthAdapter({
      getToken: async () => token,
      issuer: ISSUER,
      audience: AUDIENCE,
      allowedRoles: ["editor"],
    });
    expect(await adapter.authorize({ action: "saveDraft", slug: "home" })).toBe(true);
    expect(await adapter.getUser!({ action: "read" })).toEqual({
      id: "user-1",
      email: "user@example.com",
      name: undefined,
      roles: ["editor"],
    });
    expect(fetchMock.mock.calls.some((c) => String(c[0]) === DISCOVERY_URL)).toBe(true);
  });

  it("fetches discovery once across multiple calls", async () => {
    const { sign, fetchMock } = await setup();
    const token = await sign();
    const adapter = oidcAuthAdapter({
      getToken: async () => token,
      issuer: ISSUER,
      audience: AUDIENCE,
      allowedRoles: ["editor"],
    });
    await adapter.authorize({ action: "read" });
    await adapter.authorize({ action: "read" });
    await adapter.getUser!({ action: "read" });
    const discoveryCalls = fetchMock.mock.calls.filter((c) => String(c[0]) === DISCOVERY_URL);
    expect(discoveryCalls.length).toBe(1);
  });

  it("denies and retries on the next call when discovery fetch fails", async () => {
    const token = "irrelevant"; // never reaches verification
    let discoveryCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        if (String(url) === DISCOVERY_URL) {
          discoveryCalls++;
          if (discoveryCalls === 1) return { status: 500, ok: false, json: async () => ({}) };
          return { status: 200, ok: true, json: async () => ({ issuer: ISSUER, jwks_uri: JWKS_URI }) };
        }
        return { status: 200, json: async () => ({ keys: [] }) };
      })
    );
    const adapter = oidcAuthAdapter({
      getToken: async () => token,
      issuer: ISSUER,
      audience: AUDIENCE,
      allowedRoles: ["editor"],
    });
    expect(await adapter.authorize({ action: "read" })).toBe(false);
    // Retried on the next call instead of staying wedged on the first failure.
    expect(await adapter.authorize({ action: "read" }).catch(() => "threw")).toBeDefined();
    expect(discoveryCalls).toBe(2);
  });

  it("denies when the discovery document's jwks_uri isn't https", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        if (String(url) === DISCOVERY_URL) {
          return { status: 200, ok: true, json: async () => ({ issuer: ISSUER, jwks_uri: "http://idp.example.com/keys" }) };
        }
        throw new Error(`unexpected fetch ${url}`);
      })
    );
    const adapter = oidcAuthAdapter({
      getToken: async () => "irrelevant",
      issuer: ISSUER,
      audience: AUDIENCE,
      allowedRoles: ["editor"],
    });
    expect(await adapter.authorize({ action: "read" })).toBe(false);
  });

  it("denies when the discovery document's issuer doesn't match", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        if (String(url) === DISCOVERY_URL) {
          return { status: 200, ok: true, json: async () => ({ issuer: "https://evil.example.com", jwks_uri: JWKS_URI }) };
        }
        throw new Error(`unexpected fetch ${url}`);
      })
    );
    const adapter = oidcAuthAdapter({
      getToken: async () => "irrelevant",
      issuer: ISSUER,
      audience: AUDIENCE,
      allowedRoles: ["editor"],
    });
    expect(await adapter.authorize({ action: "read" })).toBe(false);
  });

  it("fetches discovery without a double slash when the issuer ends in /", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        seen.push(String(url));
        return { status: 500, ok: false, json: async () => ({}) };
      })
    );
    const adapter = oidcAuthAdapter({
      getToken: async () => "irrelevant",
      issuer: `${ISSUER}/`,
      audience: AUDIENCE,
      allowedRoles: ["editor"],
    });
    expect(await adapter.authorize({ action: "read" })).toBe(false);
    expect(seen).toEqual([DISCOVERY_URL]);
  });

  it("skips discovery when jwksUri is given explicitly", async () => {
    const { sign, fetchMock } = await setup();
    const token = await sign();
    const adapter = oidcAuthAdapter({
      getToken: async () => token,
      issuer: ISSUER,
      audience: AUDIENCE,
      jwksUri: JWKS_URI,
      allowedRoles: ["editor"],
    });
    expect(await adapter.authorize({ action: "read" })).toBe(true);
    expect(fetchMock.mock.calls.some((c) => String(c[0]) === DISCOVERY_URL)).toBe(false);
  });

  it("normalizes a singular roles claim string into roles", async () => {
    const { sign } = await setup();
    const token = await sign({ roles: "editor" });
    const adapter = oidcAuthAdapter({
      getToken: async () => token,
      issuer: ISSUER,
      audience: AUDIENCE,
      allowedRoles: ["editor"],
    });
    const user = await adapter.getUser!({ action: "read" });
    expect(user?.roles).toEqual(["editor"]);
  });

  it("denies when the role isn't allowlisted", async () => {
    const { sign } = await setup();
    const token = await sign({ roles: ["viewer"] });
    const adapter = oidcAuthAdapter({
      getToken: async () => token,
      issuer: ISSUER,
      audience: AUDIENCE,
      allowedRoles: ["editor"],
    });
    expect(await adapter.authorize({ action: "saveDraft" })).toBe(false);
  });

  it("gates admin on adminRoles, denying unmapped admin even with a matching allowedRoles", async () => {
    const { sign } = await setup();
    const token = await sign({ roles: ["editor"] });
    const adapter = oidcAuthAdapter({
      getToken: async () => token,
      issuer: ISSUER,
      audience: AUDIENCE,
      allowedRoles: ["editor"],
    });
    expect(await adapter.authorize({ action: "admin" })).toBe(false);

    const withAdmin = oidcAuthAdapter({
      getToken: async () => token,
      issuer: ISSUER,
      audience: AUDIENCE,
      allowedRoles: ["editor"],
      adminRoles: ["editor"],
    });
    expect(await withAdmin.authorize({ action: "admin" })).toBe(true);
  });

  it("rejects a bad signature", async () => {
    const { sign, otherKeyPair } = await setup();
    const token = await sign({ key: otherKeyPair.privateKey });
    const adapter = oidcAuthAdapter({
      getToken: async () => token,
      issuer: ISSUER,
      audience: AUDIENCE,
      allowedRoles: ["editor"],
    });
    expect(await adapter.authorize({ action: "read" })).toBe(false);
  });

  it("rejects the wrong audience", async () => {
    const { sign } = await setup();
    const token = await sign({ audience: "someone-else" });
    const adapter = oidcAuthAdapter({
      getToken: async () => token,
      issuer: ISSUER,
      audience: AUDIENCE,
      allowedRoles: ["editor"],
    });
    expect(await adapter.authorize({ action: "read" })).toBe(false);
  });

  it("rejects the wrong issuer", async () => {
    const { sign } = await setup();
    const token = await sign({ issuer: "https://not-the-idp.example.com" });
    const adapter = oidcAuthAdapter({
      getToken: async () => token,
      issuer: ISSUER,
      audience: AUDIENCE,
      allowedRoles: ["editor"],
    });
    expect(await adapter.authorize({ action: "read" })).toBe(false);
  });

  it("rejects an expired token", async () => {
    const { sign } = await setup();
    const token = await sign({ exp: "-10s" });
    const adapter = oidcAuthAdapter({
      getToken: async () => token,
      issuer: ISSUER,
      audience: AUDIENCE,
      allowedRoles: ["editor"],
    });
    expect(await adapter.authorize({ action: "read" })).toBe(false);
  });

  it("rejects alg:none, refusing to trust an unsigned token", async () => {
    await setup();
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ sub: "user-1", iss: ISSUER, aud: AUDIENCE, exp: Math.floor(Date.now() / 1000) + 3600 })
    ).toString("base64url");
    const token = `${header}.${payload}.`;
    const adapter = oidcAuthAdapter({
      getToken: async () => token,
      issuer: ISSUER,
      audience: AUDIENCE,
      allowedRoles: ["editor"],
    });
    expect(await adapter.authorize({ action: "read" })).toBe(false);
  });

  it("rejects a token with no exp claim", async () => {
    const { sign } = await setup();
    const token = await sign({ noExp: true });
    const adapter = oidcAuthAdapter({
      getToken: async () => token,
      issuer: ISSUER,
      audience: AUDIENCE,
      allowedRoles: ["editor"],
    });
    expect(await adapter.authorize({ action: "read" })).toBe(false);
  });

  it("denies an unverified email against allowedEmails, allows once verified, leaves role-based access unaffected", async () => {
    const { sign } = await setup();
    const unverified = await sign({ emailVerified: false });
    const verified = await sign({ emailVerified: true });

    const byEmail = oidcAuthAdapter({
      getToken: async () => unverified,
      issuer: ISSUER,
      audience: AUDIENCE,
      allowedEmails: ["user@example.com"],
    });
    expect(await byEmail.authorize({ action: "saveDraft" })).toBe(false);
    expect((await byEmail.getUser!({ action: "read" }))?.email).toBeUndefined();

    const byEmailVerified = oidcAuthAdapter({
      getToken: async () => verified,
      issuer: ISSUER,
      audience: AUDIENCE,
      allowedEmails: ["user@example.com"],
    });
    expect(await byEmailVerified.authorize({ action: "saveDraft" })).toBe(true);

    // Role-based access doesn't depend on email verification at all.
    const byRole = oidcAuthAdapter({
      getToken: async () => unverified,
      issuer: ISSUER,
      audience: AUDIENCE,
      allowedRoles: ["editor"],
    });
    expect(await byRole.authorize({ action: "saveDraft" })).toBe(true);
  });

  it("passes an abort signal to the discovery fetch and denies when it fires (simulated timeout)", async () => {
    let sawSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL, init?: { signal?: AbortSignal }) => {
        sawSignal = init?.signal;
        // Simulate the 5s discovery timeout firing without actually waiting:
        // reject as soon as the signal aborts, same as a real hung request.
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          init?.signal?.dispatchEvent(new Event("abort"));
        });
      })
    );
    const adapter = oidcAuthAdapter({
      getToken: async () => "irrelevant",
      issuer: ISSUER,
      audience: AUDIENCE,
      allowedRoles: ["editor"],
    });
    expect(await adapter.authorize({ action: "read" })).toBe(false);
    expect(sawSignal).toBeInstanceOf(AbortSignal);
  });

  it("fails closed when getToken throws", async () => {
    const adapter = oidcAuthAdapter({
      getToken: async () => {
        throw new Error("boom");
      },
      issuer: ISSUER,
      audience: AUDIENCE,
      allowedRoles: ["editor"],
    });
    expect(await adapter.authorize({ action: "read" })).toBe(false);
    expect(await adapter.getUser!({ action: "read" })).toBeNull();
  });

  it("denies when no token is present", async () => {
    const adapter = oidcAuthAdapter({
      getToken: async () => null,
      issuer: ISSUER,
      audience: AUDIENCE,
      allowedRoles: ["editor"],
    });
    expect(await adapter.authorize({ action: "read" })).toBe(false);
    expect(await adapter.getUser!({ action: "read" })).toBeNull();
  });
});

describe("cfAccessAuthAdapter", () => {
  it("derives issuer and JWKS URL from teamDomain and reads groups as roles", async () => {
    const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
    const jwk = await exportJWK(publicKey);
    jwk.kid = "cf-key";
    jwk.alg = "ES256";
    jwk.use = "sig";
    const teamIssuer = "https://acme.cloudflareaccess.com";
    const certsUrl = `${teamIssuer}/cdn-cgi/access/certs`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        if (String(url) === certsUrl) return { status: 200, json: async () => ({ keys: [jwk] }) };
        throw new Error(`unexpected fetch ${url}`);
      })
    );
    const token = await new SignJWT({ groups: ["admin"] })
      .setProtectedHeader({ alg: "ES256", kid: "cf-key" })
      .setSubject("user-1")
      .setIssuer(teamIssuer)
      .setAudience("app-aud")
      .setExpirationTime("1h")
      .sign(privateKey);

    const adapter = cfAccessAuthAdapter({
      teamDomain: "acme",
      audience: "app-aud",
      getToken: async () => token,
      allowedRoles: ["admin"],
    });
    expect(await adapter.authorize({ action: "saveDraft" })).toBe(true);
  });

  it("matches allowedEmails on an Access token, which carries no email_verified claim", async () => {
    const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
    const jwk = await exportJWK(publicKey);
    jwk.kid = "cf-key-3";
    jwk.alg = "ES256";
    jwk.use = "sig";
    const teamIssuer = "https://acme.cloudflareaccess.com";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        if (String(url) === `${teamIssuer}/cdn-cgi/access/certs`) return { status: 200, json: async () => ({ keys: [jwk] }) };
        throw new Error(`unexpected fetch ${url}`);
      })
    );
    const token = await new SignJWT({ email: "Owner@Acme.com" })
      .setProtectedHeader({ alg: "ES256", kid: "cf-key-3" })
      .setSubject("user-1")
      .setIssuer(teamIssuer)
      .setAudience("app-aud")
      .setExpirationTime("1h")
      .sign(privateKey);
    const adapter = cfAccessAuthAdapter({
      teamDomain: "acme",
      audience: "app-aud",
      getToken: async () => token,
      allowedEmails: ["owner@acme.com"],
    });
    expect(await adapter.authorize({ action: "saveDraft" })).toBe(true);
  });

  it("is exempt from the allowlist requirement: Access's own policy already gated the token", async () => {
    const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
    const jwk = await exportJWK(publicKey);
    jwk.kid = "cf-key-2";
    jwk.alg = "ES256";
    jwk.use = "sig";
    const teamIssuer = "https://acme.cloudflareaccess.com";
    const certsUrl = `${teamIssuer}/cdn-cgi/access/certs`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        if (String(url) === certsUrl) return { status: 200, json: async () => ({ keys: [jwk] }) };
        throw new Error(`unexpected fetch ${url}`);
      })
    );
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: "cf-key-2" })
      .setSubject("user-1")
      .setIssuer(teamIssuer)
      .setAudience("app-aud")
      .setExpirationTime("1h")
      .sign(privateKey);

    // No allowedEmails/allowedRoles: must not throw at construction, and
    // must authorize a verified token.
    const adapter = cfAccessAuthAdapter({ teamDomain: "acme", audience: "app-aud", getToken: async () => token });
    expect(await adapter.authorize({ action: "saveDraft" })).toBe(true);
  });

  it("rejects a teamDomain carrying a scheme or path, a trust-boundary input", () => {
    expect(() =>
      cfAccessAuthAdapter({ teamDomain: "acme.com/evil", audience: "a", getToken: async () => null })
    ).toThrow();
    expect(() =>
      cfAccessAuthAdapter({ teamDomain: "https://acme", audience: "a", getToken: async () => null })
    ).toThrow();
  });
});
