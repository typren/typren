# Security policy

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Report privately through GitHub's [private vulnerability
reporting](https://github.com/typren/typren/security/advisories/new) on this
repository. That gives us a private thread and a coordinated disclosure path.

Please include what you can: affected version, a reproduction, and what an
attacker gets out of it. A working proof of concept helps but is not required, since
a clear description of the flaw is enough to start.

We will acknowledge within a few days. Since this is an early-stage project run
by a very small team, please allow reasonable time for a fix before disclosing
publicly; we would rather agree a timeline with you than surprise each other.

## Scope

Typren writes to a filesystem or a Git repository and gates those writes behind
a pluggable auth adapter, so the things we care most about are:

- **Path traversal** through a slug, locale, media id, or any other
  caller-supplied identifier that becomes part of a path. Adapters validate
  their own inputs; a bypass is a real finding.
- **Authorization bypass**, meaning anything that lets an unauthenticated or
  under-privileged caller reach a write action. `AuthAdapter.authorize()`
  implementations are required to fail closed, so any path that reaches a write
  on a thrown error is a bug.
- **Privilege escalation through content**, in particular anything that lets an
  editor modify configuration that determines what the next boot trusts.
- **Stored XSS** through uploaded media or authored content. Note the SVG check
  in `media.ts` is currently a blocklist and is documented as such. See the
  known-limitations note below.
- **Secret disclosure** in logs, error messages, or published artifacts.

## Known limitations

We would rather write these down than have you rediscover them:

- **SVG upload sanitization is a blocklist**, not a parser-based sanitizer. It
  is marked in `media.ts` as adequate only while upload access is gated to
  trusted authors. Do not expose uploads to untrusted users on the current
  implementation.
- **The version check in `store.ts` has a TOCTOU window.** It is marked in the
  source with its ceiling. A Git-backed adapter closes it, since the Contents
  API takes a blob SHA and rejects a stale one.

Reports about these are still welcome, especially if you can show impact worse
than what is documented, but they are known rather than novel.

## Supply chain

Releases are published from a clean CI checkout with npm provenance attestation,
so a published tarball can be verified against the commit it was built from.
Secret scanning runs on every commit and push locally, with GitHub push
protection as the server-side backstop.
