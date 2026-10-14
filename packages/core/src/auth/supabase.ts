import type { AuthAdapter, AuthUser } from "../auth-adapter";
import { checkAllowlist } from "./allowlist";

/** Structural shape of the subset of `@supabase/supabase-js`'s client this
 *  adapter calls, so core never imports or depends on the real package (the
 *  host's own `createClient(...)` satisfies this). Deliberately uses
 *  `getUser()`, which revalidates the token against Supabase's server, not
 *  `getSession()`, which only reads the (client-forgeable) local cookie. */
type SupabaseClient = {
  auth: {
    getUser(): Promise<{
      data: { user: SupabaseUser | null };
      error: unknown;
    }>;
  };
};

export type SupabaseUser = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown>;
  app_metadata?: { roles?: string[]; role?: string } & Record<string, unknown>;
};

/**
 * REQUIRES AN ALLOWLIST: `allowedEmails` or `allowedRoles` must be set, or
 * construction throws. A signed-in user with neither would authorize anyone
 * who can sign in, which is almost never the intended policy for an editor.
 *
 * "admin" is gated separately from ordinary content writes: it needs
 * `adminRoles` set and an intersecting role, full stop. Unmapped denies
 * rather than falling back to `allowedRoles`.
 *
 * SECURITY: roles are read ONLY from `user.app_metadata` (`roles` array or
 * singular `role`), never `user_metadata`. Supabase lets the signed-in user
 * write their own `user_metadata` from the client; trusting it for
 * authorization would let any user grant themselves roles. `app_metadata` is
 * writable only via the service-role key, server-side.
 */
export function supabaseAuthAdapter(opts: {
  /** The host's Supabase client, e.g. from `createServerClient(...)`. */
  client: SupabaseClient;
  /** Case-insensitive match on user.email. */
  allowedEmails?: string[];
  /** Any-intersection with app_metadata roles. */
  allowedRoles?: string[];
  /** Any-intersection with app_metadata roles, required for the "admin" action. */
  adminRoles?: string[];
}): AuthAdapter {
  if (!opts.allowedEmails?.length && !opts.allowedRoles?.length) {
    throw new Error(
      "typren: supabaseAuthAdapter requires an allowlist (allowedEmails or allowedRoles); without one any signed-in user could edit"
    );
  }
  const rolesOf = (u: SupabaseUser): string[] | undefined => {
    const r = u.app_metadata?.roles;
    if (Array.isArray(r)) return r;
    return u.app_metadata?.role ? [u.app_metadata.role] : undefined;
  };
  const toUser = (u: SupabaseUser | null): AuthUser | null =>
    u ? { id: u.id, email: u.email ?? undefined, roles: rolesOf(u) } : null;
  const resolve = async (): Promise<SupabaseUser | null> => {
    const { data, error } = await opts.client.auth.getUser();
    if (error) return null;
    return data.user;
  };
  return {
    getUser: async () => toUser(await resolve().catch(() => null)),
    authorize: async (ctx) => {
      // Fail closed on any resolution error.
      const u = toUser(await resolve().catch(() => null));
      if (!u) return false;
      return checkAllowlist(u, ctx, opts);
    },
  };
}
