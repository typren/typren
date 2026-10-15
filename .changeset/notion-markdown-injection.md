---
"@typren/core": patch
---

Fix two stored-XSS paths in the Notion block converter: a nested code block's content lines weren't indented to match their list/quote/to-do container, letting the fence (and a payload like `<img onerror=...>`) break out as a top-level HTML block; and plain Notion text and bookmark/image captions weren't escaped for markdown metacharacters, letting a caption like `a](javascript:...) [b` or literal text `[x](javascript:...)` close its wrapper early and become a live, script-executing link.
