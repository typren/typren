---
"typren": patch
---

`typren migrate --remote` now validates a remote note's `version` against a full semver-ish pattern instead of only checking its prefix, so a value like `0.6.0` followed by a terminal escape sequence is rejected rather than printed. It also strips control characters from untrusted index URLs and fetch/parse error messages before they reach the terminal, matching the stripping already done for a note's title and body.
