---
"@typren/core": patch
---

Fix several `AuthAdapter` review findings:

- OIDC, Better Auth, and Supabase mappings now omit `email` from the
  resolved `AuthUser` unless the provider reports it verified
  (`email_verified`, `session.user.emailVerified`, `email_confirmed_at`), so
  an unverified or unconfirmed email can never match `allowedEmails`.
- `oidcAuthAdapter`'s discovery fetch now times out after 5s instead of
  hanging the adapter open, and `jwtVerify` requires `exp`/`sub` claims.
- Better Auth's `rolesFrom` override normalizes a non-array result to no
  roles instead of leaking a bad shape to callers.
- The allowlist's email comparison is ASCII-only: an email containing a
  non-ASCII character never matches, closing a locale-dependent lowercasing
  mismatch.
