import type { AuthAdapter } from "../auth-adapter";
import { auth, currentUser } from "@clerk/nextjs/server";
import { toAsciiLower } from "./allowlist";

type ClerkUserLike = {
  primaryEmailAddress: { emailAddress: string; verification: { status: string | null } | null } | null;
};

/** Only a verified primary email counts: an unverified address is still
 *  changeable by the account holder without reproving ownership, so it can
 *  never satisfy an email allowlist. Mirrors better-auth.ts/next-auth.ts. */
const verifiedPrimaryEmail = (u: ClerkUserLike): string | undefined =>
  u.primaryEmailAddress?.verification?.status === "verified" ? u.primaryEmailAddress.emailAddress : undefined;

type OrgClaims = { org_id?: unknown; org_role?: unknown; o?: { id?: unknown; rol?: unknown } } | null;

/** The active org role, but only while the active org is `organizationId`.
 *  Session token v1 carries `org_id`/`org_role` ("org:admin"); v2 nests them
 *  as `o.id`/`o.rol`, where `rol` drops the "org:" prefix ("admin"), so v2 is
 *  normalized to the v1 form `allowedRoles`/`adminRoles` are written in. A
 *  role in any other org is worthless: anyone who can sign up can create an
 *  org of their own and be its "org:admin". */
const boundOrgRole = (claims: OrgClaims, organizationId: string | undefined): string | undefined => {
  if (!organizationId) return undefined;
  if (typeof claims?.org_id === "string")
    return claims.org_id === organizationId && typeof claims.org_role === "string" ? claims.org_role : undefined;
  const o = claims?.o;
  return o?.id === organizationId && typeof o.rol === "string" ? `org:${o.rol}` : undefined;
};

/**
 * Clerk gate (entry `@typren/core/auth/clerk`, optional peer `@clerk/nextjs`).
 * Unlike next-auth's injected `auth()`, Clerk's `auth()`/`currentUser()` are
 * global request-scoped helpers, so they're imported directly.
 *
 * REQUIRES AN ALLOWLIST: `allowedEmails`, `allowedRoles`, or `allowedUserIds`
 * must be set, or construction throws, matching next-auth.ts/better-auth.ts.
 * `allowedUserIds` counts as an allowlist on its own (a fixed roster of Clerk
 * user ids is a legitimate, closed policy) even with no email/role check.
 *
 * Roles are org-scoped: `allowedRoles`/`adminRoles` require `organizationId`,
 * and a role claim only counts while that org is the session's active org.
 *
 * "admin" (settings/onboarding/bootstrap writes) must first pass the same
 * allowlist as content writes, then also match `adminRoles`. Unmapped (no
 * `adminRoles` configured) denies. A host must opt in to who gets to
 * reconfigure the site.
 */
export function clerkAuthAdapter(
  opts: {
    /** Case-insensitive match on the user's verified primary email. */
    allowedEmails?: string[];
    /** Org role claim, e.g. "org:admin". Requires `organizationId`. */
    allowedRoles?: string[];
    allowedUserIds?: string[];
    /** Org role claim the "admin" action additionally requires, e.g.
     *  "org:admin". Requires `organizationId`. */
    adminRoles?: string[];
    /** The Clerk organization id ("org_...") whose roles count. Required
     *  when `allowedRoles` or `adminRoles` is set. */
    organizationId?: string;
  } = {}
): AuthAdapter {
  if ((opts.allowedRoles?.length || opts.adminRoles?.length) && !opts.organizationId) {
    throw new Error(
      "typren: clerkAuthAdapter allowedRoles/adminRoles require organizationId; without it a role in an org the user created themselves would count"
    );
  }
  if (!opts.allowedEmails?.length && !opts.allowedRoles?.length && !opts.allowedUserIds?.length) {
    throw new Error(
      "typren: clerkAuthAdapter requires an allowlist (allowedEmails, allowedRoles, or allowedUserIds); without one any signed-in user could edit"
    );
  }
  return {
    getUser: async () => {
      const u = await currentUser().catch(() => null);
      return u ? { id: u.id, email: verifiedPrimaryEmail(u), name: u.fullName ?? undefined } : null;
    },
    authorize: async (ctx) => {
      // Fail closed on any resolution error.
      const { userId, sessionClaims } = await auth().catch(() => ({
        userId: null,
        sessionClaims: null,
      }));
      if (!userId) return false;
      const role = boundOrgRole(sessionClaims as OrgClaims, opts.organizationId);
      if (opts.allowedUserIds && !opts.allowedUserIds.includes(userId)) return false;
      if (opts.allowedRoles && (!role || !opts.allowedRoles.includes(role))) return false;
      if (opts.allowedEmails) {
        // allowedUserIds/allowedRoles may already have passed without ever
        // resolving an email; only fetch the full user record when the email
        // allowlist is actually configured.
        const email = verifiedPrimaryEmail((await currentUser().catch(() => null)) ?? { primaryEmailAddress: null });
        const candidate = email != null ? toAsciiLower(email) : null;
        if (candidate == null || !opts.allowedEmails.some((e) => toAsciiLower(e) === candidate)) return false;
      }
      if (ctx.action === "admin") return !!role && !!opts.adminRoles?.includes(role);
      return true;
    },
  };
}
