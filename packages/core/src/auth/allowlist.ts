import type { AuthContext, AuthUser } from "../auth-adapter";

/**
 * Shared email/role/admin allowlist check, extracted from next-auth.ts so the
 * four mappings that need it (next-auth, better-auth, supabase, oidc) don't
 * reimplement it. Not a subpath export: internal to `auth/`.
 *
 * DEFAULT-OPEN CAVEAT: with neither `allowedEmails` nor `allowedRoles` set,
 * ANY resolved user is authorized. For a public editor that is almost never
 * what you want. Require at least one allowlist in production.
 *
 * "admin" (settings/onboarding/bootstrap writes; they reparameterize what the
 * next boot trusts) is gated separately from ordinary content writes: it needs
 * `adminRoles` set and an intersecting role, full stop. Unmapped (no
 * `adminRoles` configured) denies rather than falling back to `allowedRoles`.
 * A host must opt in to who gets to reconfigure the site.
 */
// ASCII-only lowercasing for the allowlist compare: `String.toLowerCase()` is
// locale-sensitive for a few codepoints (e.g. Turkish dotless i), which could
// make an email compare unequal or equal depending on the host's locale. An
// email containing any non-ASCII byte is deliberately never matched, rather
// than risk a locale-dependent false match.
export const toAsciiLower = (s: string): string | null => {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code > 0x7f) return null;
    out += code >= 65 && code <= 90 ? s[i].toLowerCase() : s[i];
  }
  return out;
};

export function checkAllowlist(
  u: AuthUser,
  ctx: AuthContext,
  opts: { allowedEmails?: string[]; allowedRoles?: string[]; adminRoles?: string[] }
): boolean {
  if (ctx.action === "admin")
    return !!opts.adminRoles?.length && (u.roles?.some((r) => opts.adminRoles!.includes(r)) ?? false);
  const emailOk =
    !opts.allowedEmails ||
    (() => {
      const candidate = u.email != null ? toAsciiLower(u.email) : null;
      if (candidate == null) return false;
      return opts.allowedEmails!.some((e) => toAsciiLower(e) === candidate);
    })();
  const roleOk = !opts.allowedRoles || (u.roles?.some((r) => opts.allowedRoles!.includes(r)) ?? false);
  return emailOk && roleOk;
}
