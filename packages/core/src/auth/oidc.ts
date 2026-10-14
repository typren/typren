import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AuthAdapter, AuthUser } from "../auth-adapter";
import { checkAllowlist } from "./allowlist";

/** Signature algorithms accepted for verification. Asymmetric only: a token
 *  signed with the issuer's private key. Never `none` or an `HS*` shared-secret
 *  algorithm, those let anyone who can read the (public) client config forge
 *  a token signed with it. */
const ASYMMETRIC_ALGS = [
  "RS256",
  "RS384",
  "RS512",
  "PS256",
  "PS384",
  "PS512",
  "ES256",
  "ES256K",
  "ES384",
  "ES512",
  "EdDSA",
];

type Claims = Record<string, unknown> & { sub?: string; email?: string; name?: string };

/**
 * Generic OIDC/JWT gate (entry `@typren/core/auth/oidc`, peer `jose`). Covers
 * any IdP that hands the host a bearer JWT: Okta, Entra ID, Auth0, Keycloak,
 * Google Workspace SSO. The host reads the token out of its own
 * header/cookie and injects `getToken`, same reasoning as next-auth's
 * injected `auth()`: core never terminates a login flow or imports an IdP
 * SDK.
 *
 * Verifies the signature against the issuer's remote JWKS (resolved once per
 * adapter instance and cached/rotated by `jose`'s `createRemoteJWKSet`, not
 * refetched per request) plus `iss`/`aud`/`exp`. Without an explicit
 * `jwksUri`, the JWKS location is found via standard OIDC discovery: a lazy,
 * cached-once fetch of `${issuer}/.well-known/openid-configuration` on the
 * first `authorize()`/`getUser()` call, reading its `jwks_uri` (required to
 * be `https:`, since an http one would let a network attacker point
 * verification at their own keys). A discovery failure clears the cache so
 * the next call retries rather than wedging the adapter open or closed
 * forever on a transient outage; `authorize()` still fails closed for that
 * call like any other verification error. Pass `jwksUri` explicitly to skip
 * discovery entirely (`cfAccessAuthAdapter` below always does, Access's JWKS
 * endpoint isn't behind discovery).
 *
 * REQUIRES AN ALLOWLIST: `allowedEmails` or `allowedRoles` must be set, or
 * construction throws. A verified token with neither would authorize anyone
 * who can sign in with the IdP, which is almost never the intended policy
 * for an editor.
 *
 * "admin" is gated separately from ordinary content writes: it needs
 * `adminRoles` set and an intersecting role, full stop. Unmapped denies
 * rather than falling back to `allowedRoles`.
 */
type OidcOpts = {
  /** Reads the bearer token from the host's own request, e.g. the
   *  `Authorization` header. Returns null when absent. */
  getToken: () => Promise<string | null>;
  /** Expected `iss` claim, and the default JWKS host. */
  issuer: string;
  /** Expected `aud` claim. */
  audience: string;
  /** Default: resolved via OIDC discovery (`${issuer}/.well-known/openid-configuration`'s `jwks_uri`). */
  jwksUri?: string;
  /** Claim holding roles, normalized to string[] (string -> `[value]`). Default `"roles"`. */
  rolesClaim?: string;
  /** Claim holding the email. Default `"email"`. */
  emailClaim?: string;
  /** Case-insensitive match on the resolved email. */
  allowedEmails?: string[];
  /** Any-intersection with the resolved roles. */
  allowedRoles?: string[];
  /** Any-intersection with the resolved roles, required for the "admin" action. */
  adminRoles?: string[];
};

export function oidcAuthAdapter(opts: OidcOpts): AuthAdapter {
  if (!opts.allowedEmails?.length && !opts.allowedRoles?.length) {
    throw new Error(
      "typren: oidcAuthAdapter requires an allowlist (allowedEmails or allowedRoles); without one any signed-in user could edit"
    );
  }
  return buildOidcAdapter(opts);
}

/** Shared construction, without the allowlist requirement: `cfAccessAuthAdapter`
 *  calls this directly (see its own doc comment for why it's exempt). */
function buildOidcAdapter(opts: OidcOpts): AuthAdapter {
  const rolesClaim = opts.rolesClaim ?? "roles";
  const emailClaim = opts.emailClaim ?? "email";

  // Resolved lazily (first authorize()/getUser() call) and cached for the
  // adapter's lifetime. A discovery failure clears discoveryPromise so the
  // next call retries instead of wedging the adapter on a transient outage;
  // `jwks` is only ever set after discovery (or an explicit jwksUri)
  // succeeds, so it never needs clearing itself.
  let discoveryPromise: Promise<string> | undefined;
  let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
  const resolveJwksUri = (): Promise<string> => {
    if (opts.jwksUri) return Promise.resolve(opts.jwksUri);
    if (!discoveryPromise) {
      discoveryPromise = (async () => {
        // Some issuers end in "/" (Auth0); strip it for the URL only, since
        // jwtVerify still matches `iss` against the issuer exactly as given.
        const res = await fetch(`${opts.issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`);
        if (!res.ok) throw new Error(`typren: OIDC discovery failed for ${opts.issuer} (${res.status})`);
        const doc = (await res.json()) as { issuer?: unknown; jwks_uri?: unknown };
        // OIDC Discovery 1.0 section 4.3: the document's issuer MUST equal the one it was fetched for.
        if (doc.issuer !== opts.issuer) throw new Error(`typren: OIDC discovery issuer mismatch for ${opts.issuer}`);
        if (typeof doc.jwks_uri !== "string" || !doc.jwks_uri.startsWith("https://")) {
          throw new Error(`typren: OIDC discovery document for ${opts.issuer} has no https jwks_uri`);
        }
        return doc.jwks_uri;
      })().catch((err) => {
        discoveryPromise = undefined;
        throw err;
      });
    }
    return discoveryPromise;
  };
  const getJwks = async (): Promise<ReturnType<typeof createRemoteJWKSet>> => {
    if (!jwks) jwks = createRemoteJWKSet(new URL(await resolveJwksUri()));
    return jwks;
  };

  const rolesOf = (claims: Claims): string[] | undefined => {
    const r = claims[rolesClaim];
    if (Array.isArray(r)) return r.filter((x): x is string => typeof x === "string");
    if (typeof r === "string") return [r];
    return undefined;
  };
  const toUser = (claims: Claims): AuthUser | null => {
    if (!claims.sub) return null;
    const email = typeof claims[emailClaim] === "string" ? (claims[emailClaim] as string) : undefined;
    return { id: claims.sub, email, name: claims.name, roles: rolesOf(claims) };
  };
  const resolve = async (): Promise<Claims | null> => {
    const token = await opts.getToken();
    if (!token) return null;
    const keySet = await getJwks();
    const { payload } = await jwtVerify(token, keySet, {
      issuer: opts.issuer,
      audience: opts.audience,
      algorithms: ASYMMETRIC_ALGS,
    });
    return payload as Claims;
  };
  return {
    getUser: async () => {
      const claims = await resolve().catch(() => null);
      return claims ? toUser(claims) : null;
    },
    authorize: async (ctx) => {
      // Fail closed on any resolution/verification error (bad signature,
      // wrong iss/aud, expired, malformed).
      const claims = await resolve().catch(() => null);
      if (!claims) return false;
      const u = toUser(claims);
      if (!u) return false;
      return checkAllowlist(u, ctx, opts);
    },
  };
}

/**
 * Cloudflare Access preset over the same verification `oidcAuthAdapter` uses.
 * Access issues its own JWT (the `Cf-Access-Jwt-Assertion` header, still
 * injected via `getToken`, core never reads headers itself) signed by the
 * team's own JWKS; issuer and JWKS URL are both derived from `teamDomain`, so
 * a host only supplies the team name and the application's `aud` tag.
 *
 * EXEMPT FROM THE ALLOWLIST REQUIREMENT: unlike a bare OIDC provider, Access
 * only issues this token after its own per-application policy (the set of
 * emails/groups/IdPs an admin configured for this `aud`) already let the
 * request through; a verified token here is already allowlisted, by Access
 * itself. `allowedEmails`/`allowedRoles` remain available for a second,
 * narrower tier inside Typren.
 */
export function cfAccessAuthAdapter(opts: {
  /** The Cloudflare Access team name, e.g. `"acme"` for `acme.cloudflareaccess.com`.
   *  Must be a bare hostname label: no scheme, slashes or dots. */
  teamDomain: string;
  /** The Access application's `aud` tag. */
  audience: string;
  getToken: () => Promise<string | null>;
  /** Claim holding roles. Default `"groups"` (Access's group-membership claim). */
  rolesClaim?: string;
  emailClaim?: string;
  allowedEmails?: string[];
  allowedRoles?: string[];
  adminRoles?: string[];
}): AuthAdapter {
  // Trust boundary: teamDomain feeds directly into the issuer/JWKS URL below,
  // so a value smuggling a scheme or path could redirect verification at a
  // host-controlled URL.
  if (!/^[a-zA-Z0-9-]+$/.test(opts.teamDomain)) {
    throw new Error(`typren: cfAccessAuthAdapter teamDomain must be a bare hostname label, got "${opts.teamDomain}"`);
  }
  const issuer = `https://${opts.teamDomain}.cloudflareaccess.com`;
  return buildOidcAdapter({
    ...opts,
    issuer,
    jwksUri: `${issuer}/cdn-cgi/access/certs`,
    rolesClaim: opts.rolesClaim ?? "groups",
  });
}
