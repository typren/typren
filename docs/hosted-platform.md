# Hosted platform (Typren) — design doc

**Status: plan, not shipped.** Nothing on this page describes current behavior.
It records the architecture agreed for turning this package into Typren — an
open-source site builder with an optional hosted control plane — and the
specific changes to `src/` that model requires. Code still says `meditor`
throughout; the rename is the last section.

> **Status update 2026-08-25** — written pre-rename in the meditor repo; now
> lives here. Since then: the rename shipped (`@typren/core` + `typren` CLI on
> npm at 0.1.2; symbols are `createTyprenApi`/`createTyprenClient`), the CLA +
> `cla-signatures` infrastructure is live, and dual licensing is in place — the
> AGPL/CLA section below is handled. `@typren/editor` remains private and
> unpublished. The pre-work checklist at the end is still fully open (verified
> against core 0.1.2). **Part II** below extends the plan with the platform
> scope agreed 2026-08-25.

Read `architecture.md` first. This doc only covers what the hosted model adds
on top of that seam.

## The product model

Three tiers, one editor, following the Unifi shape rather than the WordPress
one:

| Tier | Where the admin runs | Who runs the customer's build | Cost |
|---|---|---|---|
| Local | their machine | them | free, no account |
| Cloud (free) | our infrastructure | them (their own CI/host) | free |
| Managed | our infrastructure | **us** | paid |

The split between the free and managed tiers is not a feature gate, it is a
security boundary: the free tier never executes customer code, it only writes
to their GitHub repo. The managed tier runs `install` + `build` on their
repository, which is arbitrary code execution by design and needs real
sandboxing (ephemeral per-build containers, no shared secrets, no network path
back to the control plane). Price accordingly — that tier is where the
operational cost actually lives.

Content always lives in the customer's own GitHub repository. We are never the
system of record for their site. That is the core promise, and most of the
security posture below follows from it.

## Why a centrally-hosted dashboard works at all

The Lit shell renders from data, not from the customer's code. `registry`
(React `ComponentType`s) appears only as an optional field for React hosts
(`sections.ts`) — no `*.element.ts` consumes it. Everything the shell paints
comes from serializable input: the sections config, `fieldSchema`, content
JSON, and the media list. So a dashboard served from our origin can drive a
customer's site without ever loading their components.

Three things do not survive the move, and each needs work:

### 1. Preview is same-origin locked

`ui/preview-bridge.vanilla.ts` refuses any message whose origin is not its own,
and both senders post to `window.location.origin`. That is deliberate — the
preview frame can be embedded, so it should only take instructions from its own
origin. But a hosted dashboard framing the customer's site is cross-origin by
definition, so preview does not work as written.

This is the largest single code change the hosted model forces. It needs a
real allowlisted-origin handshake: the dashboard learns the site's preview
origin from the site record, passes it explicitly to the bridge, and both sides
compare against that value instead of `location.origin`. It must not become
`postMessage(..., "*")` — this is the one place where the hosted model requires
*loosening* an existing control, so it deserves proportionate care.

### 2. `fieldSchema` is TypeScript in the customer's repo

The hosted dashboard needs it as data. Without it, controls auto-detect from
values, which works but is a downgrade. Needs a serializable form we can read
from the repo alongside the content.

### 3. Custom sections ship code

A section with `mount` or `host: true` (`sections.ts`) is a customer-authored
renderer. We cannot run it. Those stay local-only until there is a plugin
story.

## Identity: two planes

The tempting model — "multiple editors means multiple GitHub accounts" — does
not work, for a reason that is easy to miss: **the GitHub App installation is
scoped to the repository, not to a user.** Commits made through the App are
made by the App identity regardless of which human clicked Publish, and GitHub
does not enforce per-editor permissions on App writes. Wiring editors to GitHub
accounts would produce the appearance of GitHub-backed authorization while the
actual write is one machine identity. That is worse than no check, because it
looks like one.

It also defeats the product. The competitor is WordPress: add user, pick role,
done. Requiring a marketing coordinator to hold a GitHub account and a
collaborator invite hands the account back to WordPress.

So identity splits in two:

- **Repo-access plane** — one GitHub App installation per repository. A machine
  capability: "this service may write `content/**` in this repo." Exactly one
  human needs a GitHub account: the owner who installs the App at signup.
- **Editor plane** — our own user directory. Who may sign into site X's
  dashboard and what they may do there. GitHub never sees these people.

The App is the *capability*; our authorization decides who may exercise it.

Developers are the exception that proves the split: people editing slice
components, running the local admin, or reviewing content PRs are ordinary repo
collaborators through GitHub as usual. Two audiences, two planes.

### Attribution

Do not let a single bot identity erase authorship. Set the commit **author** to
the editor's name and email while the **committer** stays the App. History then
reads "Sarah — updated pricing headline", committed by `typren[bot]`, with no
GitHub account for Sarah.

Caveat: an author email we set is unverified, so git is corroboration rather
than proof. Our own append-only auth log stays the authoritative audit trail.

## Permissions without a database

Two kinds of state, and only one fits in git:

- **Policy** — who is in which group, what each group may do. Slow-changing,
  reviewable, belongs in the repo.
- **Identity** — sessions, credentials, revocation, invite tokens.
  Fast-changing, secret-bearing. Cannot go in git.

Policy is fully file-based. Identity is database-free only by *not building
auth ourselves*.

### The policy file

`AuthAction` in `auth-adapter.ts` is already the permission vocabulary, and
`AuthUser.roles` is already plumbed. Nothing new needs inventing:

```yaml
# .typren/access.yml — repo root, NOT under content/
groups:
  admin:  [admin, publish, saveDraft, createPage, deletePage, uploadMedia, deleteMedia]
  editor: [publish, saveDraft, createPage, uploadMedia]
  writer: [saveDraft]                  # drafts only — cannot publish
members:
  sarah@acme.com: editor
  "*@acme.com":   writer               # domain default
```

Scoping a group to sections later is additive (`writer: {actions: [saveDraft],
sections: [blog]}`), since sections already carry stable ids.

The same file governs local, cloud, and self-host, so roles are a portable
artifact and moving between tiers does not re-do permissions.

### The escalation trap

**The policy file must live outside everything the dashboard can write.** If an
Editor can write where the policy lives, an Editor can promote themselves to
Admin, and one bug in the admin gate is a full compromise.

Specifically: **not** `meditor.config.json`. That file is dashboard-writable
today — `api/routes.ts` lets any `admin` action patch it via `writeBootstrap`.

The fix is structural rather than careful coding. The GitHub adapter's path
allowlist confines writes to `content/**` and the media directory; putting the
policy at `.typren/access.yml` places it outside that allowlist, making
escalation-through-the-dashboard impossible by construction.

The cost is real and deliberate: there is no "invite user" button. Role changes
are a commit — PR-reviewed, audited, owner-gated. For a control of this
consequence that is arguably correct, but it is a UX tradeoff, not a free win.

### Compose identity and policy — do not fuse them

The existing adapters fuse the two jobs, and have already drifted apart because
of it. `auth/next-auth.ts` resolves the session *and* owns `allowedEmails` /
`allowedRoles` / `adminRoles` / the admin gate. `auth/local.ts` deliberately has
a single tier and does not branch on `ctx.action` at all.

Adding a file-based group policy inside each adapter would be a third copy of
the permission logic, and would mean "opt into SSO" silently means "opt out of
groups". Instead, stack them:

```ts
// identity: who is this?  (next-auth, clerk, oidc, magic link, our cloud IdP)
// policy:   what may they do?  (access.yml — one implementation, always)
auth: withPolicy(clerkAdapter({ ... }), filePolicy({ file: ".typren/access.yml" }))
```

The interface barely moves. Identity adapters already supply `getUser()`;
`withPolicy` supplies the `authorize()` that completes the `AuthAdapter`.
Existing adapters keep satisfying `AuthAdapter` unchanged, so this is additive —
and `filePolicy` becomes the single place the `AuthAction` mapping lives, which
is also the single place to audit. It must preserve the fail-closed convention
(`authorize()` wraps identity resolution in try/catch → `false`).

GitHub ends up as one identity option among many rather than the backbone,
which is what lets a customer bring their own SSO.

### Two corrections to today's defaults

**Invert the default to closed.** `auth/next-auth.ts` carries an explicit
`DEFAULT-OPEN CAVEAT` — with no allowlist configured, any signed-in user is
authorized. Defensible for a single-site tool where signing in already means
something; wrong under `filePolicy`, where no entry in `access.yml` must mean no
access, full stop.

**An email list is not authentication.** A list of addresses proves nothing
about who is connecting. `auth/local.ts` is honest about this and refuses in
production unless explicitly forced, precisely because the editor writes files.
So the default for an internet-facing self-hosted site cannot be the email list
alone — it needs a magic link or an OIDC provider doing the authentication, with
the email list acting as the *policy* half. Only localhost gets away with the
list by itself. This distinction has to be loud in the docs, or someone will put
an open editor on the internet.

### What is genuinely still stateless

- Sessions — signed tokens, no store.
- Site discovery — the GitHub API lists the App installations a user's token can
  reach, so "which sites can I see" is a query rather than a table.
- Policy — the file above.

### The honest weakness: revocation

Stateless tokens plus git-based policy means removal is not instant. Two bounds,
both cheap:

- Keep access tokens short (5–15 minutes) so a removed editor's live session
  expires on its own. This is the real control.
- Cache `access.yml` with a short TTL and invalidate on GitHub's `push` webhook
  for near-instant propagation without polling.

That cache is derived state — rebuildable, and harmless to lose. It is not a
system of record. You will want it regardless, because reading policy from the
GitHub API per request burns the 5,000/hour installation rate limit quickly.

A database becomes worthwhile for nice invite flows, hard revocation guarantees,
seat reconciliation, and a "my sites" view that outgrows GitHub's rate limits.
Do not build for those now. `AuthAdapter` is already an interface, so swapping
the file-backed policy for a database-backed one later is a new file and a
config line, not a refactor.

## Security model

### GitHub App, never an OAuth App

OAuth `repo` scope means a leak of our datastore hands an attacker every
customer's entire GitHub account. A GitHub App gets per-installation,
customer-selected repositories with narrow permissions:

- `contents: write`, `metadata: read`. Nothing else.
- **Never `workflows: write`.** Without it GitHub itself refuses any write to
  `.github/workflows/**`. That is a provider-enforced ceiling on
  "compromise the dashboard, then run code in their CI with their secrets", and
  it holds even when our code is wrong. Best control available, and free.
- Installation tokens are one hour and minted per request, so we store an
  installation id rather than a credential.

Repository creation at signup needs a user token or `administration: write`. Do
it as a **one-time** user-to-server OAuth (create-from-template), then discard
that token. Never retain a long-lived user token.

The App private key is the crown jewel — losing it compromises every
installation at once. KMS or HSM, never a plaintext environment variable.
GitHub supports multiple active keys, so rotation is possible without downtime.

### Write-path controls

Assume our code will have bugs and make that survivable:

1. **Path allowlist in the GitHub `ContentAdapter`.** Per this repo's own
   convention, an adapter owns its trust boundary and cannot inherit the fs
   adapter's guard. Every write resolves inside `content/**` and the media
   directory; reject `..`, absolute paths, dotfiles, `.github/`, and manifests.
2. **Content PRs as the cloud default.** The content-review CLI already produces
   them. If cloud publishes via PR against a protected branch, total compromise
   of our service still cannot change a customer's live site without a human
   merge. This is the structural answer to "someone overwrites the site".
   Direct-push becomes an opt-in dial rather than the default.
3. **Rate limits per installation**, with anomaly detection. A hundred file
   writes in a minute is not editing.
4. Every write is a git commit, so the audit trail is tamper-evident and
   revertable for free — better than WordPress's mutable database, and worth
   selling rather than merely shipping.

### Tenant isolation — the two gaps in today's code

IDOR is the most likely breach for any multi-tenant service, and this package is
single-tenant in two specific places:

- **`AuthContext` is `{action, slug}`** (`auth-adapter.ts`). No site identity.
  A hosted `authorize()` could only be correct by accident. Adding `siteId`
  makes the isolation check impossible to forget rather than merely documented.
  This is the highest-value pre-work item.
- **`createMeditorApi(config)` builds actions, store, settings and auth once at
  construction** (`api/routes.ts`). One process, one tenant. Hosted needs a
  per-request config factory.

Never take a site or repository identifier from the client and trust it. Resolve
session → user → membership → installation → repo on every request.

### Media: fix before launch

`media.ts` carries a `ponytail:` note that its SVG check is a blocklist regex,
not sanitization, and should be swapped for real sanitization "if upload access
ever extends beyond `authorize()`-gated authors". **Hosted multi-tenant is
exactly that extension.** Stored XSS on the dashboard origin means cross-tenant
session theft.

Cheapest mitigation is serving media from a separate origin; strongest is that
plus an allowlist-based sanitizer. Refusing SVG entirely is also defensible.

### CSRF

`api/routes.ts` already checks Origin on unsafe methods and allows requests with
no Origin header, which is correct reasoning — CSRF needs a browser to attach
credentials. A cross-origin hosted dashboard changes the shape, so prefer bearer
tokens held in memory over cookies. No ambient authority removes the entire CSRF
class rather than defending against it.

## Org and repository layout

Recommended names; the original proposal used domain-shaped names
(`typren.com`, `app.typren.com`), which encode deployment into identity and age
badly the day the dashboard moves host.

| Repo | Contents | License |
|---|---|---|
| `typren` | the OSS core — this package | AGPL |
| `website` | typren.com marketing + docs | — |
| `cloud` | the hosted control plane, GitHub App, billing | proprietary |
| `typren-template` | starter site users get at signup | permissive |

`typren-template` is easy to leave out of the plan and it is what makes
onboarding work: "create the repo for them" is GitHub's create-from-template
API, which needs a real template repository. `src/templates/init.js` is a
scaffolder, not the artifact GitHub forks.

Keeping cloud in its own repository is a **license boundary**, not a filing
preference — a repository that can never accidentally receive an
AGPL-licensed contribution.

Budget for the core↔cloud tax. Two repositories means constant version-bump
churn between them; this session began by reconciling exactly that drift between
this package and its two consumers. Do not merge them — the license boundary is
worth more — but wire up workspace linking against a local core checkout on day
one rather than discovering the cost in month two.

### AGPL has a consequence that must be handled first

AGPL §13 requires offering source for a modified version made available over a
network. Two implications, both needing actual legal review — the notes below
describe the common industry pattern, not advice:

1. **Our own cloud.** If `cloud` imports the AGPL core, it is likely a
   derivative work, which would oblige us to publish the cloud's source — the
   opposite of the plan. The standard resolution is that the copyright holder
   dual-licenses: AGPL for the public, and a proprietary grant to ourselves.
2. **Therefore a CLA is required from day one.** Dual-licensing only works while
   we hold the rights to the whole codebase. The moment an outside contribution
   lands without a contributor licence agreement, that code cannot be
   relicensed, and the ability to run a closed cloud on our own project is gone.
   **This must be in place before the org goes public**, not after the first
   external PR.

Customers are affected too: AGPL is a deliberate adoption tradeoff, and selling
a commercial exception is the usual counterpart. That is a coherent model —
Grafana and Sentry are the reference shapes — but it needs to be a decision
rather than a side effect.

## Rename surface

Cheapest it will ever be: v0.1.0, two consumers, both ours. Do it before the org
is public. This is the **second** rename and the first did not finish, so do it
mechanically and completely.

| Contract | Hits | Breaks |
|---|---|---|
| `--scms-*` CSS variables | 487 across 44 files | consumer theme overrides |
| `meditor-*` element tags | 181 | consumer HTML |
| `meditor/*` subpath imports | 101 | consumer imports |
| `Meditor*` symbols | 156 | consumer code |
| `__scms` postMessage key | 19 | **silently** |

The last row needs care. The preview bridge runs inside the *customer's* site,
so a renamed protocol key means a new dashboard against an old bridge fails with
no error at all. Accept both keys for one release, or version the protocol
explicitly.

## Pre-work checklist

Ordered by value, all in this package, all independent of the cloud repo:

1. `siteId` on `AuthContext` — makes tenant isolation structural.
2. `withPolicy` + `filePolicy` — one auditable permission implementation,
   default closed.
3. Per-request config resolution in `createMeditorApi`.
4. Cross-origin preview handshake with an explicit origin allowlist.
5. Real SVG sanitization, or a separate media origin.
6. A GitHub `ContentAdapter` with its own path allowlist. Bonus: the Contents
   API takes a blob SHA and rejects a stale one, which is a real
   compare-and-swap — it *closes* the `ponytail:` TOCTOU window in `store.ts`
   rather than inheriting it.
7. Serializable `fieldSchema`.

---

# Part II — Platform extensions (agreed 2026-08-25)

Part I stands unchanged. This part records the scope added once the OSS core
shipped: accounts, hosted git, an editing agent, the marketplace, and the
commercial adapters. Nothing here is built.

## The adapter doctrine

Every external function domain gets exactly one **port** — a TypeScript
interface plus a conformance test suite — in the OSS core. Each vendor is a
separate **provider** package (`@typren/provider-<domain>-<vendor>`)
implementing that port and passing its suite. The cloud composes providers via
config and never imports a vendor SDK directly. Existing code already has this
shape (`ContentAdapter`, `AuthAdapter`, the media adapter); the doctrine makes
it binding for every domain below, because it is what keeps each integration
individually testable and each vendor swappable.

| Port | First provider | Later |
|---|---|---|
| `RepoProvider` (content storage) | GitHub App | Typren Git (hosted Forgejo), GitLab |
| `IdentityProvider` (sign-in) | Google OAuth, GitHub OAuth | magic link, enterprise OIDC |
| `ModelProvider` (agent LLM) | OpenRouter (BYOK) | direct Anthropic/OpenAI keys, platform credits |
| `CommerceProvider` | Shopify Storefront | Medusa, commercetools |
| `SchedulingProvider` | cal.com | Calendly |
| `DomainProvider` | OpenSRS *or* OpenProvider (pick one) | the other |
| `BillingProvider` | Stripe | — |

A domain earns its port when the first provider lands, but the interface is
designed provider-shaped from day one — the port models the *function*
(register a domain, list availability), never one vendor's API.

## Accounts above sites

One person manages many sites, so the hierarchy is **account → site →
sections**. The split follows Part I's policy/identity rule:

- **Site-level roles stay in the repo** (`.typren/access.yml`) — portable, as
  designed.
- **Account-level roles** (owner, billing, member) live in our directory —
  billing-coupled and fast-changing, exactly the state Part I says cannot go
  in git.
- The tenancy chain grows one link: session → user → **account** → membership
  → site → installation → repo. The `siteId` pre-work item gains `accountId`
  the same way and for the same reason: isolation checks that are impossible
  to forget.

"My sites" starts as the installations query Part I describes, per account;
the cached table it anticipates becomes necessary sooner with multi-site
accounts, but is still derived state.

## Signup: OAuth identity, then bind the capability

Sign-up (Google or GitHub OAuth) and repo access (GitHub App installation)
stay separate steps on separate planes. Signing up with Google and then
binding a GitHub repo is the two-plane model working as designed, not a
special case — GitHub-the-identity and GitHub-the-repo-host are distinct
providers that happen to share a vendor.

## Typren Git: hosting the repo ourselves

For customers without a GitHub account we host their repository (managed
Forgejo, one org per account) as a second `RepoProvider`. This deliberately
bends Part I's core promise — for these customers we *are* where the content
lives — so the promise is restated in portable terms: **content is always a
standard git repository the customer can clone, mirror, fork, or export at
any moment.** One-click export to GitHub; port-out is a `git push`. The
contract is portability, not the hosting address.

Two controls Part I gets from GitHub for free must be re-implemented here,
because they are provider-enforced there: the `workflows: write` ceiling and
the write-path allowlist both become server-side hooks on Typren Git that
refuse any dashboard-identity write outside `content/**` and the media
directory. Without those hooks this tier silently loses the "compromised
dashboard cannot run code in CI" guarantee.

## The editing agent

The agent (content edits, slice authoring, "make me a page") is an
editor-plane principal and nothing more: it authenticates like an editor,
carries a role from `access.yml`, writes through the same dashboard API, and
its output lands as PRs. No side door. The audit story — "agent — updated
pricing headline", committed by `typren[bot]` — falls out of Part I's
attribution design for free, and the PR default means agent mistakes are
reviewable rather than live. (dandelion-site's `agentic-workflow` branch is
the working prototype of exactly this loop.)

Model access is the `ModelProvider` port:

- **BYOK** — the customer supplies an OpenRouter (or direct vendor) key.
  Keys are per-tenant secrets: encrypted at rest, never logged, never sent to
  the browser, used server-side only.
- **Platform credits** — managed-tier customers draw on our pooled keys,
  metered per account through `BillingProvider`.

Either way the agent executes no customer code. Generated slice/block code
goes through PR review like any contribution; only the managed tier's
ephemeral build sandbox ever runs it.

## Slices editor, marketplace, and the token contract

The slices editor is `@typren/editor` — React, private today. The hosted
dashboard is its first cross-origin consumer, which forces the
publish-or-keep-proprietary decision that has so far been deferred; it sits on
the critical path for both this section and conniechau's parked admin.

Marketplace blocks must be **drop-in and adopt the host site's look**. The
mechanism is a token contract, not per-block theming:

- Core defines the contextual token set — spacing scale, type scale, color
  roles, radius, elevation — extending the existing `theme.css` variable set
  (mind Part I's `--scms-*` rename surface; define these once, post-rename).
- A marketplace block may consume **only tokens**; raw values fail review.
- Serializable `fieldSchema` (pre-work #7) is the other half of drop-in: the
  dashboard edits a block it has never executed.

Marketplace blocks are reviewed and signed by us, which is what lets the
hosted dashboard trust their schemas and previews — the trust Part I rightly
refuses to arbitrary customer sections ("custom sections ship code" stays
customer-local). Distribution is npm under a marketplace scope: adding a block
commits a dependency plus a schema entry to the site repo, so sites keep
building even if the marketplace disappears.

## Commerce blocks (headless Shopify first)

`CommerceProvider` port: products, collections, cart, checkout handoff. First
provider is the Shopify Storefront API. The prebuilt blocks — product grid,
product page, cart drawer — are marketplace blocks on the token contract.
Product data is fetched at build/ISR time so pages stay static-fast; cart and
checkout run client-side against the provider, and checkout is always the
provider's hosted flow — we never touch payment data.

## Scheduling blocks

`SchedulingProvider` port: availability, booking, webhooks. cal.com first
(API-first, OSS, self-hostable — which suits the managed tier), Calendly as
the second mapping. The booking widget is a marketplace block.

## Domains

`DomainProvider` port: search, register, renew, transfer, DNS records.
OpenSRS or OpenProvider as the reseller backend — pick one; the port is what
keeps the other reachable. This is the most ops-heavy domain on the page:
reseller contracts, WHOIS/RDAP privacy, expiry dunning, and transfer-out that
must be as frictionless as transfer-in (the same portability principle as
Typren Git). The DNS layer is what connects a purchased domain to wherever
the site deploys. Sequenced last deliberately: revenue-adjacent rather than
product-critical, and registrar commitments are the least reversible decision
here.

## Sequencing

1. Part I pre-work checklist — unchanged, still first (items 1–3 now also
   carry `accountId`).
2. Accounts, OAuth signup, multi-site dashboard.
3. Agent on `ModelProvider` with BYOK — needs only the write path.
4. `@typren/editor` decision, token contract, marketplace skeleton.
5. Typren Git `RepoProvider`.
6. Commerce and scheduling blocks — need the marketplace.
7. Domains.
