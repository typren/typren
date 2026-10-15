---
"@typren/core": patch
---

`clerkAuthAdapter` now binds org roles to an `organizationId` option, required whenever
`allowedRoles` or `adminRoles` is set, and only counts a role while that org is the session's
active org (session token v1 `org_id`/`org_role` and v2 `o.id`/`o.rol` are both read). Before,
any user who created their own organization was its `org:admin` and passed the role checks. The
`"admin"` action also has to pass `allowedUserIds`/`allowedEmails`/`allowedRoles` first now.
This changes the adapter's API; see `docs/migrations/core-0.5.0.md`.
