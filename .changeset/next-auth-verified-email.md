---
"@typren/core": patch
---

`nextAuthAdapter` now requires an `isEmailVerified(session)` callback whenever `allowedEmails` is
set, and only lets the session email satisfy the allowlist when it returns `true`. NextAuth's
session carries no verified-email signal, so an address from a provider that never verified it
used to pass. This changes the adapter's API; see `docs/migrations/core-0.5.0.md`.
