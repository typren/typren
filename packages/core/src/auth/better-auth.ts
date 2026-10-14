import type { AuthAdapter, AuthUser } from "../auth-adapter";
import { checkAllowlist } from "./allowlist";

/** Better Auth's server instance is created per-app, so `getSession` is
 *  injected, not imported, matching next-auth.ts (the host passes e.g.
 *  `() => auth.api.getSession({ headers: await headers() })`). This entry
 *  (`@typren/core/auth/better-auth`) never resolves `better-auth` itself. */
type Session = {
  user?: { id?: string; email?: string; emailVerified?: boolean; name?: string; role?: string | null };
} | null;

/**
 * REQUIRES AN ALLOWLIST: `allowedEmails` or `allowedRoles` must be set, or
 * construction throws. A signed-in session with neither would authorize
 * anyone who can sign in, which is almost never the intended policy for an
 * editor.
 *
 * "admin" is gated separately from ordinary content writes: it needs
 * `adminRoles` set and an intersecting role, full stop. Unmapped denies
 * rather than falling back to `allowedRoles`. A host must opt in to who gets
 * to reconfigure the site.
 *
 * Better Auth's admin plugin stores `session.user.role` as a single string,
 * sometimes comma-separated for multi-role users; `rolesFrom` lets a host
 * override extraction (e.g. a custom field) and defaults to splitting that
 * string on commas.
 */
export function betterAuthAdapter(opts: {
  /** The host's session lookup, e.g. `() => auth.api.getSession({ headers: await headers() })`. */
  getSession: () => Promise<Session>;
  /** Case-insensitive match on session.user.email. */
  allowedEmails?: string[];
  /** Any-intersection with the resolved roles. */
  allowedRoles?: string[];
  /** Any-intersection with the resolved roles, required for the "admin" action. */
  adminRoles?: string[];
  /** Override role extraction from the session. Default: split
   *  `session.user.role` on commas. */
  rolesFrom?: (session: NonNullable<Session>) => string[] | undefined;
}): AuthAdapter {
  if (!opts.allowedEmails?.length && !opts.allowedRoles?.length) {
    throw new Error(
      "typren: betterAuthAdapter requires an allowlist (allowedEmails or allowedRoles); without one any signed-in user could edit"
    );
  }
  const defaultRolesFrom = (s: NonNullable<Session>) =>
    s.user?.role ? s.user.role.split(",").map((r) => r.trim()).filter(Boolean) : undefined;
  // A host-supplied rolesFrom isn't type-checked at runtime; a non-array
  // return (e.g. a single string) must never leak through as "roles", since
  // callers treat `roles` as an array to `.some()` over.
  const rolesFrom = (s: NonNullable<Session>): string[] | undefined => {
    const r = (opts.rolesFrom ?? defaultRolesFrom)(s);
    return Array.isArray(r) ? r : undefined;
  };
  const toUser = (s: Session): AuthUser | null => {
    if (!s?.user?.email && !s?.user?.id) return null;
    return {
      id: s.user!.id ?? s.user!.email!,
      // Only a verified email can satisfy allowedEmails: omitting it here
      // (rather than filtering in checkAllowlist) means an unverified email
      // can never match the allowlist, for this mapping or any other check
      // that reads AuthUser.email.
      email: s.user!.emailVerified === true ? s.user!.email : undefined,
      name: s.user!.name,
      roles: rolesFrom(s),
    };
  };
  return {
    getUser: async () => toUser(await opts.getSession().catch(() => null)),
    authorize: async (ctx) => {
      // Fail closed on any resolution error.
      const u = toUser(await opts.getSession().catch(() => null));
      if (!u) return false;
      return checkAllowlist(u, ctx, opts);
    },
  };
}
