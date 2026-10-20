---
"@typren/core": patch
---

The SVG upload sanitizer now drops any attribute with a `url(` that is not a same-document fragment reference, including an unterminated one that CSS would still resolve externally. Markdown/llms rendering now skips malformed repeating-item props (`columns`, `cards`, `items`, `quotes`, `stats`) instead of throwing, so one bad page no longer breaks `llms-full.txt` or its `.md` route.
