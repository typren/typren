import type { AuthAdapter, AuthUser } from "../auth-adapter";

/** next-auth v5's `auth()` is created per-app, so it's injected, not imported.
 *  This entry (`@typren/core/auth/next-auth`) never resolves `next-auth` itself. */
type Session = {
  user?: { id?: string; email?: string; name?: string; roles?: string[] };
} | null;

/**
 * DEFAULT-OPEN CAVEAT: with neither `allowedEmails` nor `allowedRoles` set,
 * ANY signed-in user is authorized. For a public editor that is almost never
 * what you want. Require at least one allowlist in production.
 *
 * "admin" (settings/onboarding/bootstrap writes; they reparameterize what the
 * next boot trusts) is gated separately from ordinary content writes: it needs
 * `adminRoles` set and an intersecting role, full stop. Unmapped (no
 * `adminRoles` configured) denies rather than falling back to `allowedRoles`.
 * A host must opt in to who gets to reconfigure the site.
 */
export function nextAuthAdapter(opts: {
  /** The host's `auth` from `NextAuth(config)` (reads the session cookie). */
  auth: () => Promise<Session>;
  /** Case-insensitive match on session.user.email. */
  allowedEmails?: string[];
  /** Any-intersection with session.user.roles. */
  allowedRoles?: string[];
  /** Any-intersection with session.user.roles, required for the "admin" action. */
  adminRoles?: string[];
}): AuthAdapter {
  const toUser = (s: Session): AuthUser | null =>
    s?.user?.email || s?.user?.id
      ? {
          id: s.user!.id ?? s.user!.email!,
          email: s.user!.email,
          name: s.user!.name,
          roles: s.user!.roles,
        }
      : null;
  return {
    getUser: async () => toUser(await opts.auth()),
    authorize: async (ctx) => {
      // Fail closed on any resolution error.
      const u = toUser(await opts.auth().catch(() => null));
      if (!u) return false;
      if (ctx.action === "admin")
        return !!opts.adminRoles?.length && (u.roles?.some((r) => opts.adminRoles!.includes(r)) ?? false);
      const emailOk =
        !opts.allowedEmails ||
        (u.email != null &&
          opts.allowedEmails.some((e) => e.toLowerCase() === u.email!.toLowerCase()));
      const roleOk =
        !opts.allowedRoles || (u.roles?.some((r) => opts.allowedRoles!.includes(r)) ?? false);
      return emailOk && roleOk;
    },
  };
}
