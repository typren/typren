## Promotion: develop → main

<!-- Open with ?template=promotion.md. Base: main, compare: develop. -->

### What ships

<!-- Packages and versions this promotion releases (from the Version Packages PR / changesets). -->

### Security review

The **Security review** check reviews the commits in this PR and fails on any open critical or high finding
([docs/security-review.md](../../docs/security-review.md)).

- [ ] Findings in the check's job summary read; any false positive explained in a comment
- [ ] Medium and low findings worth keeping tracked in issues

### Release checklist

- [ ] `bun run verify` passes locally
- [ ] Breaking changes have a migration note in `docs/migrations/`
- [ ] Manual QA done for anything unit tests can't prove (list it)
