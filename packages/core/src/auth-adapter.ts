/**
 * Pluggable auth, analogous to `ContentAdapter`. Named `auth-adapter.ts` (not
 * `auth.ts` + `auth/` dir) to follow the existing `editor.ts`-vs-`ui/` no-clash
 * convention.
 */

/** What a handler is attempting. Lets an adapter allow reads but gate writes,
 *  or do per-slug / per-role checks. */
export type AuthAction =
  | "read"
  | "saveDraft"
  | "discardDraft"
  | "publish"
  | "createPage"
  | "renamePage"
  | "deletePage"
  | "uploadMedia"
  | "deleteMedia"
  /** Site-reconfiguration: bootstrap writes, settings-doc writes, onboarding
   *  writes. Distinct from the content-write actions above so a host can grant
   *  page-editing without granting site-reconfiguration (they reparameterize
   *  what the next boot trusts). */
  | "admin";

export type AuthContext = {
  action: AuthAction;
  /** Target slug when the action has one (undefined for "read" of the index / createPage). */
  slug?: string;
  /** Hosted-platform tenant scope, resolved server-side (session -> user ->
   *  account -> membership -> site) and NEVER taken from client input.
   *  Optional: a single-site local/self-host config omits both and every
   *  existing adapter keeps working unchanged. A hosted `authorize()` uses
   *  these to make cross-tenant access structurally impossible to forget
   *  rather than merely documented (docs/hosted-platform.md, "Tenant
   *  isolation"). */
  siteId?: string;
  accountId?: string;
};

/** Normalized identity. Adapters map their lib's user onto this. */
export type AuthUser = {
  id: string;
  email?: string;
  name?: string;
  roles?: string[];
};

/** Analogous to ContentAdapter: the only thing that knows how identity is
 *  resolved and what it's allowed to do. Adapters read the request themselves
 *  (App Router: `cookies()`/`headers()` via their auth lib). No request object
 *  is plumbed through, matching how next-auth v5 `auth()` and Clerk `auth()`
 *  work inside server actions/components. */
export interface AuthAdapter {
  /** Resolve the current user, or null if unauthenticated. Optional: adapters
   *  that only make an allow/deny decision (dev-local) may omit it. */
  getUser?(ctx: AuthContext): Promise<AuthUser | null>;
  /** Allow/deny this action. MUST fail closed on any error. */
  authorize(ctx: AuthContext): Promise<boolean>;
}

/** Back-compat shim: wraps the legacy zero-arg `CmsConfig.authorize()` closure
 *  as an adapter so old configs keep working unchanged. */
export function legacyAuthAdapter(fn: () => boolean | Promise<boolean>): AuthAdapter {
  return { authorize: async () => Boolean(await fn()) };
}

/** Single resolution point used by BOTH the action guard and the layout gate,
 *  so they can never diverge. Throws at construction if a config has neither. */
export function resolveAuth(config: {
  auth?: AuthAdapter;
  authorize?: () => boolean | Promise<boolean>;
}): AuthAdapter {
  if (config.auth) return config.auth;
  if (config.authorize) return legacyAuthAdapter(config.authorize);
  throw new Error("typren: CmsConfig needs either `auth` (AuthAdapter) or `authorize`");
}
