import type { AuthAdapter, AuthUser } from "../auth-adapter";
import { checkAllowlist } from "./allowlist";

/** next-auth v5's `auth()` is created per-app, so it's injected, not imported.
 *  This entry (`@typren/core/auth/next-auth`) never resolves `next-auth` itself. */
type Session = {
  user?: { id?: string; email?: string; name?: string; roles?: string[] };
} | null;

/**
 * REQUIRES AN ALLOWLIST: `allowedEmails` or `allowedRoles` must be set, or
 * construction throws, matching better-auth.ts. A signed-in session with
 * neither would authorize anyone who can sign in, which is almost never the
 * intended policy for an editor.
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
  if (!opts.allowedEmails?.length && !opts.allowedRoles?.length) {
    throw new Error(
      "typren: nextAuthAdapter requires an allowlist (allowedEmails or allowedRoles); without one any signed-in user could edit"
    );
  }
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
      return checkAllowlist(u, ctx, opts);
    },
  };
}
