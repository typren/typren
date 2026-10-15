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
 * "admin" (settings/onboarding/bootstrap writes) is gated separately from
 * ordinary content writes: it needs `adminRoles` set and a matching org role
 * claim, full stop. Unmapped (no `adminRoles` configured) denies rather than
 * falling back to `allowedRoles`/`allowedUserIds`. A host must opt in to who
 * gets to reconfigure the site.
 */
export function clerkAuthAdapter(
  opts: {
    /** Case-insensitive match on the user's verified primary email. */
    allowedEmails?: string[];
    /** Org role claim, e.g. "org:admin". */
    allowedRoles?: string[];
    allowedUserIds?: string[];
    /** Org role claim required for the "admin" action, e.g. "org:admin". */
    adminRoles?: string[];
  } = {}
): AuthAdapter {
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
      const role = (sessionClaims as { org_role?: string } | null)?.org_role;
      if (ctx.action === "admin") return !!opts.adminRoles?.length && !!role && opts.adminRoles.includes(role);
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
      return true;
    },
  };
}
