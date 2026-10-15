---
"@typren/core": patch
---

Fix a stored-XSS path in the Notion block converter: an inline-code run containing a line break ended its paragraph inside the would-be code span, so the rest of the run (for example `<div><img onerror=...></div>`) rendered as live HTML. Line endings inside inline code now collapse to spaces, which is how CommonMark renders them anyway.
