---
"@typren/core": patch
---

Notion code blocks normalise CR / CRLF line endings, so a bare CR inside a list-nested code block can no longer break out of its list item and fence.
