import type { AuthAdapter } from "../auth-adapter";
import { auth, currentUser } from "@clerk/nextjs/server";

/**
 * Clerk gate (entry `@typren/core/auth/clerk`, optional peer `@clerk/nextjs`).
 * Unlike next-auth's injected `auth()`, Clerk's `auth()`/`currentUser()` are
 * global request-scoped helpers, so they're imported directly.
 *
 * "admin" (settings/onboarding/bootstrap writes) is gated separately from
 * ordinary content writes: it needs `adminRoles` set and a matching org role
 * claim, full stop. Unmapped (no `adminRoles` configured) denies rather than
 * falling back to `allowedRoles`/`allowedUserIds`. A host must opt in to who
 * gets to reconfigure the site.
 */
export function clerkAuthAdapter(
  opts: {
    /** Org role claim, e.g. "org:admin". */
    allowedRoles?: string[];
    allowedUserIds?: string[];
    /** Org role claim required for the "admin" action, e.g. "org:admin". */
    adminRoles?: string[];
  } = {}
): AuthAdapter {
  return {
    getUser: async () => {
      const u = await currentUser().catch(() => null);
      return u
        ? { id: u.id, email: u.emailAddresses[0]?.emailAddress, name: u.fullName ?? undefined }
        : null;
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
      if (opts.allowedRoles) {
        if (!role || !opts.allowedRoles.includes(role)) return false;
      }
      return true;
    },
  };
}
