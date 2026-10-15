---
"@typren/core": patch
---

Notion block conversion now escapes `<`, `>` and `&` in text, keeps only http(s)/mailto link and image URLs
(other links keep their text), fences code so its content cannot close the fence, and refuses component
directive names outside `[A-Za-z0-9_-]`. A Notion page can no longer inject HTML into the rendered markdown.
