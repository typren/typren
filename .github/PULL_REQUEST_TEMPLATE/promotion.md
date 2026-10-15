## Promotion: develop → main

<!-- Open with ?template=promotion.md. Base: main, compare: develop. -->

### What ships

<!-- Packages and versions this promotion releases (from the Version Packages PR / changesets). -->

### Security review

The **Security review** check blocks this PR until a record in `security-reviews/` covers the head commit
([docs/security-review.md](../../docs/security-review.md)).

- [ ] Reviewed at the head commit of this PR, with Claude Code (`security-review` workflow) or the runbook
- [ ] Record committed: `security-reviews/<date>-<slug>.md` (from `security-reviews/_TEMPLATE-review.md`)
- [ ] Zero open critical and high findings; medium and low tracked in issues
- [ ] OR a waiver committed from `security-reviews/_TEMPLATE-waiver.md`, with owner, reason, expiry and a follow-up issue
- [ ] Nothing security-sensitive changed after the reviewed commit (the check enforces this; re-review if it fails)

### Release checklist

- [ ] `bun run verify` passes locally
- [ ] Breaking changes have a migration note in `docs/migrations/`
- [ ] Manual QA done for anything unit tests can't prove (list it)
