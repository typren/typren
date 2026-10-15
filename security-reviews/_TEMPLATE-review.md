---
reviewedHead: <commit sha being promoted: git rev-parse HEAD>
date: YYYY-MM-DD
method: workflow # workflow | runbook | manual
outcome: fail # pass only with zero open critical and high findings
open:
  critical: 0
  high: 0
  medium: 0
  low: 0
incomplete: [] # list any lens you could not complete; a non-empty list cannot pass
---

<!-- Copy to security-reviews/<date>-<slug>.md and fill in. See docs/security-review.md.
     Never describe an unfixed vulnerability here: report it privately (SECURITY.md) and record it once fixed. -->

## Summary

One paragraph: what was reviewed, by which method, and the outcome.

## Confirmed findings

| Severity | Finding | Location | Fix / status |
|---|---|---|---|
| | | `path:line` | |

## Refuted claims

- Claim, and why it does not hold (the code that blocks it).

## Verified clean

- What each lens checked and found holding.
