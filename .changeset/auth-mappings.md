---
"@typren/core": minor
---

Add `AuthAdapter` mappings for Better Auth, Supabase, and generic OIDC/JWT
(covering Okta, Entra ID, Auth0, Keycloak, and Google Workspace SSO), plus a
`cfAccessAuthAdapter` preset for Cloudflare Access, so hosts can wire SSO,
passkeys, magic links, and enterprise IdPs without Typren implementing any
login flow itself.
