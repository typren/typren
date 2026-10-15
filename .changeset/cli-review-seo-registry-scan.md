---
"typren": patch
---

`typren review` scraped slice keys from the project's `seo-registry.ts` with a single regex over the whole (repo-controlled) file. It now scans the file line by line with plain string operations instead, so parsing it can't regress into regex backtracking blowup on adversarial content.
