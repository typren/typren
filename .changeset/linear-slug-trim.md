---
"@typren/core": patch
---

Replace the polynomial dash-trim regex (`/^-+|-+$/g`) with an equivalent linear one in the three slugify sites (store, sections, media). Behavior is unchanged — after the alnum collapse consecutive dashes cannot occur — but hostile input can no longer trigger quadratic backtracking. Closes the three CodeQL alerts.
